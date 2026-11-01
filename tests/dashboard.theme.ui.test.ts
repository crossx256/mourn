import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Node = {
  type: string;
  props: Record<string, any>;
  children: Node[];
  parent?: Node;
  text?: string;
  querySelectorAll: () => Node[];
  scrollTo: () => void;
};
const node = (type: string): Node => ({
  type,
  props: {},
  children: [],
  querySelectorAll: () => [],
  scrollTo() {},
});
const renderer = Vue.createRenderer<Node, Node>({
  createElement: node,
  createText: (text) => ({ ...node('text'), text }),
  createComment: () => node('comment'),
  setText(n, text) {
    n.text = text;
  },
  setElementText(n, text) {
    n.text = text;
    n.children = [];
  },
  patchProp(n, key, _, value) {
    n.props[key] = value;
  },
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
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
  readFileSync(new URL('../src/pages/DashboardPage.vue', import.meta.url), 'utf8'),
);
const compiled = compileScript(descriptor, { id: 'dashboard-theme-test', inlineTemplate: true });
const js = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const unmounts: (() => void)[] = [];
afterEach(() => {
  unmounts.splice(0).forEach((fn) => fn());
  vi.unstubAllGlobals();
});
async function mount({ profileDirty = false, themeDirty = true } = {}) {
  const listeners: Record<string, (e: any) => void> = {};
  vi.stubGlobal('window', {
    addEventListener: (name: string, fn: (e: any) => void) => {
      listeners[name] = fn;
    },
    removeEventListener() {},
  });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const dashboard = Vue.reactive({
    hasUnsavedChanges: profileDirty,
    isDirty: profileDirty,
    isLoading: false,
    isSaving: false,
    error: '',
    fetchDashboardData: vi.fn(),
    saveProfile: vi.fn(async () => {
      dashboard.hasUnsavedChanges = false;
      dashboard.isDirty = false;
      return true;
    }),
    revertChanges: vi.fn(() => {
      dashboard.hasUnsavedChanges = false;
      dashboard.isDirty = false;
    }),
  });
  const theme = Vue.reactive({
    dirty: themeDirty,
    pending: false,
    saving: false,
    error: '',
    save: vi.fn(async () => {
      theme.dirty = false;
      theme.pending = true;
    }),
    cancel: vi.fn(() => {
      theme.dirty = false;
    }),
  });
  const route = Vue.reactive({ query: { tab: 'theme' } });
  const router = { replace: vi.fn(), push: vi.fn() };
  const notify = vi.fn();
  let guard!: (to: { fullPath: string }) => boolean;
  let sidebar: Record<string, any> = {};
  const blank = { render: () => Vue.h('div') };
  const modules: Record<string, unknown> = {
    vue: {
      ...Vue,
      defineAsyncComponent: () => blank,
      Transition: {
        inheritAttrs: false,
        setup:
          (_: unknown, { slots }: { slots: Vue.Slots }) =>
          () =>
            slots.default?.(),
      },
    },
    quasar: { useQuasar: () => ({ notify }) },
    'vue-router': {
      useRoute: () => route,
      useRouter: () => router,
      onBeforeRouteLeave: (fn: typeof guard) => {
        guard = fn;
      },
    },
    'src/stores/theme': { THEME_ENABLED: true, useThemeStore: () => theme },
    'src/stores/dashboard': { useDashboardStore: () => dashboard },
    'src/components/dashboard': {
      DashboardPreview: blank,
      ChangePasswordModal: blank,
      DeleteAccountModal: blank,
    },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', js)((id: string) => {
    if (!(id in modules)) throw new Error(id);
    return modules[id];
  }, exports);
  const app = renderer.createApp(exports.default);
  app.provide('setDashboardSidebarProps', (value: Record<string, any>) => {
    sidebar = value;
  });
  app.config.globalProperties.$q = { screen: { gt: { md: false } } };
  for (const name of [
    'q-page',
    'q-no-ssr',
    'q-dialog',
    'q-card',
    'q-card-section',
    'q-card-actions',
    'q-btn',
  ]) {
    app.component(name, {
      setup:
        (_, { attrs, slots }) =>
        () =>
          Vue.h(name, attrs, slots.default?.()),
    });
  }

  const root = node('root');
  app.mount(root);
  const unmount = () => app.unmount();
  unmounts.push(unmount);
  await Vue.nextTick();
  const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)];
  const status = () => all(root).find((n) => n.props.role === 'status')?.text;
  const click = async (label: string) => {
    const button = all(root).find((n) => n.type === 'q-btn' && n.props.label === label);
    expect(button, label).toBeTruthy();
    await button!.props.onClick();
    await Vue.nextTick();
  };
  return {
    dashboard,
    theme,
    router,
    notify,
    listeners,
    status,
    click,
    guard: (path: string) => guard({ fullPath: path }),
    sidebar: () => sidebar,
    unmount,
  };
}

