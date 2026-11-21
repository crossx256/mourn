import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sodium from 'libsodium-wrappers';
import type { MlsGroupRecord, PendingKeyPackageRecord } from '../src/crypto/mlsDb';

const fixture = vi.hoisted(() => ({
  record: null as MlsGroupRecord | null,
  pending: null as PendingKeyPackageRecord | null,
  writes: [] as number[],
  auth: { user: { id: 'invitee' }, isLoggedIn: true, authOperationGeneration: 0 },
}));
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => fixture.auth }));
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => ({ deviceId: 'invitee-device' }) }));
vi.mock('../src/boot/axios', () => ({ api: { get: vi.fn() } }));
vi.mock('idb-keyval', () => ({ get: vi.fn() }));
vi.mock('../src/crypto/groupLocalVault', () => ({ encryptGroups: vi.fn(), decryptGroups: vi.fn() }));
vi.mock('../src/utils/notificationSound', () => ({ playNotificationSound: vi.fn() }));
vi.mock('../src/crypto/mlsDb', () => ({
  getGroupState: async () => structuredClone(fixture.record),
  putGroupState: async (record: MlsGroupRecord, _uid: string, check: () => void, base: string | null) => {
    check();
    expect(base).toBe(fixture.record?.revision ?? null);
    const revision = crypto.randomUUID();
    fixture.record = structuredClone({ ...record, revision });
    fixture.writes.push(record.epoch);
    return revision;
  },
  getPendingKeyPackage: async () => fixture.pending,
  deletePendingKeyPackage: async () => { fixture.pending = null; },
  b64ToBytes: (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64')),
  bytesToB64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
}));
import { api } from '../src/boot/axios';
import { MlsGroupClient, makeCredentialValidator, mlsGroupIdBytes } from '../src/crypto/mlsGroup';
import { useGroupStore } from '../src/stores/groupStore';

afterEach(() => { useGroupStore().reset(); vi.unstubAllGlobals(); });

it('restores a fresh invitee via HTTP only, checkpoints the Welcome epoch, and decrypts after ordered replay', async () => {
  setActivePinia(createPinia());
  vi.stubGlobal('localStorage', { getItem: () => null });
  await sodium.ready;
  const groupId = 'suite';
  const devices = ['owner-device', 'invitee-device', 'later-device'];
  const keys = devices.map(() => sodium.crypto_sign_keypair());
  const members = devices.map((deviceId, index) => ({ deviceId, identityPub: sodium.to_hex(keys[index]!.publicKey) }));
  const identity = (index: number) => ({ publicKey: keys[index]!.publicKey, signKey: keys[index]!.privateKey });
  const validator = makeCredentialValidator(new Map(members.map(({ deviceId, identityPub }) => [deviceId, identityPub])));
  const owner = (await MlsGroupClient.create(mlsGroupIdBytes(groupId), devices[0], identity(0), validator)).client;
  const invited = await MlsGroupClient.generateKeyPackagePair(devices[1]!, identity(1));
  fixture.pending = {
    publicPackageB64: invited.publicPackageB64,
    privatePackage: {
      hpkePrivateKey: Buffer.from(invited.privatePackage.hpkePrivateKey).toString('base64'),
      initPrivateKey: Buffer.from(invited.privatePackage.initPrivateKey).toString('base64'),
      signaturePrivateKey: Buffer.from(invited.privatePackage.signaturePrivateKey).toString('base64'),
    },
  };
  const { welcomeB64 } = await owner.addMember(invited.publicPackageB64);
  expect(owner.epoch).toBe(1);
  const later = await MlsGroupClient.generateKeyPackagePair(devices[2]!, identity(2));
  const laterAdd = await owner.addMember(later.publicPackageB64);
  expect(owner.epoch).toBe(2);
  const ciphertext = await owner.encrypt(JSON.stringify({ v: 1, type: 'message', id: 'message', text: 'after onboarding' }));
  const replayStarts: number[] = [];
  vi.mocked(api.get).mockImplementation(async (url, options) => {
    const route = String(url);
    if (route.endsWith('/mls/welcome')) return { data: { welcomeBlob: welcomeB64 } };
    if (route.endsWith('/mls/active-members')) return { data: { members } };
    if (route.endsWith('/mls/commits')) {
      const afterEpoch = Number(options?.params.afterEpoch);
      replayStarts.push(afterEpoch);
      return { data: { currentEpoch: 2, commits: afterEpoch < 2 ? [{ epoch: 2, commit: laterAdd.commitB64, senderDeviceId: devices[0] }] : [] } };
    }
    if (route.endsWith('/messages')) return { data: { messages: [{ id: 'server-message', senderId: 'owner', senderDeviceId: devices[0], epoch: 2, ciphertext, createdAt: '2026-01-01T00:00:00Z' }] } };
    throw new Error(`Unexpected route: ${url}`);
  });

  const store = useGroupStore();
  expect(fixture.record).toBeNull();
  expect(await store.retryMlsRestore(groupId)).toBe(true);
  expect(store.mlsState[groupId]).toBe('ready');
  expect(fixture.pending).toBeNull();
  expect(replayStarts[0]).toBe(1);
  expect(fixture.writes).toEqual([1, 2, 2]);
  expect(store.messages[groupId]?.map(message => message.content)).toEqual(['after onboarding']);
});
