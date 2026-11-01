import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as preferences from '../src/theme/preferences';
import * as codes from '../src/theme/codes';
import * as presets from '../src/theme/presets';
import * as ramp from '../src/theme/ramp';
import * as apply from '../src/theme/apply';

type Node = {
  type: string;
  props: Record<string, any>;
  children: Node[];
  parent?: Node;
  text?: string;
};
const node = (type: string): Node => ({ type, props: {}, children: [] });
const renderer = Vue.createRenderer<Node, Node>({
  createElement: node,
  createText: (text) => ({ ...node('text'), text }),
  createComment: () => node('comment'),
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.text = text;
    n.children = [];
  },
  patchProp: (n, key, _, value) => {
    n.props[key] = value;
  },
  insert(n, parent, anchor) {
    n.parent = parent;
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i < 0) parent.children.push(n);
    else parent.children.splice(i, 0, n);
  },
  remove(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
  },
  parentNode: (n) => n.parent ?? null,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
});
const { descriptor } = parse(
  readFileSync(new URL('../src/components/dashboard/ThemeTab.vue', import.meta.url), 'utf8'),
);
const compiled = compileScript(descriptor, { id: 'theme-test', inlineTemplate: true });
const js = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const unmounts: (() => void)[] = [];
afterEach(() => {
  unmounts.splice(0).forEach((fn) => fn());
  vi.unstubAllGlobals();
});
function mount({
  mobile = false,
  reduced = false,
  donor = true,
  storage = new Map<string, string>(),
} = {}) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
  });
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
  });
  const theme = Vue.reactive({
    prefs: preferences.defaults(),
    dirty: false,
    pending: false,
    error: '',
    preview: vi.fn((p: preferences.ThemePrefs) => {
      theme.prefs = preferences.clone(p);
    }),
    cancel: vi.fn(),
    reset: vi.fn(),
    save: vi.fn(),
  });
  const device = Vue.reactive({ performanceMode: false, hydrate: vi.fn() });
  const modules: Record<string, unknown> = {
    vue: Vue,
    quasar: { useQuasar: () => ({ screen: { lt: { md: mobile } } }) },
    'src/stores/theme': { useThemeStore: () => theme },
    'src/stores/dashboard': { useDashboardStore: () => ({ isDonator: donor }) },
    'src/stores/devicePreferences': { useDevicePreferencesStore: () => device },
    'src/theme/preferences': preferences,
    'src/theme/codes': codes,
    'src/theme/presets': presets,
    'src/theme/ramp': ramp,
    'src/theme/apply': apply,
    'src/utils/platform': { isDesktopBuild: false },
    'src/composables/useHaptics': { isHapticsEnabled: () => false, setHapticsEnabled() {} },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', js)((id: string) => {
    if (!(id in modules)) throw new Error(id);
    return modules[id];
  }, exports);
  const app = renderer.createApp(exports.default);
  app.config.globalProperties.$q = { screen: { lt: { md: mobile } } };
  for (const name of ['q-btn', 'q-card', 'q-card-section', 'q-select', 'q-input', 'q-slider']) {
    app.component(name, {
      props: ['modelValue'],
      setup:
        (props, { attrs, slots }) =>
        () =>
          Vue.h(name, { ...attrs, modelValue: props.modelValue }, slots.default?.()),
    });
  }
  const root = node('root');
  app.mount(root);
  unmounts.push(() => app.unmount());
  const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)];
  const field = (value: string) => {
    const n = all(root).find((n) => n.props['data-field'] === value);
    expect(n, value).toBeTruthy();
    return n!;
  };
  const button = (label: string) => {
    const n = all(root).find((n) => n.type === 'q-btn' && n.props.label === label);
    expect(n, label).toBeTruthy();
    return n!;
  };
  const click = async (label: string) => {
    await button(label).props.onClick();
    await Vue.nextTick();
  };
  const model = async (value: string, input: unknown) => {
    field(value).props['onUpdate:modelValue'](input);
    await Vue.nextTick();
  };
  return { theme, device, storage, root, all, field, button, click, model };
}
const payload = () => ({
  v: 1 as const,
  name: 'Imported 夜',
  preset: 'ice' as const,
  accent: null,
  density: 'compact' as const,
  fx: { ...preferences.defaults().fx, pattern: 'rain' as const },
  frosted: true,
  font: 'mono' as const,
});

