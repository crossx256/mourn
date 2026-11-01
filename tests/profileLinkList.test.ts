import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, defineComponent, h, nextTick } from 'vue';
import * as Vue from 'vue';
import * as profileLinks from '../src/utils/profileLinks';
import * as socialLinks from '../src/utils/socialLinks';
import * as externalLinkWarning from '../src/composables/useExternalLinkWarning';
import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import type { LinkStyleConfig, ProfileLink } from '../src/types/profile';

// Same DOM-free harness as tests/profileSocials.test.ts: compile the SFC for a custom
// renderer so the client template is exercised in Vitest's Node environment.
const { descriptor } = parse(
  readFileSync(new URL('../src/components/profile/ProfileLinkList.vue', import.meta.url), 'utf8'),
);
const compiled = compileScript(descriptor, { id: 'profile-link-list-test', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: { default?: Vue.Component } = {};
new Function('require', 'exports', code)((id: string) => {
  if (id === 'vue') return Vue;
  if (id === 'src/utils/profileLinks') return profileLinks;
  if (id === 'src/utils/socialLinks') return socialLinks;
  if (id === 'src/composables/useExternalLinkWarning') return externalLinkWarning;
  throw new Error(`unexpected component import: ${id}`);
}, exports);
const ProfileLinkList = exports.default!;

type TestNode = {
  type: string;
  props: Record<string, unknown>;
  children: TestNode[];
  parent: TestNode | null;
  text?: string;
};
const node = (type: string, text?: string): TestNode => ({
  type,
  props: {},
  children: [],
  parent: null,
  ...(text === undefined ? {} : { text }),
});
const renderer = createRenderer<TestNode, TestNode>({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (element, text) => {
    element.text = text;
  },
  setElementText: (element, text) => {
    element.text = text;
  },
  parentNode: (element) => element.parent,
  nextSibling: () => null,
  patchProp: (element, key, _previous, value) => {
    element.props[key] = value;
  },
  insert: (element, parent) => {
    element.parent = parent;
    parent.children.push(element);
  },
  remove: (element) => {
    if (element.parent)
      element.parent.children = element.parent.children.filter((child) => child !== element);
  },
});

function find(root: TestNode, predicate: (n: TestNode) => boolean): TestNode[] {
  return [
    ...(predicate(root) ? [root] : []),
    ...root.children.flatMap((child) => find(child, predicate)),
  ];
}

/** True when any node under `root` carries exactly this text. A single text child is
 *  set with setElementText (the compiler emits a TEXT patch flag), so the value lives on
 *  the element rather than in a separate #text child. */
function hasText(root: TestNode, value: string): boolean {
  return find(root, (n) => n.text === value).length > 0;
}

/** The class binding arrives unnormalised (runtime-dom normally flattens it). */
function classList(element: TestNode): string[] {
  const raw = element.props.class;
  const flatten = (value: unknown): string[] => {
    if (!value) return [];
    if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (typeof value === 'object')
      return Object.entries(value).flatMap(([k, on]) => (on ? [k] : []));
    return [];
  };
  return flatten(raw);
}

const unmounts: Array<() => void> = [];
function mount(links: ProfileLink[], style: Partial<LinkStyleConfig> = {}) {
  const root = node('root');
  const app = renderer.createApp(ProfileLinkList, {
    links,
    style: {
      layout: 'stack',
      align: 'center',
      width: 'default',
      radius: null,
      color: null,
      backgroundColor: null,
      hoverEffect: 'inherit',
      showTitles: true,
      showThumbs: true,
      openNewTab: true,
      position: 'below-bio',
      showClassicIcons: false,
      iconPosition: 'left',
      gap: 10,
      ...style,
    },
    ariaLabel: 'links',
  });
  app.component(
    'QIcon',
    defineComponent({
      props: { name: String },
      setup: (props) => () => h('icon', { name: props.name }),
    }),
  );
  for (const name of ['QCard', 'QCardSection', 'QCardActions', 'QBtn']) {
    app.component(
      name,
      defineComponent({
        setup:
          (_, { attrs, slots }) =>
          () =>
            h(name, attrs, slots.default?.()),
      }),
    );
  }
  app.component(
    'QDialog',
    defineComponent({
      props: { modelValue: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.modelValue ? h('dialog', slots.default?.()) : null,
    }),
  );
  app.directive('close-popup', {});
  app.mount(root);
  unmounts.push(() => app.unmount());
  vi.stubGlobal(
    'MouseEvent',
    class extends Event {
      button = 0;
    },
  );
  return root;
}

afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
  vi.unstubAllGlobals();
});

// Fixtures use a RECOGNISED host: an unrecognised one is deliberately held behind the
// visitor warning, which its own tests below cover.
const row = (overrides: Partial<ProfileLink> = {}): ProfileLink => {
  const base = profileLinks.makeProfileLink('https://github.com/one');
  if (!base) throw new Error('fixture url not parseable');
  return { ...base, ...overrides };
};

describe('profile link list rendering', () => {
  it('renders one anchor per visible link and skips hidden rows', () => {
    const root = mount([
      row({ id: 'l_00000001', title: 'one' }),
      row({ id: 'l_00000002', title: 'two', url: 'https://github.com/two', visible: false }),
      row({ id: 'l_00000003', title: 'three', url: 'https://github.com/three' }),
    ]);
    const anchors = find(root, (element) => element.type === 'a');
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.props).toMatchObject({
      href: 'https://github.com/one',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });

  it('renders nothing at all when every link is hidden', () => {
    const root = mount([row({ visible: false })]);
    expect(find(root, (element) => element.type === 'nav')).toHaveLength(0);
  });

  it('renders a section header as a label, not a link', () => {
    const root = mount([
      { ...row({ id: 'l_0000000a' }), kind: 'header', url: null, title: 'find me elsewhere' },
      row({ id: 'l_0000000b' }),
    ]);
    expect(find(root, (element) => element.type === 'a')).toHaveLength(1);
    const header = find(
      root,
      (element) => element.type === 'div' && element.props.role === 'presentation',
    );
    expect(header).toHaveLength(1);
    expect(hasText(header[0]!, 'find me elsewhere')).toBe(true);
  });

  it('honours openNewTab off', () => {
    const root = mount([row()], { openNewTab: false });
    const anchor = find(root, (element) => element.type === 'a')[0]!;
    expect(anchor.props.target).toBeUndefined();
    expect(anchor.props.rel).toBeUndefined();
  });

  it('applies the layout, align, width and icon-position classes', () => {
    const root = mount([row()], {
      layout: 'grid',
      align: 'left',
      width: 'wide',
      iconPosition: 'top',
    });
    const nav = find(root, (element) => element.type === 'nav')[0]!;
    const classes = classList(nav);
    for (const expected of [
      'profile-links',
      'layout-grid',
      'align-left',
      'width-wide',
      'icons-top',
    ])
      expect(classes).toContain(expected);
    expect(nav.props['aria-label']).toBe('links');
  });

  it('uses the per-row style override, the featured flag and the accent colour', () => {
    const root = mount([
      row({ id: 'l_0000000c', style: 'card', featured: true, accent: '#00ff00' }),
      row({ id: 'l_0000000d', url: 'https://github.com/plain', style: 'inherit' }),
    ]);
    const anchors = find(root, (element) => element.type === 'a');
    expect(classList(anchors[0]!)).toContain('style-card');
    expect(classList(anchors[0]!)).toContain('is-featured');
    expect(anchors[0]?.props.style).toMatchObject({ '--link-accent': '#00ff00' });
    // An "inherit" row falls back to the layout's default row style.
    expect(classList(anchors[1]!)).toContain('style-button');
    expect(anchors[1]?.props.style).toEqual({});
  });

  it('renders platform glyphs, emoji and uploaded images distinctly', () => {
    const youtube = profileLinks.makeProfileLink('https://youtube.com/@me');
    const root = mount([
      { ...youtube!, id: 'l_0000000e' },
      row({ id: 'l_0000000f', url: 'https://github.com/e', icon: { kind: 'emoji', value: '🎧' } }),
      row({
        id: 'l_00000010',
        url: 'https://github.com/i',
        icon: { kind: 'image', value: 'https://i.ibb.co/x/i.png' },
      }),
    ]);
    const icons = find(root, (element) => element.type === 'icon');
    expect(icons.map((icon) => icon.props.name)).toEqual(['fa-brands fa-youtube']);
    expect(hasText(root, '🎧')).toBe(true);
    const images = find(root, (element) => element.type === 'img');
    expect(images.some((img) => img.props.src === 'https://i.ibb.co/x/i.png')).toBe(true);
    // lazy-loaded: no render blocking images in the SSR HTML
    expect(images.every((img) => img.props.loading === 'lazy')).toBe(true);
  });

  it('drops thumbnails when they are switched off or the layout is a list', () => {
    const thumbsOff = mount([row({ thumb: 'https://i.ibb.co/t/t.png' })], { showThumbs: false });
    expect(find(thumbsOff, (element) => element.type === 'img')).toHaveLength(0);

    const asList = mount([row({ thumb: 'https://i.ibb.co/t/t.png' })], { layout: 'list' });
    expect(find(asList, (element) => element.type === 'img')).toHaveLength(0);

    const cards = mount([row({ thumb: 'https://i.ibb.co/t/t.png' })], { layout: 'cards' });
    const thumb = find(cards, (element) => element.type === 'img');
    expect(thumb[0]?.props.src).toBe('https://i.ibb.co/t/t.png');
  });

  it('keeps the titles in the DOM (screen readers) when they are visually hidden', () => {
    const root = mount([row({ title: 'my tape' })], { showTitles: false });
    const nav = find(root, (element) => element.type === 'nav')[0]!;
    expect(classList(nav)).toContain('hide-titles');
    expect(hasText(nav, 'my tape')).toBe(true);
  });

  it('exposes the styling knobs as CSS custom properties', () => {
    const root = mount([row()], {
      gap: 18,
      radius: '14px',
      color: '#ff0000',
      backgroundColor: '#101010',
      width: 'narrow',
    });
    const nav = find(root, (element) => element.type === 'nav')[0]!;
    expect(nav.props.style).toMatchObject({
      '--links-gap': '18px',
      '--links-radius': '14px',
      '--links-max-width': '320px',
      '--links-color': '#ff0000',
      '--links-bg': '#101010',
    });
  });
});

describe('unrecognised link warning', () => {
  it('lets recognised hosts navigate without interference', () => {
    const root = mount([row({ id: 'l_00000020', url: 'https://youtube.com/@me' })]);
    const anchor = find(root, (element) => element.type === 'a')[0]!;
    expect(anchor.props).toMatchObject({
      href: 'https://youtube.com/@me',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(anchor.props.role).toBeUndefined();
    expect(anchor.props['aria-haspopup']).toBeUndefined();
  });

  it('holds back an unrecognised host behind a confirmation', async () => {
    const root = mount([row({ id: 'l_00000021', url: 'https://some-personal-site.example/me' })]);
    const anchor = find(root, (element) => element.type === 'a')[0]!;
    expect(anchor.props.href).toBeUndefined();
    expect(anchor.props).toMatchObject({ role: 'button', tabindex: 0, 'aria-haspopup': 'dialog' });
    expect(String(anchor.props['aria-label'])).toContain('opens warning');
    expect(find(root, (element) => element.type === 'dialog')).toHaveLength(0);

    const event = new Event('click', { cancelable: true });
    const callbacks = anchor.props.onClick;
    for (const callback of Array.isArray(callbacks) ? callbacks : [callbacks])
      (callback as (event: Event) => void)(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    const dialog = find(root, (element) => element.type === 'dialog');
    expect(dialog).toHaveLength(1);
    // the full destination is printed for the visitor
    expect(hasText(dialog[0]!, 'https://some-personal-site.example/me')).toBe(true);
    const confirm = find(root, (element) => element.props.label === 'continue to site')[0]!;
    expect(confirm.props).toMatchObject({
      href: 'https://some-personal-site.example/me',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    const cancel = find(root, (element) => element.props.label === 'cancel')[0]!;
    expect(cancel.props).toHaveProperty('autofocus');
  });

  it('mirrors the classic row for keyboard activation', async () => {
    const root = mount([row({ id: 'l_00000022', url: 'https://another-site.example/' })]);
    const anchor = find(root, (element) => element.type === 'a')[0]!;
    const event = new Event('keydown', { cancelable: true });
    // @keydown.enter compiles to a key guard, so the key has to be set.
    Object.defineProperty(event, 'key', { value: 'Enter' });
    const callbacks = anchor.props.onKeydown;
    (Array.isArray(callbacks) ? callbacks : [callbacks]).forEach((callback) =>
      (callback as (event: Event) => void)(event),
    );
    await nextTick();
    expect(find(root, (element) => element.type === 'dialog')).toHaveLength(1);
  });
});
