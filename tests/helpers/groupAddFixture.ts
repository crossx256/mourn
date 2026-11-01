import { expect, vi } from 'vitest';
import { GroupCheckpointRepository, type GroupCheckpointPorts } from '../../src/crypto/groupCheckpointRepository';
import { bindGroupOperation } from '../../src/crypto/groupOperation';
import type { MlsGroupRecord } from '../../src/crypto/mlsDb';
import type { PreparedMlsAdd } from '../../src/crypto/groupCheckpoint';

export function fixture() {
  let current = true;
  const operation = bindGroupOperation({ uid: 'alice', generation: 1, isCurrent: () => current,
    assertCurrent: () => { if (!current) throw new Error('account superseded'); } }, () => 'owner-device', () => 0);
  let disk: MlsGroupRecord = { id: 'row', groupId: 'group', deviceId: 'owner-device', serialized: 'before-private',
    epoch: 1, cipherSuite: 'fixture', revision: '1', updatedAt: 1,
    checkpoint: { version: 1, messages: [{ id: 'kept' }], hiddenIds: ['hidden'], cursor: 'cursor' } };
  let revision = 1;
  const ports: GroupCheckpointPorts = {
    read: async () => structuredClone(disk),
    write: async (record, scope, expected) => {
      scope.assertCurrent();
      if (expected !== disk.revision) throw new Error('CAS conflict');
      disk = structuredClone({ ...record, revision: String(++revision), updatedAt: 1 });
      return disk.revision!;
    },
    legacyHistory: async () => [], legacyHidden: async () => [], legacyCursor: () => null,
  };
  const pending: PreparedMlsAdd = { version: 1, kind: 'add', phase: 'prepared', deviceId: 'owner-device',
    beforeSerialized: 'before-private', serialized: 'exact-successor-private', cipherSuite: 'fixture', epoch: 2,
    commit: 'exact-public-commit', welcome: 'exact-public-welcome',
    recipients: [{ userId: 'bob', deviceId: 'bob-device', status: 'pending' }] };
  const relay = {
    publish: vi.fn(async (commit: string, epoch: number) => {
      expect(disk.pendingAdd?.phase).toBe('publishing');
      expect(disk.pendingAdd?.serialized).toBe(pending.serialized);
      expect(disk.serialized).toBe('before-private');
      expect([commit, epoch]).toEqual([pending.commit, pending.epoch]);
    }),
    findPublished: vi.fn(async () => ({ currentEpoch: 2, commits: [{ epoch: 2, commit: pending.commit, senderDeviceId: pending.deviceId }] })),
    receipt: vi.fn(async (identity: Record<string, unknown>) => ({ ...identity, protocol: 'mourn-welcome-v1', status: 'absent' })),
    welcome: vi.fn(async (recipient: { userId: string; deviceId: string }, welcome: string, identity: Record<string, unknown>) => {
      expect(disk.serialized).toBe(pending.serialized);
      expect(disk.pendingAdd?.recipients.find(r => r.deviceId === recipient.deviceId)?.status).toBe('publishing');
      expect(welcome).toBe(pending.welcome);
      return { ...identity, protocol: 'mourn-welcome-v1', status: 'stored', deviceId: recipient.deviceId,
        senderDeviceId: pending.deviceId, memberId: 'member', publisherMemberId: 'publisher-member', replay: false };
    }),
  };
  return { operation, pending, ports, relay, repo: () => new GroupCheckpointRepository(ports),
    disk: () => structuredClone(disk), replace: (record: MlsGroupRecord) => { disk = record; }, invalidate: () => { current = false; } };
}
