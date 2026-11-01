import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, defineComponent, h, nextTick } from 'vue';
import * as Vue from 'vue';
import * as socialLinks from '../src/utils/socialLinks';
import * as externalLinkWarning from '../src/composables/useExternalLinkWarning';
import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';

// Compile the client template for a DOM-free renderer; Vitest's Node mode otherwise emits SSR code.
const { descriptor } = parse(
  readFileSync(new URL('../src/components/profile/ProfileSocials.vue', import.meta.url), 'utf8'),
);
const compiled = compileScript(descriptor, { id: 'profile-socials-test', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: { default?: Vue.Component } = {};
new Function('require', 'exports', code)((id: string) => {
  if (id === 'vue') return Vue;
  if (id === 'src/utils/socialLinks') return socialLinks;
  if (id === 'src/composables/useExternalLinkWarning') return externalLinkWarning;
  if (id === 'src/stores/approvedDomains') {
    // The component only asks the store to load the approved-domain overlay once; the
    // overlay itself lives in utils/socialLinks and is registered directly by these tests.
    return { useApprovedDomainsStore: () => ({ ensureLoaded: async () => {} }) };
  }
  throw new Error(`unexpected component import: ${id}`);
}, exports);
const ProfileSocials = exports.default!;

type TestNode = {
  type: string;
  props: Record<string, unknown>;
  children: TestNode[];
  parent: TestNode | null;
};
const node = (type: string): TestNode => ({ type, props: {}, children: [], parent: null });
const renderer = createRenderer<TestNode, TestNode>({
  createElement: node,
  createText: () => node('#text'),
  createComment: () => node('#comment'),
  setText: () => {},
  setElementText: () => {},
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
function find(root: TestNode, predicate: (node: TestNode) => boolean): TestNode[] {
  return [
    ...(predicate(root) ? [root] : []),
    ...root.children.flatMap((child) => find(child, predicate)),
  ];
}
const unmounts: Array<() => void> = [];
function mount(links: Record<string, string>) {
  const root = node('root');
  const app = renderer.createApp(ProfileSocials, { socialLinks: links, hoverEffect: 'static' });
  for (const name of ['QCard', 'QCardSection', 'QCardActions', 'QBtn', 'QIcon']) {
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

describe('profile social link navigation', () => {
  it('keeps recognized links native and omits invalid URLs', () => {
    const root = mount({ github: 'https://github.com/me', custom: 'javascript:alert(1)' });
    const links = find(root, (element) => element.type === 'a');
    expect(links).toHaveLength(1);
    expect(links[0]?.props).toMatchObject({
      href: 'https://github.com/me',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });
  it.each(['onClick', 'onAuxclick', 'onKeydown'])(
    'requires confirmation for unrecognized links via %s',
    async (handler) => {
      const root = mount({ custom: 'https://unknown.test/path' });
      const link = find(root, (element) => element.type === 'a')[0]!;
      expect(link.props.href).toBeUndefined();
      expect(link.props).toMatchObject({ role: 'button', tabindex: 0, 'aria-haspopup': 'dialog' });
      expect(find(root, (element) => element.type === 'dialog')).toHaveLength(0);
      const event = new Event(handler === 'onKeydown' ? 'keydown' : 'click', { cancelable: true });
      Object.defineProperty(event, 'key', { value: 'Enter' });
      const callbacks = link.props[handler];
      for (const callback of Array.isArray(callbacks) ? callbacks : [callbacks])
        (callback as (event: Event) => void)(event);
      await nextTick();
      expect(event.defaultPrevented).toBe(true);
      expect(find(root, (element) => element.type === 'dialog')).toHaveLength(1);
      const cancel = find(root, (element) => element.props.label === 'cancel')[0]!;
      expect(cancel.props).toHaveProperty('autofocus');
      const confirm = find(root, (element) => element.props.label === 'continue to site')[0]!;
      expect(confirm.props).toMatchObject({
        href: 'https://unknown.test/path',
        target: '_blank',
        rel: 'noopener noreferrer',
      });
      (confirm.props.onClick as () => void)();
      await nextTick();
      expect(find(root, (element) => element.type === 'dialog')).toHaveLength(0);
    },
  );
});
