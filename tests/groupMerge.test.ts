import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { GroupOperation } from '../src/crypto/groupOperation';
import type { MlsGroupRecord } from '../src/crypto/mlsDb';

const f = vi.hoisted(() => ({
  auth: { user: { id: 'alice' }, authOperationGeneration: 0, isLoggedIn: true, fetchCsrfToken: async () => {}, csrfToken: 'fixture' },
  generated: 0,
  deviceId: 'own-device',
  record: null as MlsGroupRecord | null,
}));
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => f.auth }));
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => f }));
vi.mock('../src/boot/axios', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('libsodium-wrappers', () => ({ default: {} }));
vi.mock('idb-keyval', () => ({ get: vi.fn() }));
vi.mock('../src/crypto/groupLocalVault', () => ({ encryptGroups: vi.fn(), decryptGroups: vi.fn() }));
vi.mock('../src/utils/notificationSound', () => ({ playNotificationSound: vi.fn() }));
vi.mock('../src/crypto/blobTransfer', () => ({ normalizeBlobAttachment: vi.fn() }));
vi.mock('../src/crypto/mlsDb', () => ({
  getGroupState: vi.fn(async () => structuredClone(f.record)),
  putGroupState: vi.fn(async (record: MlsGroupRecord, _uid: string, assertCurrent: () => void) => {
    assertCurrent();
    f.record = structuredClone({ ...record, revision: '2', updatedAt: 1 });
    return '2';
  }),
  putPendingKeyPackage: vi.fn(), getPendingKeyPackage: vi.fn(), deletePendingKeyPackage: vi.fn(),
  bytesToB64: vi.fn(), b64ToBytes: vi.fn(),
}));
vi.mock('../src/crypto/mlsGroup', () => {
  class Client {
    epoch = 1;
    ciphersuite = 'fixture';
    members = ['own-device'];
    static deserialize(serialized: string) {
      const client = new Client();
      if (serialized.startsWith('{')) Object.assign(client, JSON.parse(serialized));
      return client;
    }
    static cloneWithValidator(client: Client) { return Client.deserialize(client.serialize()); }
    static async decodeKeyPackage(encoded: string) {
      return { leafNode: { credential: { credentialType: 'basic', identity: new TextEncoder().encode(encoded) } } };
    }
    setAuthenticationService() {}
    listMemberDeviceIds() { return [...this.members]; }
    async addMember(packages: string | string[]) {
      f.generated++;
      this.members.push(...[packages].flat());
      this.epoch++;
      return { commitB64: 'exact-commit', welcomeB64: 'exact-welcome' };
    }
    serialize() { return this.epoch === 1 ? 'restored' : JSON.stringify({ epoch: this.epoch, members: this.members }); }
  }
  return {
    MlsGroupClient: Client, mlsCiphersuite: async () => ({}), makeCredentialValidator: () => ({}),
    mlsGroupIdBytes: vi.fn(), generateGroupSafetyNumber: vi.fn(),
  };
});

import { api } from '../src/boot/axios';
import { getGroupState } from '../src/crypto/mlsDb';
import { MlsGroupClient } from '../src/crypto/mlsGroup';
import { bindGroupOperation } from '../src/crypto/groupOperation';
import { captureAccountOperation } from '../src/utils/accountLifecycle';
import { useGroupStore } from '../src/stores/groupStore';

async function loadRestoredClient(store: ReturnType<typeof useGroupStore>): Promise<MlsGroupClient> {
  const deserialize = vi.spyOn(MlsGroupClient, 'deserialize');
  await expect(store.loadMlsClient('group')).resolves.toBe(true);
  expect(deserialize).toHaveBeenCalledTimes(1);
  const client: MlsGroupClient | undefined = deserialize.mock.results[0]?.value;
  if (!client) throw new Error('Expected the store to restore an MLS client');
  return client;
}

function savedState(): MlsGroupRecord {
  return {
    id: 'alice:group:own-device', groupId: 'group', deviceId: 'own-device', serialized: 'restored',
    epoch: 1, cipherSuite: 'fixture', revision: '1', updatedAt: 1,
    checkpoint: { version: 1, messages: [], hiddenIds: [], cursor: null },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  f.auth.user.id = 'alice';
  f.auth.authOperationGeneration++;
  f.deviceId = 'own-device';
  f.record = savedState();
  f.generated = 0;
  useGroupStore().reset();
  vi.mocked(api.get).mockResolvedValue({ data: { members: [{ deviceId: 'own-device', identityPub: '00' }] } });
  vi.spyOn(useGroupStore(), 'syncMlsCommits').mockResolvedValue();
  vi.spyOn(useGroupStore(), 'fetchHistory').mockResolvedValue();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  useGroupStore().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('manual retry evicts the scoped client and uses the same queue lease for restore and history', async () => {
  const store = useGroupStore();
  await store.loadMlsClient('group');
  store.activeGroupId = 'group';
  store.mlsState.group = 'unavailable';
  const deserialize = vi.spyOn(MlsGroupClient, 'deserialize');
  const load = vi.spyOn(store, 'loadMlsClient');
  expect(await store.retryMlsRestore()).toBe(true);
  expect(deserialize).toHaveBeenCalledTimes(1);
  const lease = load.mock.calls[0]?.[1];
  expect(lease?.uid).toBe('alice');
  expect(lease?.deviceId).toBe('own-device');
  expect(store.fetchHistory).toHaveBeenCalledWith('group', lease);
  expect(store.activeGroupMlsState).toBe('ready');
});

it('manual retry does not publish unavailable/history into a reset store', async () => {
  const store = useGroupStore();
  let finish!: (ready: boolean) => void;
  vi.spyOn(store, 'loadMlsClient').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const retry = store.retryMlsRestore('group');
  const rejected = expect(retry).rejects.toThrow('superseded');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  store.reset();
  finish(true);
  await rejected;
  expect(store.mlsState).toEqual({});
  expect(store.fetchHistory).not.toHaveBeenCalled();
});

it('manual retry rejects an account change before mutating availability', async () => {
  const store = useGroupStore();
  let finish!: (ready: boolean) => void;
  vi.spyOn(store, 'loadMlsClient').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const retry = store.retryMlsRestore('group');
  const rejected = expect(retry).rejects.toThrow('superseded');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  f.auth.user.id = 'bob';
  f.auth.authOperationGeneration++;
  finish(false);
  await rejected;
  expect(store.mlsState).toEqual({});
  expect(store.fetchHistory).not.toHaveBeenCalled();
});

it('open-group delayed retry keeps the original account/device scope', async () => {
  vi.useFakeTimers();
  const store = useGroupStore();
  vi.spyOn(store, 'fetchGroupDetails').mockResolvedValue(null);
  vi.spyOn(store, 'reconcileDepartedMembers').mockResolvedValue();
  vi.spyOn(store, 'reconcileMissingMembers').mockResolvedValue();
  const load = vi.spyOn(store, 'loadMlsClient').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  store.setActiveGroup('group');
  await vi.advanceTimersByTimeAsync(1200);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls[1]?.[1]).toBe(load.mock.calls[0]?.[1]);
  expect(store.activeGroupMlsState).toBe('ready');
  expect(store.fetchHistory).toHaveBeenCalledWith('group', load.mock.calls[0]?.[1]);
});

it('reset cancels the delayed open-group retry without acquiring a new scope', async () => {
  vi.useFakeTimers();
  const store = useGroupStore();
  vi.spyOn(store, 'fetchGroupDetails').mockResolvedValue(null);
  const load = vi.spyOn(store, 'loadMlsClient').mockResolvedValue(false);
  store.setActiveGroup('group');
  await vi.advanceTimersByTimeAsync(0);
  store.reset();
  await vi.advanceTimersByTimeAsync(1200);
  expect(load).toHaveBeenCalledTimes(1);
  expect(store.mlsState).toEqual({});
  expect(store.fetchHistory).not.toHaveBeenCalled();
});

it('a later successful restore clears unavailable without another manual retry', async () => {
  const store = useGroupStore();
  store.activeGroupId = 'group';
  store.mlsState.group = 'unavailable';
  await expect(store.loadMlsClient('group')).resolves.toBe(true);
  expect(getGroupState).toHaveBeenCalled();
  expect(store.activeGroupMlsState).toBe('ready');
  store.reset();
  expect(store.activeGroupMlsState).toBeNull();
  expect(store.mlsState).toEqual({});
});

it('a later restored-client checkpoint clears unavailable only after durable publication', async () => {
  const store = useGroupStore();
  const client = await loadRestoredClient(store);
  store.mlsState.group = 'unavailable';
  const operation = bindGroupOperation(captureAccountOperation(), () => f.deviceId, () => 0);
  await store.persistMls('group', f.deviceId, client, operation,
    { version: 1, messages: [], hiddenIds: [], cursor: null });
  expect(f.record?.serialized).toBe('restored');
  expect(store.mlsState.group).toBe('ready');
});

it.each(['single', 'batch'] as const)('routes %s Add through a durable outbox before any public mutation', async (kind) => {
  const store = useGroupStore();
  let epoch = 1;
  const published: Array<{ url: string; body: unknown; record: MlsGroupRecord | null }> = [];
  const welcomeHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode('exact-welcome'))), byte => byte.toString(16).padStart(2, '0')).join('');
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (String(url).endsWith('/mls/welcome/receipt')) return { data: {
      ...config?.params, epoch: Number(config?.params.epoch), groupId: 'group', protocol: 'mourn-welcome-v1', status: 'absent',
    } };
    if (String(url).includes('/mls/keypackage/')) return { data: { keyPackage: 'bob-device', deviceId: 'bob-device' } };
    if (String(url).endsWith('/mls/commits')) return { data: { currentEpoch: epoch,
      commits: epoch === 2 ? [{ epoch, commit: 'exact-commit', senderDeviceId: 'own-device' }] : [] } };
    return { data: { members: [{ userId: 'alice', deviceId: 'own-device', identityPub: '00', role: 'OWNER' }] } };
  });
  vi.mocked(api.post).mockImplementation(async (url, body) => {
    published.push({ url: String(url), body, record: structuredClone(f.record) });
    if (String(url).endsWith('/mls/commit')) epoch = 2;
    if (String(url).endsWith('/mls/welcome')) return { data: {
      ...body, groupId: 'group', protocol: 'mourn-welcome-v1', status: 'stored', deviceId: 'bob-device',
      senderDeviceId: 'own-device', memberId: 'bob-member', publisherMemberId: 'owner-member', replay: false, welcomeHash,
    } };
    return { data: { status: 'stored' } };
  });
  if (kind === 'single') await store.ownerAddMember('group', 'bob', 'bob-device');
  else await store.ownerAddMembers('group', [{ userId: 'bob', deviceId: 'bob-device', keyPackageB64: 'bob-device' }]);
  const commit = published.find(call => call.url.endsWith('/mls/commit'));
  expect(commit?.record?.serialized).toBe('restored');
  expect(commit?.record?.pendingAdd).toMatchObject({ phase: 'publishing', beforeSerialized: 'restored',
    commit: 'exact-commit', welcome: 'exact-welcome', epoch: 2,
    recipients: [{ userId: 'bob', deviceId: 'bob-device', status: 'pending' }] });
  expect(commit?.record?.pendingAdd?.serialized).toContain('bob-device');
  const welcome = published.find(call => call.url.endsWith('/mls/welcome'));
  expect(welcome?.record?.pendingAdd?.recipients[0]?.status).toBe('publishing');
  expect(welcome?.body).toEqual({ inviteeId: 'bob', inviteeDeviceId: 'bob-device', welcomeBlob: 'exact-welcome',
      epoch: 2, commitHash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode('exact-commit'))), byte => byte.toString(16).padStart(2, '0')).join('') });
  expect(f.record?.pendingAdd).toBeUndefined();
  expect(f.generated).toBe(1);
  expect(commit?.body).toEqual({ commit: 'exact-commit', epoch: 2 });
});

it('preserves unavailable if durable restored-client checkpoint publication fails', async () => {
  const store = useGroupStore();
  const client = await loadRestoredClient(store);
  store.mlsState.group = 'unavailable';
  const operation: GroupOperation = bindGroupOperation(captureAccountOperation(), () => f.deviceId, () => 0);
  const { putGroupState } = await import('../src/crypto/mlsDb');
  vi.mocked(putGroupState).mockRejectedValueOnce(new Error('disk failure'));
  await expect(store.persistMls('group', f.deviceId, client, operation,
    { version: 1, messages: [], hiddenIds: [], cursor: null })).rejects.toThrow('disk failure');
  expect(store.mlsState.group).toBe('unavailable');
});
