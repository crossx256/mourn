import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import { readFileSync } from 'node:fs';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as presentation from '../../src/components/calls/presentation';

let calls: any;
const push = vi.fn(async (_path: string) => {});
const setActiveLink = vi.fn();
const activeChains = [{ id: 'link', senderId: 'me', receiver: { username: 'Peer' } }];
let confirmed: (() => unknown) | undefined;
const dialog = vi.fn(() => ({ onOk: (cb: () => unknown) => { confirmed = cb; } }));
function component(file: string): Vue.Component {
  const { descriptor } = parse(readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8'));
  const compiled = compileScript(descriptor, { id: 'call-ui-test', inlineTemplate: true });
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { default?: Vue.Component } = {};
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return Vue;
    if (id === 'quasar') return { useQuasar: () => ({ dialog, notify: vi.fn() }) };
    if (id === 'vue-router') return { useRouter: () => ({ push }) };
    if (id === 'src/stores/calls') return { useCallsStore: () => calls };
    if (id === 'src/stores/auth') return { useAuthStore: () => ({ user: { id: 'me' } }) };
    if (id === 'src/stores/links') return { useLinksStore: () => ({ links: activeChains, activeChains }) };
    if (id === 'src/stores/vault') return { useVaultStore: () => ({ setActiveLink }) };
    if (id === 'src/components/calls/presentation') return presentation;
    if (id.startsWith('src/components/calls/')) return { default: component(id.slice(4)) };
    throw new Error(`Unexpected import ${id}`);
  }, exports);
  return exports.default!;
}
type Node = { type: string; props: Record<string, any>; text: string; children: Node[]; parent: Node | null };
const node = (type: string, text = ''): Node => ({ type, props: {}, text, children: [], parent: null });
const renderer = Vue.createRenderer<Node, Node>({
  createElement: node, createText: (text) => node('#text', text), createComment: () => node('#comment'),
  setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; },
  parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  patchProp: (n, key, _old, value) => { n.props[key] = value; },
  insert: (n, parent) => { n.parent = parent; parent.children.push(n); },
  remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(x => x !== n); },
});
const unmounts: Array<() => void> = [];
function mount(file: string) {
  const root = node('root'); const app = renderer.createApp(component(file));
  app.directive('close-popup', {});
  for (const name of ['QPage', 'QBtn', 'QIcon', 'QList', 'QItem', 'QItemSection', 'QItemLabel', 'QSeparator', 'QSpinner', 'QToggle', 'QTooltip', 'QSelect', 'QMenu'])
    app.component(name, Vue.defineComponent({ setup: (_, { attrs, slots }) => () => Vue.h(name, attrs, slots.default?.()) }));
  app.mount(root); unmounts.push(() => app.unmount()); return root;
}
const find = (root: Node, predicate: (n: Node) => boolean): Node[] => [ ...(predicate(root) ? [root] : []), ...root.children.flatMap(n => find(n, predicate)) ];
const text = (root: Node): string => root.text + root.children.map(text).join(' ');
function setup(overrides: Record<string, any> = {}) {
  calls = Vue.reactive({ state: { phase: 'IDLE' }, busy: false, call: null, error: null, minimized: false, android: false, enabled: true, supported: true, ready: false, history: [], loading: false, hasMore: false, canCall: true, loadHistory: vi.fn(async () => {}), clearHistory: vi.fn(async () => {}), ...overrides });
}
afterEach(() => { unmounts.splice(0).forEach(f => f()); confirmed = undefined; vi.clearAllMocks(); });