describe('Dashboard theme save and leave controls', () => {
  it('shows unsaved theme changes in the header and protects browser unload', async () => {
    const ui = await mount();
    expect(ui.status()).toBe('Unsaved changes');
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    ui.listeners.beforeunload!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it('saves a theme-only edit locally without saving a profile', async () => {
    const ui = await mount();
    ui.sidebar().onSaveChanges();
    await vi.waitFor(() => expect(ui.theme.save).toHaveBeenCalledOnce());
    expect(ui.dashboard.saveProfile).not.toHaveBeenCalled();
    expect(ui.status()).toBe('No unsaved changes');
    expect(ui.theme.pending).toBe(true);
  });
  it('leave and save commits theme-only changes and allows navigation with account sync pending', async () => {
    const ui = await mount();
    expect(ui.guard('/chains')).toBe(false);
    await ui.click('leave and save');
    expect(ui.theme.save).toHaveBeenCalledOnce();
    expect(ui.dashboard.saveProfile).not.toHaveBeenCalled();
    expect(ui.router.push).toHaveBeenCalledWith('/chains');
  });
  it('cancel keeps previews and leave and revert discards both kinds of edits', async () => {
    const ui = await mount({ profileDirty: true });
    expect(ui.guard('/chains')).toBe(false);
    await ui.click('cancel');
    expect(ui.theme.cancel).not.toHaveBeenCalled();
    expect(ui.router.push).not.toHaveBeenCalled();
    expect(ui.guard('/chains')).toBe(false);
    await ui.click('leave and revert');
    expect(ui.theme.cancel).toHaveBeenCalledOnce();
    expect(ui.dashboard.revertChanges).toHaveBeenCalledOnce();
    expect(ui.router.push).toHaveBeenCalledWith('/chains');
  });
  it('saves both dirty stores and stays put when the profile save fails', async () => {
    const ui = await mount({ profileDirty: true });
    ui.dashboard.saveProfile.mockResolvedValue(false);
    expect(ui.guard('/chains')).toBe(false);
    await ui.click('leave and save');
    expect(ui.router.push).not.toHaveBeenCalled();
    expect(ui.status()).toBe('Unsaved changes');
    ui.dashboard.saveProfile.mockImplementation(async () => {
      ui.dashboard.hasUnsavedChanges = false;
      ui.dashboard.isDirty = false;
      return true;
    });
    await ui.click('leave and save');
    expect(ui.theme.save).toHaveBeenCalledOnce();
    expect(ui.router.push).toHaveBeenCalledWith('/chains');
  });
  it('does not leave if the theme remains dirty after a rejected save', async () => {
    const ui = await mount();
    ui.theme.save.mockImplementation(async () => {});
    ui.guard('/chains');
    await ui.click('leave and save');
    expect(ui.router.push).not.toHaveBeenCalled();
    expect(ui.theme.dirty).toBe(true);
  });
  it('preserves previews across dashboard tabs and cancels only on dashboard teardown', async () => {
    const ui = await mount();
    ui.sidebar()['onUpdate:activeTab']('app');
    await Vue.nextTick();
    expect(ui.theme.cancel).not.toHaveBeenCalled();
    expect(ui.status()).toBe('Unsaved changes');
    unmounts.pop()!();
    expect(ui.theme.cancel).toHaveBeenCalledOnce();
  });
});
