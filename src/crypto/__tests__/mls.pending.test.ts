import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: async (key: string) => storage.get(key),
  update: async (key: string, change: (value: unknown) => unknown) => { storage.set(key, change(storage.get(key))); },
  set: async (key: string, value: unknown) => { storage.set(key, value); },
  del: async (key: string) => { storage.delete(key); },
}));

import { MlsGroupClient } from '../mlsGroup';
import { bytesToB64, putPendingKeyPackage, getPendingKeyPackage, deletePendingKeyPackage } from '../mlsDb';

beforeEach(() => storage.clear());

it('pending key packages survive independent device writes and consumption', async () => {
  for (const deviceId of ['A', 'B']) {
    const pair = await MlsGroupClient.generateKeyPackagePair(deviceId);
    await putPendingKeyPackage('group', {
      publicPackageB64: pair.publicPackageB64,
      privatePackage: {
        initPrivateKey: bytesToB64(pair.privatePackage.initPrivateKey),
        hpkePrivateKey: bytesToB64(pair.privatePackage.hpkePrivateKey),
        signaturePrivateKey: bytesToB64(pair.privatePackage.signaturePrivateKey),
      },
    }, 'account', deviceId);
  }
  expect(await getPendingKeyPackage('group', 'account', 'A')).not.toBeNull();
  expect(await getPendingKeyPackage('group', 'account', 'B')).not.toBeNull();
  await deletePendingKeyPackage('group', 'account', 'A');
  expect(await getPendingKeyPackage('group', 'account', 'A')).toBeNull();
  expect(await getPendingKeyPackage('group', 'account', 'B')).not.toBeNull();
  expect(await getPendingKeyPackage('group', 'other-account', 'B')).toBeNull();
});
