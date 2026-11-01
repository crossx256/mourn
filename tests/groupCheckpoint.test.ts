import { describe, expect, it, vi } from 'vitest';
import { bindGroupOperation, withGroupOperation, type GroupOperation } from '../src/crypto/groupOperation';
import { GroupCheckpointRepository, type GroupCheckpointPorts } from '../src/crypto/groupCheckpointRepository';
import { publishGroupCheckpoint, type PreparedMlsRemoval } from '../src/crypto/groupCheckpoint';
import type { MlsGroupRecord } from '../src/crypto/mlsDb';

function operationFixture() {
  const account = { uid: 'alice', generation: 0, isCurrent: () => account.generation === 0, assertCurrent: () => { if (!account.isCurrent()) throw new Error('account superseded'); } };
  let device: string | null = 'device-a';
  let reset = 0;
  return { account, capture: () => bindGroupOperation(account, () => device, () => reset), changeDevice: () => { device = 'device-b'; }, reset: () => { reset++; } };
}
function repositoryFixture() {
  const disk = new Map<string, MlsGroupRecord>();
  let revision = 0;
  let failBefore = false;
  let loseResponse = false;
  const ports: GroupCheckpointPorts = {
    read: async (groupId) => structuredClone(disk.get(groupId) ?? null),
    write: async (record, operation, expected) => {
      operation.assertCurrent();
      if ((disk.get(record.groupId)?.revision ?? null) !== expected) throw new Error('checkpoint conflict');
      if (failBefore) throw new Error('disk failure before transaction');
      const next = String(++revision);
      disk.set(record.groupId, structuredClone({ ...record, revision: next, updatedAt: 1 }));
      if (loseResponse) throw new Error('process interrupted after commit');
      return next;
    },
    legacyHistory: async () => [{ id: 'old' }], legacyHidden: async () => [], legacyCursor: () => 'm1',
  };
  return { disk, ports, repo: () => new GroupCheckpointRepository(ports), fail: () => { failBefore = true; }, interrupt: () => { loseResponse = true; } };
}
const state = { serialized: 'state-before', epoch: 1, cipherSuite: 'test-suite' };
const history = { version: 1 as const, messages: [{ id: 'old' }], hiddenIds: [], cursor: 'm1' };
const prepared: PreparedMlsRemoval = { version: 1, kind: 'remove', phase: 'prepared', deviceId: 'device-a', removedDeviceId: 'device-b', beforeSerialized: state.serialized, serialized: 'state-after', cipherSuite: state.cipherSuite, epoch: 2, commit: 'exact-opaque-commit' };

describe('account/device-scoped group queue', () => {
  it('rejects stale queued work before it obtains a lease, including same-account relogin', async () => {
    const f = operationFixture();
    let finish!: () => void;
    const first = withGroupOperation(f.capture(), 'group', async () => new Promise<void>(resolve => { finish = resolve; }));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const work = vi.fn();
    const second = withGroupOperation(f.capture(), 'group', work);
    f.account.generation++;
    finish();
    await first;
    await expect(second).rejects.toThrow('superseded');
    expect(work).not.toHaveBeenCalled();
  });
  it('allows awaited nesting without deadlock and invalidates expired leases', async () => {
    const f = operationFixture();
    let saved!: GroupOperation;
    await withGroupOperation(f.capture(), 'group', async lease => {
      saved = lease;
      expect(await withGroupOperation(lease, 'group', async () => 7)).toBe(7);
    });
    expect(() => saved.assertCurrent()).toThrow('expired');
  });
  it('rejects responses after a device change or store reset', async () => {
    for (const change of ['changeDevice', 'reset'] as const) {
      const f = operationFixture();
      const operation = f.capture();
      let finish!: () => void;
      const work = operation.wait(() => new Promise<void>(resolve => { finish = resolve; }));
      f[change](); finish();
      await expect(work).rejects.toThrow('superseded');
    }
  });
});

