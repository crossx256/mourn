// tests/vaultSend.test.ts
// Outbound invariants for src/stores/vault.ts::sendMessage, driven through the
// REAL action with the module boundaries mocked (libsodium, idb-keyval,
// offlineVault ratchet storage, links/auth stores, transport):
//
//   CS-05  (a) the rate-limit budget is charged only for ACCEPTED sends
//          (b) a delivered frame is never reported as failed because a
//              post-send step threw
//          (c) a retried row replays its built frames instead of consuming new
//              ratchet indexes
//          (d) an already-delivered row refuses a duplicate send
//
// HARNESS: `defineStore` is stubbed so the store factory returns the store's
// RAW state object with the actions bound to it (the same technique the audit's
// client-state-probe-resend.cjs uses). Pinia would hand back a reactive proxy,
// so every plain object assigned to state (`vault.transport = transport`) was
// wrapped and identity checks against the test's own object failed — a harness
// artefact, not product behaviour. The real action is still what runs.
//
// Run: bunx vitest run tests/vaultSend.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }));
// Per-store instances keyed by id, shared by every factory created for that id.
const stores = vi.hoisted(() => ({ instances: new Map<string, unknown>() as Map<string, unknown> }));
vi.mock('idb-keyval', () => ({ ...storage, update: vi.fn() }));
vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia');
  return {
    ...actual,
    // Raw-state store: no reactive proxy, so identity comparisons in the store
    // (`this.transport === transport`) behave exactly as in production, where the
    // value is the real VaultTransport instance.
    defineStore: (id: string, options: Record<string, unknown>) => {
      const stateFactory = options.state as (() => Record<string, unknown>) | undefined;
      const build = () => {
        // The PROBE pattern (see client-state-probe-resend.cjs) keeps one raw
        // state instance per store id. Without this, re-evaluating a store module
        // (the vault's dynamic `import('stores/auth')`) and the test's own import
        // would each factory a separate state object.
        const existing = stores.instances.get(id);
        if (existing && options.actions) return existing as Record<string, unknown>;
        const state = (stateFactory ? stateFactory() : {}) as Record<string, unknown>;
        for (const [name, value] of Object.entries((options.actions ?? {}) as Record<string, unknown>)) {
          state[name] =
            typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(state)
              : value;
        }
        for (const [name, getter] of Object.entries((options.getters ?? {}) as Record<string, unknown>)) {
          if (typeof getter !== 'function') continue;
          Object.defineProperty(state, name, {
            get: () => (getter as (this: unknown) => unknown).call(state),
            enumerable: true,
            configurable: true,
          });
        }
        Object.defineProperty(state, '$id', { value: id, enumerable: false });
        if (options.actions) stores.instances.set(id, state);
        // `store.$reset()` is how a case clears module-global state (the auth
        // store's user) again; on a raw state object that means the initial state.
        state.$reset = () => {
          // defineProperty, not assignment: a getter-only key (a state-level
          // computed) must be replaced, not assigned. Build from a FRESH state
          // object (instances are not cached for option-less factories).
          const fresh = (stateFactory ? stateFactory() : {}) as Record<string, unknown>;
          for (const name of Object.keys(fresh)) {
            Object.defineProperty(state, name, {
              value: fresh[name],
              writable: true,
              enumerable: true,
              configurable: true,
            });
          }
        };
        return state;
      };
      return build;
    },
  };
});
vi.mock('../src/crypto/offlineVault', () => ({
  getEncryptedRatchetState: vi.fn(),
  setEncryptedRatchetState: vi.fn(),
  removeEncryptedRatchetStates: vi.fn(),
  clearOfflineBlobsForUser: vi.fn(),
}));
vi.mock('../src/composables/useBlobAttachmentCache', () => ({
  purgeAttachmentAccount: vi.fn(),
  purgeAttachmentLink: vi.fn(),
  purgeAttachmentMessage: vi.fn(),
  purgeAttachmentSession: vi.fn(),
  purgeExpiredAttachments: vi.fn(),
  useBlobAttachmentCache: () => ({ evictAttachmentCache: vi.fn() }),
}));
vi.mock('../src/composables/useArrivalBanner', () => ({ showArrivalBanner: vi.fn() }));
vi.mock('stores/links', () => ({
  useLinksStore: () => ({
    links: [],
    fetchLinks: vi.fn(async () => undefined),
    updateLinkUnreadCount: vi.fn(),
  }),
}));
// stores/vault.ts reaches the auth store as `./auth` once and as `stores/auth`
// inside actions, while utils/accountLifecycle.ts uses `../stores/auth` — the
// same file through the alias. The mocks below are only needed so that every
// specifier resolves through this module graph; the shared raw-state instance in
// the `defineStore` stub is what makes the login visible everywhere.
vi.mock('stores/auth', async () => await import('../src/stores/auth'));
vi.mock('../stores/auth', async () => await import('../src/stores/auth'));
vi.mock('stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: vi.fn() }),
}));