describe('ThemeTab interactions', () => {
  it('uses native color pickers and rejects low-contrast accent changes atomically', async () => {
    const ui = mount({ mobile: true });
    const accent = ui.field('theme-accent-picker');
    expect(accent.type).toBe('input');
    expect(accent.props.type).toBe('color');
    accent.props.onInput({ target: { value: '#33ccaa' } });
    await Vue.nextTick();
    expect(ui.theme.prefs.accent).toBe('#33ccaa');
    const before = preferences.clone(ui.theme.prefs);
    ui.theme.preview.mockClear();
    ui.field('theme-accent-picker').props.onInput({ target: { value: '#010101' } });
    await Vue.nextTick();
    expect(ui.theme.preview).not.toHaveBeenCalled();
    expect(ui.theme.prefs).toEqual(before);
    expect(ui.field('theme-accent-warning').text).toContain('3:1');
    const effect = ui.field('theme-fx-color-picker');
    expect(effect.props.type).toBe('color');
    effect.props.onInput({ target: { value: '#33ccaa' } });
    await Vue.nextTick();
    expect(ui.theme.prefs.fx.color).toBe('#33ccaa');
  });
  it('keeps a theme preview when switching away from this tab', () => {
    const ui = mount();
    ui.theme.dirty = true;
    unmounts.pop()!();
    expect(ui.theme.cancel).not.toHaveBeenCalled();
  });
  it('places labels above dense no-label controls and offers mobile two-column choices', () => {
    const ui = mount({ mobile: true });
    for (const field of [
      'theme-density',
      'theme-chat-size',
      'theme-chat-density',
      'theme-code-input',
      'theme-preset-name',
    ]) {
      expect(ui.field(field).props.label).toBeUndefined();
      expect(ui.field(field).props.class).toContain('dashboard-no-label-field');
      expect(ui.field(field).props.dense).toBeDefined();
      expect(
        ui.all(ui.root).some((n) => n.type === 'label' && n.props.for === ui.field(field).props.id),
      ).toBe(true);
    }
    expect(ui.field('theme-preset').props.class).toContain('theme-choice-grid');
    expect(ui.field('theme-fx-pattern').props.class).toContain('theme-choice-grid');
  });
  it('previews the bundled OpenDyslexic font without saving and toggles back to mono', async () => {
    const ui = mount();
    const before = preferences.clone(ui.theme.prefs);
    const input = () => ui.field('theme-font').children.find((n) => n.type === 'input')!;
    expect(input().props.checked).toBe(false);
    input().props.onChange({ target: { checked: true } });
    await Vue.nextTick();
    expect(ui.theme.prefs).toEqual({ ...before, font: 'opendyslexic' });
    expect(input().props.checked).toBe(true);
    expect(ui.theme.save).not.toHaveBeenCalled();
    input().props.onChange({ target: { checked: false } });
    await Vue.nextTick();
    expect(ui.theme.prefs).toEqual(before);
  });
  it('offers nine patterns, safe colors, bounded sliders, off and frosted preview', async () => {
    const ui = mount();
    expect(ui.all(ui.field('theme-fx-pattern')).filter((n) => n.type === 'q-btn')).toHaveLength(9);
    await ui.click('rain');
    expect(ui.theme.prefs.fx.pattern).toBe('rain');
    await ui.model('theme-fx-intensity', 0.7);
    await ui.model('theme-fx-size', 1.5);
    expect(ui.theme.prefs.fx).toMatchObject({ intensity: 0.7, size: 1.5 });
    await ui.model('theme-fx-intensity', null);
    await ui.model('theme-fx-size', null);
    expect(ui.theme.prefs.fx).toMatchObject({ intensity: 0.7, size: 1.5 });
    expect(ui.field('theme-fx-intensity').props).toMatchObject({ min: 0, max: 1 });
    expect(ui.field('theme-fx-size').props).toMatchObject({ min: 0.5, max: 2 });
    const swatches = ui.all(ui.field('theme-fx-color')).filter((n) => n.type === 'button');
    expect(swatches).toHaveLength(8);
    swatches[0]!.props.onClick();
    await Vue.nextTick();
    expect(ui.theme.prefs.fx.color).toBe(ramp.ACCENTS[0]);
    await ui.click('palette color');
    expect(ui.theme.prefs.fx.color).toBeNull();
    ui.field('theme-frosted')
      .children.find((n) => n.type === 'input')!
      .props.onChange({ target: { checked: true } });
    expect(ui.theme.prefs.frosted).toBe(true);
    await ui.click('none');
    expect(ui.theme.prefs.fx.pattern).toBe('none');
  });
  it('disables animated controls for reduced motion and performance, but keeps off usable', async () => {
    const ui = mount({ reduced: true });
    await Vue.nextTick();
    expect(ui.button('rain').props.disable).toBe(true);
    expect(ui.button('none').props.disable).toBeFalsy();
    expect(ui.field('theme-fx-note')).toBeTruthy();
    await ui.click('rain');
    expect(ui.theme.preview).not.toHaveBeenCalled();
    const other = mount();
    other.device.performanceMode = true;
    await Vue.nextTick();
    expect(other.button('rain').props.disable).toBe(true);
  });
  it('warns once on mobile when enabling animation, including subsequent mounts', async () => {
    const ui = mount({ mobile: true });
    await ui.click('rain');
    expect(ui.field('theme-fx-battery')).toBeTruthy();
    expect(ui.storage.get('mourn_theme_fx_battery_warned_v1')).toBe('1');
    await ui.click('none');
    await ui.click('embers');
    expect(ui.theme.prefs.fx.pattern).toBe('embers');
    const next = mount({ mobile: true, storage: ui.storage });
    await next.click('rain');
    expect(next.all(next.root).some((n) => n.props['data-field'] === 'theme-fx-battery')).toBe(
      false,
    );
  });
  it('rejects a whole invalid import without any preview, then previews a valid snapshot in one call', async () => {
    const ui = mount();
    const before = preferences.clone(ui.theme.prefs);
    await ui.model(
      'theme-code-input',
      Buffer.from(JSON.stringify({ ...payload(), extra: true })).toString('base64url'),
    );
    await ui.click('preview code');
    expect(ui.theme.preview).not.toHaveBeenCalled();
    expect(ui.theme.prefs).toEqual(before);
    await ui.model('theme-code-input', codes.encodeThemeCode(payload()));
    await ui.click('preview code');
    expect(ui.theme.preview).toHaveBeenCalledTimes(1);
    expect(ui.theme.prefs).toMatchObject({ preset: 'ice', fx: payload().fx, frosted: true });
    expect(ui.field('theme-preset-name').props.modelValue).toBe(payload().name);
    await ui.click('save current as preset');
    expect(ui.theme.prefs.saved[0]).toMatchObject({
      name: payload().name,
      fx: payload().fx,
      frosted: true,
      font: 'mono',
    });
    await ui.click('none');
    await ui.click(payload().name);
    expect(ui.theme.prefs.fx.pattern).toBe('rain');
  });
  it('enforces donor and five-save caps and restores defaults for legacy snapshots', async () => {
    const ui = mount({ donor: false });
    await ui.model('theme-preset-name', 'test');
    await ui.click('save current as preset');
    expect(ui.theme.prefs.saved).toHaveLength(0);
    const donor = mount();
    donor.theme.prefs.saved = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      name: `old${i}`,
      preset: 'crimson',
      accent: null,
    }));
    donor.theme.prefs.fx.pattern = 'rain';
    donor.theme.prefs.frosted = true;
    donor.theme.prefs.font = 'opendyslexic';
    await Vue.nextTick();
    await donor.model('theme-preset-name', 'sixth');
    await donor.click('save current as preset');
    expect(donor.theme.prefs.saved).toHaveLength(5);
    await donor.click('old0');
    expect(donor.theme.prefs).toMatchObject({
      fx: preferences.defaults().fx,
      frosted: false,
      font: 'mono',
    });
  });
  it('warns on mobile when a saved animated look is selected', async () => {
    const ui = mount({ mobile: true });
    ui.theme.prefs.saved = [
      {
        id: 'rain',
        name: 'saved rain',
        preset: 'crimson',
        accent: null,
        fx: { ...preferences.defaults().fx, pattern: 'rain' },
      },
    ];
    await Vue.nextTick();
    await ui.click('saved rain');
    expect(ui.storage.get('mourn_theme_fx_battery_warned_v1')).toBe('1');
  });
  it('leaves a selectable export field when the clipboard is unavailable', async () => {
    const ui = mount();
    await ui.click('export code');
    const exported = ui.field('theme-code-output').props.modelValue;
    expect(codes.decodeThemeCode(exported)).toMatchObject({
      preset: 'crimson',
      fx: preferences.defaults().fx,
    });
    expect(ui.field('theme-code-status')).toBeTruthy();
  });
});