describe('single-row MLS history checkpoints', () => {
  it('keeps old state/history/cursor together when persistence fails before committing', async () => {
    const f = repositoryFixture(), operation = operationFixture().capture(), repo = f.repo();
    await repo.checkpoint('group', state, history, operation);
    f.fail();
    const promote = vi.fn();
    await expect(publishGroupCheckpoint(operation.assertCurrent, () => repo.checkpoint('group', { ...state, serialized: 'advanced' }, { ...history, messages: [{ id: 'new' }], cursor: 'm2' }, operation), promote)).rejects.toThrow('disk failure');
    expect(promote).not.toHaveBeenCalled();
    const restored = await f.repo().load('group', operation);
    expect(restored?.serialized).toBe('state-before');
    expect(restored?.checkpoint).toEqual(history);
  });
  it('recovers the whole committed checkpoint after an interrupted acknowledgement', async () => {
    const f = repositoryFixture(), operation = operationFixture().capture(), repo = f.repo();
    await repo.checkpoint('group', state, history, operation);
    f.interrupt();
    const next = { ...history, cursor: 'm2', messages: [{ id: 'old' }, { id: 'new' }] };
    await expect(repo.checkpoint('group', { ...state, serialized: 'advanced' }, next, operation)).rejects.toThrow('interrupted');
    const restored = await f.repo().load('group', operation);
    expect(restored?.serialized).toBe('advanced');
    expect(restored?.checkpoint).toEqual(next);
  });
  it('does not overwrite a checkpoint advanced by a second window', async () => {
    const f = repositoryFixture(), operation = operationFixture().capture(), a = f.repo(), b = f.repo();
    await a.checkpoint('group', state, history, operation);
    await b.load('group', operation);
    await a.checkpoint('group', { ...state, epoch: 2 }, history, operation);
    await expect(b.checkpoint('group', state, history, operation)).rejects.toThrow('conflict');
    expect(f.disk.get('group')?.epoch).toBe(2);
  });
  it('rejects a stale derivation after failure and reload instead of rebasing it onto the new revision', async () => {
    const f = repositoryFixture(), operation = operationFixture().capture(), a = f.repo(), b = f.repo();
    await a.checkpoint('group', state, history, operation);
    const sourceRevision = (await a.load('group', operation))!.revision!;
    await b.load('group', operation);
    await b.checkpoint('group', { ...state, serialized: 'winner' }, { ...history, cursor: 'm2' }, operation);
    await expect(a.checkpoint('group', state, history, operation, sourceRevision)).rejects.toThrow('conflict');
    await a.load('group', operation);
    await expect(a.checkpoint('group', state, history, operation, sourceRevision)).rejects.toThrow('base checkpoint changed');
    expect(f.disk.get('group')?.serialized).toBe('winner');
    expect(f.disk.get('group')?.checkpoint?.cursor).toBe('m2');
  });
  it('does not cache a delayed account A record after its operation is invalidated', async () => {
    const f = repositoryFixture(), auth = operationFixture(), operation = auth.capture();
    let finish!: (record: MlsGroupRecord | null) => void;
    const read = vi.fn(() => new Promise<MlsGroupRecord | null>(resolve => { finish = resolve; }));
    const repo = new GroupCheckpointRepository({ ...f.ports, read });
    const loading = repo.load('group', operation);
    auth.account.generation++;
    finish(null);
    await expect(loading).rejects.toThrow('superseded');
    expect(f.disk.size).toBe(0);
  });
});

describe('exact pending MLS removal recovery', () => {
  it('saves phase and private state before publishing, and promotes without dropping history', async () => {
    const f = repositoryFixture(), operation = operationFixture().capture(), repo = f.repo();
    await repo.checkpoint('group', state, history, operation);
    await repo.stageRemoval('group', prepared, operation);
    const publish = vi.fn(async (commit: string, epoch: number) => {
      expect(f.disk.get('group')?.pendingRemoval?.phase).toBe('publishing');
      expect(f.disk.get('group')?.pendingRemoval?.serialized).toBe('state-after');
      expect([commit, epoch]).toEqual([prepared.commit, prepared.epoch]);
    });
    await repo.recoverRemoval('group', operation, { publish, findPublished: async () => [] }, true);
    expect(publish).toHaveBeenCalledOnce();
    expect(f.disk.get('group')?.serialized).toBe('state-after');
    expect(f.disk.get('group')?.pendingRemoval).toBeUndefined();
    expect(f.disk.get('group')?.checkpoint).toEqual(history);
  });
  it('retains an ambiguous publication across restart and only accepts the exact logged commit', async () => {
    const f = repositoryFixture(), operation = operationFixture().capture(), repo = f.repo();
    await repo.checkpoint('group', state, history, operation);
    await repo.stageRemoval('group', prepared, operation);
    const publish = vi.fn(async () => { throw new Error('response lost'); });
    await expect(repo.recoverRemoval('group', operation, { publish, findPublished: async () => [] }, true)).rejects.toThrow('not confirmed');
    expect(f.disk.get('group')?.pendingRemoval?.phase).toBe('publishing');
    const resumed = f.repo();
    await expect(resumed.recoverRemoval('group', operation, { publish, findPublished: async () => [{ epoch: 2, commit: 'different', senderDeviceId: prepared.deviceId }] }, true)).rejects.toThrow('does not confirm');
    expect(publish).toHaveBeenCalledOnce();
    await resumed.recoverRemoval('group', operation, { publish, findPublished: async () => [{ epoch: prepared.epoch, commit: prepared.commit, senderDeviceId: prepared.deviceId }] });
    expect(publish).toHaveBeenCalledOnce();
    expect(f.disk.get('group')?.serialized).toBe('state-after');
    expect(f.disk.get('group')?.pendingRemoval).toBeUndefined();
  });
});
