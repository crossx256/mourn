import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive, type EffectScope } from 'vue';

const f = vi.hoisted(() => ({ auth: null as any, vault: null as any, links: null as any, calls: null as any,
  channels: {} as Record<string, (...args: any[]) => Promise<void>>, controller: null as any, outgoing: null as any,
  active: vi.fn(), get: vi.fn(), native: false,
}));
vi.mock('#q-app', () => ({ defineBoot: (callback: unknown) => callback }));
vi.mock('src/utils/platform', () => ({ isNativeBuild: true }));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => f.auth }));
vi.mock('src/stores/vault', () => ({ useVaultStore: () => f.vault }));
vi.mock('src/stores/links', () => ({ useLinksStore: () => f.links }));
vi.mock('src/stores/calls', () => ({ useCallsStore: () => f.calls, setCallTransport: (port: unknown) => { f.outgoing = port; } }));
vi.mock('src/calls/api', () => ({ callsApi: { active: f.active, get: f.get } }));
vi.mock('src/calls/android', () => ({ isAndroidCallsPlatform: () => f.native, AndroidCalls: {
  addListener: vi.fn(async () => ({ remove: vi.fn() })), getPendingActions: vi.fn(async () => ({ actions: [] })),
} }));
const uid = 'alice', device = '11111111-1111-4111-8111-111111111111';
const cid = '22222222-2222-4222-8222-222222222222';
let scope: EffectScope;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function boot() {
  expect((await import('src/utils/platform')).isNativeBuild).toBe(true);
  const { installCalls: install } = await import('../../src/boot/calls');
  scope = effectScope(); scope.run(() => (install as unknown as () => void)());
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers(); f.native = false; f.channels = {};
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  f.controller = { send: vi.fn(async () => []), retireCall: vi.fn(), ...Object.fromEntries(['Signal', 'Incoming', 'State', 'Ready'].map(name => [`on${name}`, (cb: any) => { f.channels[name] = cb; return () => { delete f.channels[name]; }; }])) };
  f.auth = reactive({ user: { id: uid }, isLoggedIn: true });
  f.vault = reactive({ deviceId: device, transportConnected: false, getCallSignalTransport: () => f.controller, admitCallSignals: vi.fn(async () => {}) });
  f.links = reactive({ links: [] });
  f.calls = reactive({ call: null, busy: false, minimized: false,
    initialize: vi.fn(async () => {}), destroy: vi.fn(async () => {}), discardInterruptedCalls: vi.fn(async () => {}),
    receiveSignal: vi.fn(async () => {}), receiveIncoming: vi.fn(async () => {}), receiveState: vi.fn(async () => {}),
    announceReady: vi.fn(async () => {}), peerReady: vi.fn(async () => {}), socketChanged: vi.fn(async () => {}),
    refreshConfig: vi.fn(async () => {}), linkSevered: vi.fn(async () => {}), nativeServiceChanged: vi.fn(async () => {}), audioFocusChanged: vi.fn(),
  });
  f.active.mockResolvedValue([]); f.get.mockReset();
});
afterEach(() => { scope?.stop(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('memory-only call boot lifecycle', () => {
  it('wires explicit admission and terminal retirement to the Vault controller', async () => {
    await boot(); await vi.waitFor(() => expect(f.calls.discardInterruptedCalls).toHaveBeenCalled());
    await f.outgoing.admit(cid);
    expect(f.vault.admitCallSignals).toHaveBeenCalledWith(cid, undefined);
    const created = { id: cid, state: 'RINGING', callerId: uid, callerDeviceId: device };
    await f.outgoing.admit(cid, created);
    expect(f.vault.admitCallSignals).toHaveBeenLastCalledWith(cid, created);
    f.outgoing.retire(cid);
    expect(f.controller.retireCall).toHaveBeenCalledWith(cid);
    const port = f.outgoing;
    f.auth.isLoggedIn = false;
    await expect(port.admit(cid)).rejects.toThrow('CALL_ACCOUNT_CHANGED');
  });
  it('waits for manager readiness before consuming an early authenticated signal', async () => {
    const init = deferred(); f.calls.initialize.mockReturnValueOnce(init.promise);
    await boot();
    const event = { body: { cid, t: 'offer' } };
    const processing = f.channels.Signal!(event);
    await Promise.resolve(); expect(f.calls.receiveSignal).not.toHaveBeenCalled();
    init.resolve(); await processing;
    expect(f.calls.receiveSignal).toHaveBeenCalledWith(event.body);
  });
  it('propagates consumer failure and never treats a dropped signal as accepted', async () => {
    f.calls.receiveSignal.mockRejectedValueOnce(new Error('manager failed'));
    await boot(); await vi.waitFor(() => expect(f.calls.discardInterruptedCalls).toHaveBeenCalled());
    await expect(f.channels.Signal!({ body: { cid } })).rejects.toThrow('manager failed');
  });
  it('does not reset legitimate cold-start hints, but marks actual logout as an account boundary', async () => {
    await boot(); await vi.waitFor(() => expect(f.calls.initialize).toHaveBeenCalled());
    expect(f.calls.destroy.mock.calls[0]?.[0]?.accountBoundary).not.toBe(true);
    f.auth.isLoggedIn = false;
    expect(f.calls.destroy).toHaveBeenLastCalledWith({ accountBoundary: true });
  });
  it('rechecks account identity after awaited metadata before encrypted sending', async () => {
    await boot(); await vi.waitFor(() => expect(f.calls.discardInterruptedCalls).toHaveBeenCalled());
    const pending = deferred(); f.get.mockImplementation(async () => { await pending.promise; return { linkId: 'link', callerId: uid, calleeId: 'bob' }; });
    const port = f.outgoing;
    const sending = expect(port.send('link', 'peer', { cid })).rejects.toThrow('CALL_ACCOUNT_CHANGED');
    f.auth.isLoggedIn = false; pending.resolve(); await sending;
    expect(f.controller.send).not.toHaveBeenCalled();
  });
  it('routes ready hints to REST-authoritative fresh negotiation without a persisted drain', async () => {
    await boot(); await vi.waitFor(() => expect(f.calls.discardInterruptedCalls).toHaveBeenCalled());
    await f.channels.Ready!({ callId: cid, deviceId: device });
    expect(f.calls.peerReady).toHaveBeenCalledWith(cid, device);
    f.vault.transportConnected = true;
    await vi.waitFor(() => expect(f.active).toHaveBeenCalled());
    expect(f.controller.drain).toBeUndefined();
  });
});
