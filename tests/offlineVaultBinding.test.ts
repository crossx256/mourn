import { beforeEach, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';

const memory = vi.hoisted(() => new Map<string, string>());
vi.mock('../src/services/nativeSecureStorage', () => ({
  getSecureStorage: () => ({ get: async (key: string) => memory.get(key) ?? null, set: async (key: string, value: string) => { memory.set(key, value); } }),
}));
vi.mock('../src/utils/platform', () => ({ isCapacitorRuntime: () => true }));
import { encryptOfflineBlob, decryptOfflineBlob, resetOfflineKeyCache } from '../src/crypto/offlineVault';

beforeEach(async () => { await sodium.ready; resetOfflineKeyCache(); memory.clear(); });
describe('offline AEAD identity binding', () => {
  it('authenticates the account, record ID, metadata and timestamp', async () => {
    const context = { kind: 'archive', id: 'essay', accountId: 'alice' };
    const blob = await encryptOfflineBlob(new TextEncoder().encode('private content'), { title: 'essay' }, context);
    expect(new TextDecoder().decode(await decryptOfflineBlob(blob, context))).toBe('private content');
    await expect(decryptOfflineBlob(blob, { ...context, accountId: 'bob' })).rejects.toThrow();
    await expect(decryptOfflineBlob(blob, { ...context, id: 'other' })).rejects.toThrow();
    await expect(decryptOfflineBlob({ ...blob, meta: { title: 'substituted' } }, context)).rejects.toThrow();
    await expect(decryptOfflineBlob({ ...blob, savedAt: blob.savedAt + 1 }, context)).rejects.toThrow();
  });
  it('does not implicitly accept unauthenticated legacy context', async () => {
    const blob = await encryptOfflineBlob(new Uint8Array([1]));
    const { version: _version, ...legacy } = blob;
    await expect(decryptOfflineBlob(legacy)).rejects.toThrow('explicit compatibility migration');
  });
  it('fails closed on a corrupt existing secure-storage key', async () => {
    memory.set('offline_vault_key', sodium.to_base64(new Uint8Array([1, 2])));
    await expect(encryptOfflineBlob(new Uint8Array([1]))).rejects.toThrow('Corrupt offline vault key');
    expect(memory.get('offline_vault_key')).toBe(sodium.to_base64(new Uint8Array([1, 2])));
  });
});