describe('call UI regressions', () => {
  it('opens the actual chain chat from a history row and keeps actions on demand', async () => {
    setup({ history: [{ id: 'one', linkId: 'link', callerId: 'me', state: 'MISSED', createdAt: new Date().toISOString() }] });
    const root = mount('pages/CallsPage.vue');
    await find(root, n => n.type === 'QItem' && n.props.clickable)[0]!.props.onClick();
    expect(push).toHaveBeenCalledWith('/chains');
    expect(setActiveLink).toHaveBeenCalledWith('link');
    expect(find(root, n => n.props['aria-label'] === 'Call contact')).toHaveLength(0);
    expect(find(root, n => n.props['aria-label'] === 'Call options')).toHaveLength(1);
  });
  it('labels missed history rows by direction and shows the reason for an ended call', () => {
    const createdAt = new Date().toISOString();
    setup({ history: [
      { id: 'incoming', linkId: 'link', callerId: 'peer', state: 'MISSED', endReason: 'timeout', createdAt },
      { id: 'outgoing', linkId: 'link', callerId: 'me', state: 'MISSED', endReason: 'timeout', createdAt },
      { id: 'failed', linkId: 'link', callerId: 'me', state: 'ENDED', endReason: 'failed', createdAt },
    ] });
    const captions = find(mount('pages/CallsPage.vue'), n => n.type === 'QItemLabel' && 'caption' in n.props).map(text);
    expect(captions).toEqual([expect.stringContaining('Missed call'), expect.stringContaining('No answer'), expect.stringContaining('Could not connect')]);
  });
  it('routes ringtone, vibration and microphone choices through store actions', () => {
    setup({ ringtone: 'system', vibrate: true, microphones: [], micDeviceId: '', setRingtone: vi.fn(), setVibrate: vi.fn(), setMicrophone: vi.fn(), loadMicrophones: vi.fn() });
    const root = mount('components/calls/CallSettings.vue');
    find(root, n => n.props['aria-label'] === 'Call ringtone')[0]!.props['onUpdate:modelValue']('silent');
    find(root, n => n.props['aria-label'] === 'Vibrate for calls')[0]!.props['onUpdate:modelValue'](false);
    find(root, n => n.props['aria-label'] === 'Call microphone')[0]!.props['onUpdate:modelValue']('mic');
    expect(calls.setRingtone).toHaveBeenCalledWith('silent');
    expect(calls.setVibrate).toHaveBeenCalledWith(false);
    expect(calls.setMicrophone).toHaveBeenCalledWith('mic');
  });
  it('honors silent mode, live ringtone changes and vibration cleanup', async () => {
    const play = vi.fn(async () => {}), pause = vi.fn(), vibrate = vi.fn();
    vi.stubGlobal('Audio', class { play = play; pause = pause; removeAttribute = vi.fn(); });
    vi.stubGlobal('navigator', { vibrate });
    setup({ state: { phase: 'RINGING' }, busy: true, ringtone: 'silent', vibrate: true });
    mount('components/calls/CallOverlay.vue');
    expect(play).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith([500, 300, 500]);
    calls.ringtone = 'system'; await Vue.nextTick();
    expect(play).toHaveBeenCalledTimes(1);
    calls.state.phase = 'ENDED'; calls.busy = false; await Vue.nextTick();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    vi.unstubAllGlobals();
  });
  it('renders human-readable end reasons instead of protocol tokens', () => {
    setup({ state: { phase: 'ENDED', reason: 'max-duration', role: 'callee' } });
    const root = mount('components/calls/CallOverlay.vue');
    expect(text(root)).toContain('Call ended');
    expect(text(root)).not.toContain('max duration');
  });
  it('does not turn a history fetch error into a global voice dialog', () => {
    setup({ error: 'Could not load call history.' });
    const root = mount('components/calls/CallOverlay.vue');
    expect(find(root, n => n.props.role === 'dialog')).toHaveLength(0);
  });
  it('never hides incoming answer controls behind a minimized previous call', () => {
    setup({ state: { phase: 'RINGING' }, busy: true, minimized: true });
    const root = mount('components/calls/CallOverlay.vue');
    expect(find(root, n => n.props.label === 'Accept')).toHaveLength(1);
    expect(find(root, n => n.props['aria-label'] === 'Minimize call')).toHaveLength(0);
  });
  it('keeps mute unavailable until media is connecting or active', () => {
    setup({ state: { phase: 'DIALING' }, busy: true });
    const root = mount('components/calls/CallOverlay.vue');
    expect(find(root, n => n.props.label === 'Mute')[0]?.props.disable).toBe(true);
  });
  it('shows history failure and retry without a misleading empty history', () => {
    setup({ error: 'Could not load call history.' });
    const root = mount('pages/CallsPage.vue');
    expect(text(root)).not.toContain('No recent calls.');
    expect(find(root, n => n.props['aria-label'] === 'Retry loading call history')).toHaveLength(1);
  });
  it('requires confirmation and blocks duplicate history mutations until settled', async () => {
    let finish!: () => void;
    setup({ history: [{ id: 'one', linkId: 'former', callerId: 'me', state: 'MISSED', createdAt: new Date().toISOString() }], clearHistory: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    const root = mount('pages/CallsPage.vue');
    const button = find(root, n => n.props.label === 'Clear log')[0]!;
    button.props.onClick(); expect(calls.clearHistory).not.toHaveBeenCalled();
    confirmed!(); await Vue.nextTick();
    expect(calls.clearHistory).toHaveBeenCalledTimes(1);
    expect(find(root, n => n.props.label === 'Clear log')[0]?.props.disable).toBe(true);
    finish(); await Vue.nextTick();
  });
});
