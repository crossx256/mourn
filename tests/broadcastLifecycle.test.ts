import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const f = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), unwrap: vi.fn(), decrypt: vi.fn() }));
vi.mock('../src/crypto/broadcastLocalVault', () => ({ loadBroadcastHistory: f.load, saveBroadcastHistory: f.save }));
vi.mock('../src/crypto/broadcast', () => ({ unwrapChannelKeyGrant: f.unwrap, broadcastDecrypt: f.decrypt, broadcastEncrypt: vi.fn() }));
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => ({ keyManager: { getStoredKey: async () => new Uint8Array(32) } }) }));
import { api } from '../src/boot/axios';
import { useAuthStore } from '../src/stores/auth';
import { getActiveChannelKey, useBroadcastStore } from '../src/stores/broadcastStore';

beforeEach(() => {
  vi.clearAllMocks(); setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
  useBroadcastStore().clearState();
});
afterEach(() => { useBroadcastStore().clearState(); vi.restoreAllMocks(); });

it('does not merge a delayed account A cached history into account B', async () => {
  let finish!: (value: unknown[]) => void;
  f.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const store = useBroadcastStore();
  const loading = store.hydrateCachedHistory();
  Object.assign(useAuthStore(), { user: { id: 'bob' }, authOperationGeneration: 1 });
  store.clearState();
  finish([{ id: 'private', text: 'alice history' }]);
  await expect(loading).rejects.toThrow('superseded');
  expect(store.messages).toEqual([]);
  expect(f.save).not.toHaveBeenCalled();
});

it('cannot publish stale decrypted history or clear the new account key after a switch', async () => {
  const auth = useAuthStore(), store = useBroadcastStore();
  vi.spyOn(auth, 'fetchCsrfToken').mockResolvedValue(undefined);
  vi.spyOn(api, 'post').mockResolvedValue({ data: { keyVersion: 1, encryptedKey: 'opaque', nonce: 'nonce', senderPub: 'public' } });
  vi.spyOn(api, 'get').mockImplementation(async url => ({ data: String(url).endsWith('/messages') ? { keyVersion: 1, messages: [{ id: 'private', senderId: 'peer', ciphertext: 'opaque', nonce: 'nonce', keyVersion: 1, createdAt: '2026-01-01T00:00:00Z' }] } : { id: 'channel', slug: 'mourn-announcements', keyVersion: 1, muted: false, role: 'MEMBER' } }));
  f.unwrap.mockResolvedValueOnce(new Uint8Array(32).fill(1)).mockResolvedValueOnce(new Uint8Array(32).fill(2));
  expect(await store.unlock()).toBe(true);
  let finish!: (plaintext: string) => void;
  f.decrypt.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const history = store.loadHistory();
  await vi.waitFor(() => expect(f.decrypt).toHaveBeenCalledOnce());
  Object.assign(auth, { user: { id: 'bob' }, authOperationGeneration: 1 });
  store.clearState();
  expect(await store.unlock()).toBe(true);
  finish('alice secret');
  await expect(history).rejects.toThrow('superseded');
  expect(store.messages).toEqual([]);
  expect(store.unlocked).toBe(true);
  expect(getActiveChannelKey()).toEqual(new Uint8Array(32).fill(2));
  expect(f.save).not.toHaveBeenCalled();
});
