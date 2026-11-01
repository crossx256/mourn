import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { MlsGroupRecord } from '../src/crypto/mlsDb';

const f = vi.hoisted(() => ({ record: null as MlsGroupRecord | null, failWrite: false, failure: null as 'cas' | 'lost-ack' | null, after: [] as Array<string | undefined> }));
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => ({ deviceId: 'own-device' }) }));
vi.mock('../src/crypto/mlsDb', () => ({
  getGroupState: async () => structuredClone(f.record),
  putGroupState: async (record: MlsGroupRecord, _uid: string, assertCurrent: () => void, revision: string | null) => {
    assertCurrent();
    if (f.failWrite) throw new Error('checkpoint disk failure');
    if (f.failure === 'cas') {
      f.failure = null;
      f.record = structuredClone({ ...record, serialized: '8', revision: '2', updatedAt: 1 });
      throw new Error('conflicting writer');
    }
    if (revision !== f.record?.revision) throw new Error('conflicting writer');
    const next = String(Number(revision) + 1);
    f.record = structuredClone({ ...record, revision: next, updatedAt: 1 });
    if (f.failure === 'lost-ack') { f.failure = null; throw new Error('write acknowledgement lost'); }
    return next;
  },
  putPendingKeyPackage: vi.fn(), getPendingKeyPackage: vi.fn(), deletePendingKeyPackage: vi.fn(), bytesToB64: vi.fn(), b64ToBytes: vi.fn(),
}));
vi.mock('../src/crypto/mlsGroup', () => {
  class Client {
    epoch = 1;
    ciphersuite = 'fixture';
    constructor(public received: number) {}
    static deserialize(serialized: string) { return new Client(Number(serialized)); }
    static cloneWithValidator(client: Client) { return new Client(client.received); }
    serialize() { return String(this.received); }
    async decrypt(ciphertext: string) { this.received++; return ciphertext; }
  }
  return { MlsGroupClient: Client, mlsCiphersuite: async () => ({}), makeCredentialValidator: () => ({}), mlsGroupIdBytes: vi.fn(), generateGroupSafetyNumber: vi.fn() };
});
import { api } from '../src/boot/axios';
import { useAuthStore } from '../src/stores/auth';
import { useGroupStore } from '../src/stores/groupStore';

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(useAuthStore(), { user: { id: 'alice' }, isLoggedIn: true });
  vi.stubGlobal('localStorage', { getItem: () => null, removeItem: vi.fn(), setItem: vi.fn() });
  useGroupStore().reset();
  f.failWrite = false; f.failure = null; f.after = [];
  f.record = { id: 'alice:group:own-device', groupId: 'group', deviceId: 'own-device', serialized: '0', epoch: 1, cipherSuite: 'fixture', revision: '1', updatedAt: 1,
    checkpoint: { version: 1, messages: [], hiddenIds: [], cursor: 'm1' } };
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    const route = String(url);
    if (route.endsWith('/active-members')) return { data: { members: [{ deviceId: 'peer', identityPub: '00' }] } };
    if (route.endsWith('/mls/commits')) return { data: { currentEpoch: 1, commits: [] } };
    if (route.endsWith('/messages')) {
      const after = config?.params?.after as string | undefined;
      f.after.push(after);
      return { data: { messages: (after === 'm1' ? [2, 3, 4] : after === 'm4' ? [5] : []).map(i => ({ id: 'm' + i, senderId: 'bob', senderDeviceId: 'peer', epoch: 1, ciphertext: JSON.stringify({ v: 1, type: 'message', id: 'plain' + i, text: 'message ' + i }), createdAt: '2026-01-01T00:00:00Z' })) } };
    }
    throw new Error('Unexpected fixture route');
  });
});
afterEach(() => { useGroupStore().reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses ordered catch-up for a realtime m4 hint without skipping unseen m2 and m3', async () => {
  const store = useGroupStore();
  store.activeGroupId = 'group';
  await store.applyIncomingGroupMessage({ groupId: 'group', messageId: 'm4', senderId: 'bob', senderDeviceId: 'peer', ciphertext: 'hint-only', epoch: 1, createdAt: '2026-01-01T00:00:00Z' });
  expect(f.after[0]).toBe('m1');
  expect(store.messages.group.map(message => message.id)).toEqual(['plain2', 'plain3', 'plain4']);
  expect(f.record?.serialized).toBe('3');
  expect(f.record?.checkpoint?.cursor).toBe('m4');
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it.each(['cas', 'lost-ack'] as const)('reloads the ratchet and matching cursor on retry after %s without a store reset', async (failure) => {
  const store = useGroupStore();
  f.failure = failure;
  await expect(store.fetchHistory('group')).rejects.toThrow(failure === 'cas' ? 'conflicting writer' : 'acknowledgement lost');
  expect(f.record?.checkpoint?.cursor).toBe('m4');
  expect(f.record?.serialized).toBe(failure === 'cas' ? '8' : '3');
  await store.fetchHistory('group');
  expect(f.after).toEqual(['m1', 'm4']);
  expect(f.record?.serialized).toBe(failure === 'cas' ? '9' : '4');
  expect(f.record?.checkpoint?.cursor).toBe('m5');
  expect(store.messages.group.map(message => message.id)).toEqual(['plain2', 'plain3', 'plain4', 'plain5']);
  expect(f.record?.checkpoint?.messages).toEqual(store.messages.group);
});

it('does not publish advanced live state/history/cursor when checkpoint persistence fails', async () => {
  const store = useGroupStore();
  f.failWrite = true;
  await expect(store.fetchHistory('group')).rejects.toThrow('checkpoint disk failure');
  expect(store.messages.group).toEqual([]);
  expect(f.record?.serialized).toBe('0');
  expect(f.record?.checkpoint?.cursor).toBe('m1');
  expect(f.record?.checkpoint?.messages).toEqual([]);
});