import { useAuthStore } from '../src/stores/auth';
import { useVaultStore } from '../src/stores/vault';
import { captureAccountOperation } from '../src/utils/accountLifecycle';

const PARTNER = { id: 'partner-device', devicePub: 'bb'.repeat(32) };

beforeEach(async () => {
  vi.clearAllMocks();
  const auth = useAuthStore() as unknown as Record<string, unknown>;
  Object.assign(auth, { user: { id: 'alice' }, isLoggedIn: true, authOperationGeneration: 0 });
  storage.get.mockResolvedValue(undefined);
  storage.set.mockResolvedValue(undefined);
  storage.keys.mockResolvedValue([]);
  vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  await sodium.ready;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CS-05 harness', () => {
  it('hands back raw state, so a plain transport keeps its identity', () => {
    const vault = useVaultStore() as unknown as Record<string, unknown>;
    const transport = { marker: 'raw' };
    vault.transport = transport;
    expect(vault.transport).toBe(transport);
    expect(captureAccountOperation().uid).toBe('alice');
  });
});

/** Store wired for sending; the engine hands out increasing message indexes. */
function sendVault() {
  const vault = useVaultStore() as ReturnType<typeof useVaultStore> & Record<string, any>;
  vault.deviceId = 'own-device';
  vault.isInitialized = true;
  vault.messageLoadState.link = 'ready';
  vault.messages.link = [];
  const sent: number[] = [];
  const transport = {
    ackMessage: vi.fn(),
    nackMessage: vi.fn(),
    isOpen: () => true,
    connect: async () => undefined,
    ensureConnected: async () => undefined,
    sendEncryptedPayloadToUser: vi.fn((_userId: string, frames: Array<{ messageIndex: number }>) => {
      frames.forEach((frame) => sent.push(frame.messageIndex));
    }),
  };
  vault.transport = transport;
  vault.ensureVaultTransport = vi.fn(async () => undefined);
  vault.loadChatSettings = vi.fn(async () => ({ mode: 'persistent', muted: true }));
  vault.inAppBannerEnabled = vi.fn(async () => false);
  vault.markLinkUnread = vi.fn();
  vault.noteLinkActivity = vi.fn();
  vault.persistMessages = vi.fn(async () => undefined);
  vault.persistEngineState = vi.fn(async () => undefined);
  // Real appendMessage needs a persistable, already-hydrated thread.
  vault.appendMessage = vault.appendMessage.bind(vault);
  let index = 0;
  vault.getEngine = vi.fn(async () => ({
    encryptFrame: vi.fn(async () => {
      const messageIndex = index;
      index += 1;
      return {
        ciphertext: new Uint8Array([messageIndex + 1]),
        nonce: new Uint8Array(24),
        senderDHRPub: new Uint8Array(32),
        messageIndex,
        PN: 0,
      };
    }),
  }));
  vault.getOwnVaultDevices = vi.fn(async () => []);
  return { vault, transport, sent };
}

describe('CS-05 send budget', () => {

  it('does not charge the rate budget for attempts rejected before delivery', async () => {
    const { vault } = sendVault();
    // 9 accepted sends...
    for (let i = 0; i < 9; i += 1) {
      await vault.sendMessage('link', 'bob', [PARTNER], `message ${i}`);
    }
    // ...plus 20 attempts that die before anything is encrypted or sent.
    for (let i = 0; i < 20; i += 1) {
      await expect(
        vault.sendMessage('link', 'bob', [], `rejected ${i}`),
      ).rejects.toThrow('NO_PARTNER_DEVICES');
    }
    expect(vault.sendBudgetEntries).toHaveLength(9);

    // The next accepted send must still fit into the 10-per-3s budget.
    await expect(vault.sendMessage('link', 'bob', [PARTNER], 'tenth')).resolves.toBeUndefined();
    expect(vault.sendBudgetEntries).toHaveLength(10);
  });

  it('still rate-limits the eleventh accepted send in the window', async () => {
    const { vault } = sendVault();
    // Ten sends inside one window are ACCEPTED; the eleventh is refused. Each
    // call gets its own thread, so this exercises the per-send rate limit and
    // not the per-link history append.
    // A fresh store: the budget is store state, and an earlier test in this file
    // may already have spent part of the window.
    vault.sendBudgetEntries = [];
    vault.rateLimitedUntil = null;
    for (let i = 0; i < 10; i += 1) {
      vault.messages[`link-${i}`] = [];
      vault.messageLoadState[`link-${i}`] = 'ready';
      await expect(vault.sendMessage(`link-${i}`, 'bob', [PARTNER], `message ${i}`)).resolves.toBeUndefined();
    }
    expect(vault.sendBudgetEntries).toHaveLength(10);
    vault.messages['link-eleven'] = [];
    vault.messageLoadState['link-eleven'] = 'ready';
    await expect(vault.sendMessage('link-eleven', 'bob', [PARTNER], 'eleven')).rejects.toThrow('RATE_LIMIT');
  });
});

