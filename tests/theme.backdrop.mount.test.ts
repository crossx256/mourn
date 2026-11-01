import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import { defaults, clone } from '../src/theme/preferences';

describe('BackdropLayer mount contract', () => {
  it('mounts exactly one fixed non-interactive backdrop canvas from App', () => {
    const component = readFileSync(
      new URL('../src/components/theme/BackdropLayer.vue', import.meta.url),
      'utf8',
    );
    const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
    expect(component.match(/id="m-backdrop"/g)).toHaveLength(1);
    expect(component).toContain('position: fixed');
    expect(component).toContain('inset: 0');
    expect(component).toContain('z-index: 0');
    expect(component).toContain('pointer-events: none');
    expect(component).toContain('theme.prefs.fx');
    expect(component).toContain('device.performanceMode');
    expect(component).toContain('theme.prefs.extras.reduceMotion');
    expect(component).toContain("route.name === 'profile'");
    expect(component).toContain('AUTH_PATHS');
    expect(component).toContain('resolveTheme(theme.prefs).accent');
    expect(component).toContain('role="status"');
    expect(component).toContain('Effects paused: frame budget exceeded.');
    expect(component).toContain('white-space: nowrap');
    expect(component).not.toContain('theme.preview(');
    expect(component).toContain('data-backdrop-active');
    expect(app.match(/<BackdropLayer\s*\/>/g)).toHaveLength(1);
  });
});

type Host = {
  type: string;
  props: Record<string, any>;
  children: Host[];
  parent?: Host;
  text?: string;
};
const host = (type: string): Host => ({ type, props: {}, children: [] });
const renderer = Vue.createRenderer<Host, Host>({
  createElement: host,
  createText: (text) => ({ ...host('text'), text }),
  createComment: () => host('comment'),
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.text = text;
  },
  patchProp: (n, key, _, value) => {
    n.props[key] = value;
  },
  insert(n, parent, anchor) {
    n.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(n);
    else parent.children.splice(index, 0, n);
  },
  remove(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
  },
  parentNode: (n) => n.parent ?? null,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.unstubAllGlobals();
});
function mountLayer(enabled = true) {
  const prefs = Vue.reactive(defaults());
  prefs.fx.pattern = 'rain';
  prefs.frosted = true;
  const theme = Vue.reactive({ prefs, suspended: false });
  const device = Vue.reactive({ performanceMode: false });
  const route = Vue.reactive({ name: 'dashboard', path: '/dashboard' });
  const dataset: Record<string, string> = { clientTheme: 'on' };
  const attrs = new Set<string>(),
    classes = new Set<string>();
  vi.stubGlobal('__MOURN_MOBILE_BUILD__', false);
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {
    documentElement: {
      dataset,
      toggleAttribute: (key: string, active: boolean) =>
        active ? attrs.add(key) : attrs.delete(key),
    },
    body: {
      classList: {
        toggle: (key: string, active: boolean) => (active ? classes.add(key) : classes.delete(key)),
      },
    },
  });
  let callbacks: { onAutoDisable(): void };
  const configure = vi.fn(),
    destroy = vi.fn(),
    start = vi.fn(),
    suspend = vi.fn();
  const modules: Record<string, unknown> = {
    vue: Vue,
    'vue-router': { useRoute: () => route },
    'src/stores/theme': { useThemeStore: () => theme, THEME_ENABLED: enabled },
    'src/stores/devicePreferences': { useDevicePreferencesStore: () => device },
    'src/theme/apply': {
      resolveTheme: () => ({ accent: theme.prefs.accent ?? '#ff0000' }),
      applyFrosted: (on: boolean) => {
        if (on) dataset.frosted = 'on';
        else delete dataset.frosted;
        document.body.classList.toggle('theme-frosted', on);
      },
    },
    'src/theme/backdrop/engine': {
      BackdropEngine: class {
        constructor(_canvas: unknown, _deps: unknown, cb: typeof callbacks) {
          callbacks = cb;
        }
        configure = configure;
        start = start;
        setSuspended = suspend;
        destroy = destroy;
      },
    },
  };
  const { descriptor } = parse(
    readFileSync(new URL('../src/components/theme/BackdropLayer.vue', import.meta.url), 'utf8'),
  );
  const compiled = compileScript(descriptor, { id: 'backdrop-test', inlineTemplate: true });
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', js)((id: string) => modules[id], exports);
  const app = renderer.createApp(exports.default),
    root = host('root');
  app.mount(root);
  let mounted = true;
  const unmount = () => {
    if (mounted) {
      mounted = false;
      app.unmount();
    }
  };
  cleanup.push(unmount);
  const all = (n: Host): Host[] => [n, ...n.children.flatMap(all)];
  return {
    theme,
    route,
    device,
    dataset,
    attrs,
    classes,
    configure,
    suspend,
    destroy,
    disable: async () => {
      callbacks.onAutoDisable();
      await Vue.nextTick();
    },
    notice: () => all(root).find((n) => n.props.role === 'status'),
    unmount,
  };
}

describe('BackdropLayer live policy', () => {
  it('resolves null color, keeps auto-disable visible and never persists a different choice', async () => {
    const ui = mountLayer();
    expect(ui.configure).toHaveBeenLastCalledWith({ ...ui.theme.prefs.fx, color: '#ff0000' });
    ui.theme.prefs.accent = '#00ffff';
    await Vue.nextTick();
    expect(ui.configure).toHaveBeenLastCalledWith({ ...ui.theme.prefs.fx, color: '#00ffff' });
    const before = clone(ui.theme.prefs);
    await ui.disable();
    expect(ui.notice()).toBeDefined();
    expect(ui.attrs.has('data-backdrop-active')).toBe(false);
    expect(ui.theme.prefs).toEqual(before);
    ui.device.performanceMode = true;
    await Vue.nextTick();
    expect(ui.notice()).toBeUndefined();
    ui.device.performanceMode = false;
    await Vue.nextTick();
    expect(ui.notice()).toBeDefined();
  });
  it('cleans frosted and canvas state on auth/profile routes and unmount, then restores on return', async () => {
    const ui = mountLayer();
    expect(ui.classes.has('theme-frosted')).toBe(true);
    for (const [name, path] of [
      ['login', '/login'],
      ['register', '/register/invite/abc'],
      ['profile', '/someone'],
    ]) {
      ui.route.name = name!;
      ui.route.path = path!;
      await Vue.nextTick();
      expect(ui.suspend).toHaveBeenLastCalledWith(true);
      expect(ui.classes.has('theme-frosted')).toBe(false);
      expect(ui.dataset.frosted).toBeUndefined();
      expect(ui.attrs.has('data-backdrop-active')).toBe(false);
      ui.route.name = 'dashboard';
      ui.route.path = '/dashboard';
      await Vue.nextTick();
      expect(ui.classes.has('theme-frosted')).toBe(true);
    }
    ui.theme.prefs.frosted = false;
    await Vue.nextTick();
    expect(ui.classes.has('theme-frosted')).toBe(false);
    ui.theme.prefs.frosted = true;
    await Vue.nextTick();
    ui.unmount();
    expect(ui.destroy).toHaveBeenCalledOnce();
    expect(ui.classes.has('theme-frosted')).toBe(false);
    expect(ui.attrs.has('data-backdrop-active')).toBe(false);
  });
  it('does not activate canvas or frosted surfaces when the feature is disabled', () => {
    const ui = mountLayer(false);
    expect(ui.suspend).toHaveBeenLastCalledWith(true);
    expect(ui.attrs.has('data-backdrop-active')).toBe(false);
    expect(ui.classes.has('theme-frosted')).toBe(false);
  });
});
