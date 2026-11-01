import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sodium from 'libsodium-wrappers';

const f = vi.hoisted(() => ({ blobs: new Map<string, unknown>(), secrets: new Map<string, string>() }));
vi.mock('idb-keyval', () => ({
  get: async (key: string) => f.blobs.get(key),
  set: async (key: string, value: unknown) => { f.blobs.set(key, value); },
  del: async (key: string) => { f.blobs.delete(key); },
  keys: async () => [...f.blobs.keys()],
  update: vi.fn(),
}));
vi.mock('../src/services/nativeSecureStorage', () => ({ getSecureStorage: () => ({ get: async (key: string) => f.secrets.get(key) ?? null, set: async (key: string, value: string) => { f.secrets.set(key, value); } }) }));
vi.mock('../src/utils/platform', async original => ({ ...await original<typeof import('../src/utils/platform')>(), isCapacitorRuntime: () => true }));
import { storeOfflineBlob, readOfflineBlob, removeOfflineBlob, clearOfflineBlobsForUser, resetOfflineKeyCache } from '../src/crypto/offlineVault';
import { useAuthStore } from '../src/stores/auth';
import { useArchivesStore } from '../src/stores/archives';
import { api } from '../src/boot/axios';

function account(id: string) { const auth = useAuthStore(); Object.assign(auth, { user: { id }, isLoggedIn: true, authOperationGeneration: auth.authOperationGeneration + 1 }); }
beforeEach(async () => {
  setActivePinia(createPinia()); f.blobs.clear(); f.secrets.clear(); resetOfflineKeyCache();
  await sodium.ready; account('alice');
});
afterEach(() => vi.restoreAllMocks());

describe('offline account ownership', () => {
  it('partitions identical record IDs across accounts and scopes removals', async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    await storeOfflineBlob('archive', 'same', encode('alice data'));
    account('bob');
    expect(await readOfflineBlob('archive', 'same')).toBeUndefined();
    await storeOfflineBlob('archive', 'same', encode('bob data'));
    expect(new TextDecoder().decode(await readOfflineBlob('archive', 'same'))).toBe('bob data');
    await removeOfflineBlob('archive', 'same');
    account('alice');
    expect(new TextDecoder().decode(await readOfflineBlob('archive', 'same'))).toBe('alice data');
  });
  it('wipes explicit account tuples, preserving other accounts and unowned legacy evidence', async () => {
    const bytes = new Uint8Array([1]);
    for (const kind of ['archive', 'messaging', 'dashboard', 'graveyard'] as const) {
      await storeOfflineBlob(kind, 'same', bytes);
      await storeOfflineBlob(kind, 'same', bytes, undefined, { kind, id: 'same', accountId: 'bob' });
    }
    f.blobs.set('offline_archive:legacy', 'retained');
    await clearOfflineBlobsForUser('alice');
    expect([...f.blobs.keys()].filter(key => key.includes('["alice",'))).toEqual([]);
    expect([...f.blobs.keys()].filter(key => key.includes('["bob",'))).toHaveLength(4);
    expect(f.blobs.get('offline_archive:legacy')).toBe('retained');
  });
  it('does not cache a private archive response under the account selected after its request', async () => {
    let finish!: (response: unknown) => void;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = useArchivesStore();
    const save = store.saveArchiveOffline('private');
    account('bob');
    finish({ data: { success: true, data: { archive: { id: 'private', slug: 'private', title: 'Alice private archive' } } } });
    expect((await save).success).toBe(false);
    expect(f.blobs.size).toBe(0);
    expect(store.offlineSlugs).toEqual([]);
  });
});
