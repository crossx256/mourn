import { beforeEach, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
import type { RatchetState } from '../src/crypto/types';

const memory = vi.hoisted(() => ({ blobs: new Map<string, unknown>(), secrets: new Map<string, string>() }));
vi.mock('idb-keyval', () => ({
  get: async (key: string) => memory.blobs.get(key),
  set: async (key: string, value: unknown) => { memory.blobs.set(key, value); },
  del: async (key: string) => { memory.blobs.delete(key); },
  keys: async () => [...memory.blobs.keys()],
  update: async (key: string, updater: (value: unknown) => unknown) => {
    memory.blobs.set(key, updater(memory.blobs.get(key)));
  },
}));
vi.mock('../src/services/nativeSecureStorage', () => ({
  getSecureStorage: () => ({
    get: async (key: string) => memory.secrets.get(key) ?? null,
    set: async (key: string, value: string) => { memory.secrets.set(key, value); },
  }),
}));
vi.mock('../src/utils/platform', () => ({ isCapacitorRuntime: () => true }));
import {
  getEncryptedRatchetState, setEncryptedRatchetState, storeOfflineBlob,
  migrateOfflineBlob, resetOfflineKeyCache,
} from '../src/crypto/offlineVault';

const scope = { accountId: 'alice', deviceId: 'alice-device', sessionId: 'link_bob-device' };
const context = {
  kind: 'messaging',
  id: JSON.stringify(['ratchet-v1', scope.accountId, scope.deviceId, scope.sessionId]),
  accountId: scope.accountId,
};

function state(): RatchetState {
  const privateKey = sodium.randombytes_buf(32);
  return {
    version: 4,
    RK_hex: sodium.to_hex(sodium.randombytes_buf(32)),
    DHs_pubHex: sodium.to_hex(sodium.crypto_scalarmult_base(privateKey)),
    DHs_privHex: sodium.to_hex(privateKey),
    DHr_pubHex: null, CKs_hex: null, CKr_hex: null,
    Ns: 0, Nr: 0, PN: 0, MKSKIPPED: [],
    devicePubBinding: {
      myDevicePubHex: '11'.repeat(32), theirDevicePubHex: '22'.repeat(32), bindingTime: 123456789,
    },
  };
}

beforeEach(async () => {
  await sodium.ready;
  memory.blobs.clear();
  memory.secrets.clear();
  resetOfflineKeyCache();
});

describe('encrypted ratchet device binding persistence', () => {
  it('preserves binding through encrypted writes and repeated reads without retaining caller references', async () => {
    const original = state();
    const expected = structuredClone(original);
    await setEncryptedRatchetState(scope, original);
    original.devicePubBinding!.bindingTime++;
    const restored = await getEncryptedRatchetState(scope);
    expect(restored).toEqual(expected);
    expect(restored!.devicePubBinding).not.toBe(original.devicePubBinding);
    restored!.devicePubBinding!.myDevicePubHex = '33'.repeat(32);
    expect(await getEncryptedRatchetState(scope)).toEqual(expected);
    expect(JSON.stringify([...memory.blobs.values()])).not.toContain('devicePubBinding');
  });

  it('preserves binding when reading an existing encrypted record independently of the setter', async () => {
    const original = state();
    await storeOfflineBlob('messaging', context.id, sodium.from_string(JSON.stringify(original)), undefined, context);
    expect(await getEncryptedRatchetState(scope)).toEqual(original);
  });

  it('preserves binding when a legacy plaintext state is handed off to encrypted persistence', async () => {
    const legacyKey = 'vault_ratchet_v4_' + scope.sessionId + '_uid_' + scope.accountId;
    const original = state();
    memory.blobs.set(legacyKey, { state: original });
    const legacy = memory.blobs.get(legacyKey) as { state: RatchetState };
    await setEncryptedRatchetState(scope, legacy.state);
    expect(await getEncryptedRatchetState(scope)).toEqual(original);
    expect(memory.blobs.get(legacyKey)).toEqual({ state: original });
  });

  it('preserves binding when explicitly migrating a legacy encrypted blob', async () => {
    const original = state();
    const key = sodium.randombytes_buf(32);
    memory.secrets.set('offline_vault_key', sodium.to_base64(key));
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const legacy = {
      ciphertextB64: sodium.to_base64(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        sodium.from_string(JSON.stringify(original)), null, null, nonce, key,
      )),
      nonceB64: sodium.to_base64(nonce), savedAt: 123,
    };
    const legacyKey = 'offline_messaging:' + context.id;
    memory.blobs.set(legacyKey, legacy);
    expect(await migrateOfflineBlob('messaging', context.id, bytes => {
      return JSON.stringify(JSON.parse(sodium.to_string(bytes))) === JSON.stringify(original);
    }, context)).toBe(true);
    expect(await getEncryptedRatchetState(scope)).toEqual(original);
    expect(memory.blobs.get(legacyKey)).toBe(legacy);
  });

  it('keeps binding absent for states that never had one', async () => {
    const original = state();
    delete original.devicePubBinding;
    await setEncryptedRatchetState(scope, original);
    const restored = await getEncryptedRatchetState(scope);
    expect(restored).toEqual(original);
    expect(restored).not.toHaveProperty('devicePubBinding');
  });

  const malformedBindings = [
    null, {}, 'invalid',
    { myDevicePubHex: '11'.repeat(31), theirDevicePubHex: '22'.repeat(32), bindingTime: 1 },
    { myDevicePubHex: '11'.repeat(32), theirDevicePubHex: 'GG'.repeat(32), bindingTime: 1 },
    { myDevicePubHex: '11'.repeat(32), theirDevicePubHex: '22'.repeat(32), bindingTime: -1 },
    { myDevicePubHex: '11'.repeat(32), theirDevicePubHex: '22'.repeat(32), bindingTime: 1.5 },
    { myDevicePubHex: '11'.repeat(32), theirDevicePubHex: '22'.repeat(32), bindingTime: '1' },
    { myDevicePubHex: '11'.repeat(32), theirDevicePubHex: '22'.repeat(32), bindingTime: Number.MAX_SAFE_INTEGER + 1 },
  ];

  it.each(malformedBindings)('rejects malformed binding on write without replacing existing state: %j', async binding => {
    const original = state();
    await setEncryptedRatchetState(scope, original);
    const stored = [...memory.blobs.entries()];
    const malformed = { ...original, devicePubBinding: binding } as unknown as RatchetState;
    await expect(setEncryptedRatchetState(scope, malformed)).rejects.toThrow();
    expect([...memory.blobs.entries()]).toEqual(stored);
    expect(await getEncryptedRatchetState(scope)).toEqual(original);
  });

  it.each(malformedBindings)('rejects malformed binding in encrypted storage without erasing evidence: %j', async binding => {
    const malformed = { ...state(), devicePubBinding: binding };
    await storeOfflineBlob('messaging', context.id, sodium.from_string(JSON.stringify(malformed)), undefined, context);
    const stored = [...memory.blobs.entries()];
    await expect(getEncryptedRatchetState(scope)).rejects.toThrow();
    expect([...memory.blobs.entries()]).toEqual(stored);
  });
});