describe('CS-05 delivered rows', () => {
  // The budget is per-store state and the previous describe fills its window.
  beforeEach(() => {
    const vault = useVaultStore() as unknown as Record<string, unknown>;
    vault.sendBudgetEntries = [];
    vault.rateLimitedUntil = null;
  });

  it('keeps a delivered row SENT when a post-send step throws', async () => {
    const { vault, transport, sent } = sendVault();
    // The mirroring step (own-device fan-out) fails AFTER the frame was handed
    // to the socket — the old code re-threw that and marked the row failed.
    vault.getOwnVaultDevices = vi.fn(async () => {
      throw new Error('device list unavailable');
    });

    await vault.sendMessage('link', 'bob', [PARTNER], 'delivered once');

    expect(transport.sendEncryptedPayloadToUser).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([0]);
    expect(vault.messages.link).toHaveLength(1);
    expect(vault.messages.link[0].status).toBe('SENT');
  });

  it('does not mark a delivered retry row FAILED when it is retried after delivery', async () => {
    const { vault, transport, sent } = sendVault();
    await vault.sendMessage('link', 'bob', [PARTNER], 'first', { localMessageId: 'local-1' });
    expect(vault.messages.link[0].status).toBe('SENT');

    // User retries the row that actually arrived: nothing new may be sent.
    await vault.sendMessage('link', 'bob', [PARTNER], 'first', {
      persistLocal: false,
      localMessageId: 'local-1',
    });

    expect(transport.sendEncryptedPayloadToUser).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([0]);
    expect(vault.messages.link).toHaveLength(1);
    expect(vault.messages.link[0].status).toBe('SENT');
  });

  it('refuses a duplicate send of an already-delivered row', async () => {
    const { vault, transport, sent } = sendVault();
    await vault.sendMessage('link', 'bob', [PARTNER], 'hello', { localMessageId: 'local-dup' });
    expect(vault.messages.link[0].status).toBe('SENT');
    const row = vault.messages.link[0];

    const result = await vault.sendMessage('link', 'bob', [PARTNER], 'hello again', {
      persistLocal: false,
      localMessageId: 'local-dup',
    });

    expect(result).toBeUndefined();
    expect(transport.sendEncryptedPayloadToUser).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([0]);
    expect(vault.messages.link).toHaveLength(1);
    expect(vault.messages.link[0]).toBe(row);
    expect(vault.messages.link[0].status).toBe('SENT');
    expect(vault.messages.link[0].plaintext).toBe('hello');
  });
});

describe('CS-05 retry of an undelivered build', () => {
  it('replays the frames the first attempt built instead of consuming new indexes', async () => {
    const { vault, transport, sent } = sendVault();
    // Every hand-off throws: the frame was built (and its ratchet index
    // persisted) but never reached the socket.
    transport.sendEncryptedPayloadToUser.mockImplementation(() => {
      throw new Error('WSS transport is not connected.');
    });
    let failure: unknown;
    try {
      await vault.sendMessage('link', 'bob', [PARTNER], 'same text', { localMessageId: 'local-draft' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(sent).toEqual([]);
    expect(vault.messages.link[0].status).toBe('FAILED_NETWORK');

    // Socket back: the retry must deliver the ORIGINAL frame.
    transport.sendEncryptedPayloadToUser.mockImplementation(
      (_userId: string, frames: Array<{ messageIndex: number }>) => {
        frames.forEach((frame) => sent.push(frame.messageIndex));
      },
    );
    await vault.sendMessage('link', 'bob', [PARTNER], 'same text', {
      persistLocal: false,
      localMessageId: 'local-draft',
    });

    // The retry re-delivered the ORIGINAL frame (index 0), not a new index 1.
    expect(sent).toEqual([0]);
    expect(vault.messages.link[0].status).toBe('SENT');
  });
});
