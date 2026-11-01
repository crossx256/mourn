import { afterEach, expect, it, vi } from 'vitest';
import { fixture } from './helpers/groupAddFixture';

vi.mock('../src/crypto/storageKey', () => ({ getOrCreateStorageKey: async () => new Uint8Array(32).fill(7) }));
afterEach(() => { vi.unstubAllGlobals(); });

// Minimal asynchronous IDB port: exercise the real encryption, scoped row and
// CAS read/write path without adding a dependency or replacing mlsDb itself.
function indexedDbFixture() {
  const rows = new Map<string, unknown>();
  const db = {
    close() {},
    transaction() {
      const tx = { oncomplete: null as (() => void) | null, onerror: null, onabort: null,
        error: null as unknown, abort() { throw new Error('fixture transaction aborted'); },
        objectStore: () => ({
          get(id: string) {
            const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
            queueMicrotask(() => {
              request.result = structuredClone(rows.get(id)); request.onsuccess?.();
              queueMicrotask(() => tx.oncomplete?.());
            });
            return request;
          },
          put(record: { id: string }) { rows.set(record.id, structuredClone(record)); },
        }),
      };
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  return rows;
}

it('encrypts the entire Add outbox in the same scoped CAS row and restores exact artifacts', async () => {
  const rows = indexedDbFixture();
  const { putGroupState, getGroupState } = await import('../src/crypto/mlsDb');
  const f = fixture();
  const record = { ...f.disk(), pendingAdd: f.pending };
  await putGroupState(record, 'alice', f.operation.assertCurrent, null);
  const stored = JSON.stringify([...rows.values()]);
  expect(stored).not.toContain('exact-successor-private');
  expect(stored).not.toContain('exact-public-welcome');
  expect(stored).not.toContain('bob-device');
  expect((await getGroupState('group', 'owner-device', 'alice', f.operation.assertCurrent))?.pendingAdd).toEqual(f.pending);
  expect(await getGroupState('group', 'owner-device', 'bob')).toBeNull();
});


it('durably stages exact Add artifacts before network, then checkpoints acceptance and Welcome progress', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  expect(f.disk().pendingAdd).toEqual(f.pending);
  expect(f.relay.publish).not.toHaveBeenCalled();
  expect(await repo.recoverAdd('group', f.operation, f.relay)).toBe(true);
  expect(f.relay.publish).toHaveBeenCalledTimes(1);
  expect(f.relay.welcome).toHaveBeenCalledWith(f.pending.recipients[0], f.pending.welcome, expect.objectContaining({ epoch: 2 }));
  expect(f.disk().pendingAdd).toBeUndefined();
  expect(f.disk().serialized).toBe(f.pending.serialized);
  expect(f.disk().epoch).toBe(2);
  expect(f.disk().checkpoint).toEqual({ version: 1, messages: [{ id: 'kept' }], hiddenIds: ['hidden'], cursor: 'cursor' });
});

it('recovers lost commit acceptance after restart using exact log evidence, never publishing or generating again', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.publish.mockRejectedValueOnce(new Error('response lost'));
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow();
  expect(f.disk().pendingAdd?.phase).toBe('publishing');
  f.relay.publish.mockClear();
  await f.repo().recoverAdd('group', f.operation, f.relay);
  expect(f.relay.publish).not.toHaveBeenCalled();
  expect(f.relay.findPublished).toHaveBeenCalledWith(2);
  expect(f.disk().serialized).toBe(f.pending.serialized);
  expect(f.disk().pendingAdd).toBeUndefined();
});

it('resumes a partially delivered batch after restart without resending confirmed recipients', async () => {
  const f = fixture(), repo = f.repo();
  f.pending.recipients.push({ userId: 'carol', deviceId: 'carol-device', status: 'pending' });
  await repo.stageAdd('group', f.pending, f.operation);
  const write = f.ports.write;
  f.ports.write = async (record, scope, revision) => {
    if (record.pendingAdd?.recipients[1]?.status === 'publishing') throw new Error('interrupted before second Welcome');
    return write(record, scope, revision);
  };
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('interrupted');
  expect(f.disk().pendingAdd?.recipients.map(r => r.status)).toEqual(['stored', 'pending']);
  f.ports.write = write;
  f.relay.welcome.mockClear(); f.relay.publish.mockClear();
  await f.repo().recoverAdd('group', f.operation, f.relay);
  expect(f.relay.publish).not.toHaveBeenCalled();
  expect(f.relay.welcome).toHaveBeenCalledTimes(1);
  expect(f.relay.welcome.mock.calls[0]?.[0].deviceId).toBe('carol-device');
  expect(f.disk().pendingAdd).toBeUndefined();
});

it('preserves an uncertain Welcome across restart instead of overwriting a potentially newer artifact', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.welcome.mockRejectedValueOnce(new Error('Welcome acknowledgement lost'));
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow();
  expect(f.disk().pendingAdd?.recipients[0]?.status).toBe('publishing');
  f.relay.welcome.mockClear();
  f.relay.receipt.mockImplementation(async identity => ({ ...identity, protocol: 'mourn-welcome-v1', status: 'different' }));
  await expect(f.repo().recoverAdd('group', f.operation, f.relay)).rejects.toThrow('different');
  expect(f.relay.welcome).not.toHaveBeenCalled();
  expect(f.disk().pendingAdd?.welcome).toBe(f.pending.welcome);
});

it('refuses even an unsent Welcome if the server has moved beyond the saved Add epoch', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.findPublished.mockResolvedValue({ currentEpoch: 3,
    commits: [{ epoch: 2, commit: f.pending.commit, senderDeviceId: f.pending.deviceId }] });
  f.relay.receipt.mockImplementation(async identity => ({ ...identity, protocol: 'mourn-welcome-v1', status: 'different' }));
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('different');
  expect(f.relay.welcome).not.toHaveBeenCalled();
  expect(f.disk().serialized).toBe(f.pending.serialized);
  expect(f.disk().pendingAdd?.recipients[0]?.status).toBe('pending');
});

it.each(['add', 'remove'] as const)('never overwrites an existing pending %s with another Add', async (kind) => {
  const f = fixture(), repo = f.repo();
  if (kind === 'add') await repo.stageAdd('group', f.pending, f.operation);
  else {
    const { welcome: _welcome, recipients: _recipients, ...base } = f.pending;
    f.replace({ ...f.disk(), pendingRemoval: { ...base, kind: 'remove', phase: 'prepared', removedDeviceId: 'departed' } });
  }
  const before = f.disk();
  await expect(repo.stageAdd('group', { ...f.pending, commit: 'replacement' }, f.operation)).rejects.toThrow('pending MLS');
  expect(f.disk()).toEqual(before);
});

it('blocks checkpoints and removal staging while an Add/Welcome outbox exists', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  await expect(repo.checkpoint('group', { serialized: 'new-ratchet', epoch: 3, cipherSuite: 'fixture' },
    { version: 1, messages: [], hiddenIds: [], cursor: null }, f.operation)).rejects.toThrow('pending MLS');
  const { welcome: _welcome, recipients: _recipients, ...base } = f.pending;
  await expect(repo.stageRemoval('group', { ...base, kind: 'remove', phase: 'prepared', removedDeviceId: 'departed' }, f.operation)).rejects.toThrow('pending MLS');
  expect(f.disk().pendingAdd).toEqual(f.pending);
});

it('reloads durable evidence after a write acknowledgement is lost, even in the same repository instance', async () => {
  const f = fixture(), repo = f.repo();
  const write = f.ports.write;
  f.ports.write = async (...args) => { await write(...args); throw new Error('write acknowledgement lost'); };
  await expect(repo.stageAdd('group', f.pending, f.operation)).rejects.toThrow('acknowledgement lost');
  f.ports.write = write;
  expect((await repo.load('group', f.operation))?.pendingAdd).toEqual(f.pending);
  await expect(repo.stageAdd('group', { ...f.pending, commit: 'unsafe-regeneration' }, f.operation)).rejects.toThrow('pending MLS');
});

it.each(['cas', 'lost-ack'] as const)('invalidates live evidence when staging Add fails with %s and retries from the durable row', async (failure) => {
  const f = fixture(), repo = f.repo();
  const invalidate = vi.fn();
  f.ports.invalidate = invalidate;
  await repo.load('group', f.operation);
  const write = f.ports.write;
  f.ports.write = async (...args) => {
    if (failure === 'cas') {
      f.replace({ ...f.disk(), serialized: 'newer-ratchet', revision: '2',
        checkpoint: { version: 1, messages: [{ id: 'newer' }], hiddenIds: [], cursor: 'newer-cursor' } });
      throw new Error('CAS conflict');
    }
    await write(...args);
    throw new Error('acknowledgement lost');
  };
  await expect(repo.stageAdd('group', f.pending, f.operation)).rejects.toThrow();
  expect(invalidate).toHaveBeenCalledExactlyOnceWith('group', f.operation);
  f.ports.write = write;
  if (failure === 'cas') {
    await expect(repo.stageAdd('group', f.pending, f.operation)).rejects.toThrow('base checkpoint changed');
    expect(f.disk().serialized).toBe('newer-ratchet');
    expect(f.disk().checkpoint?.cursor).toBe('newer-cursor');
    expect(f.relay.publish).not.toHaveBeenCalled();
  } else {
    await repo.recoverAdd('group', f.operation, f.relay);
    expect(f.disk().serialized).toBe(f.pending.serialized);
    expect(f.disk().checkpoint?.cursor).toBe('cursor');
    expect(f.disk().pendingAdd).toBeUndefined();
  }
});

it('stops a superseded scope after commit publication, retaining all recovery artifacts', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.publish.mockImplementationOnce(async () => { f.invalidate(); });
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('superseded');
  expect(f.relay.welcome).not.toHaveBeenCalled();
  expect(f.disk().pendingAdd?.phase).toBe('publishing');
});

it.each(['phase', 'epoch', 'device', 'base', 'duplicate-device', 'progress-before-acceptance', 'both-journals'] as const)(
  'rejects a malformed outbox (%s) before writing or recovering', async (scenario) => {
    indexedDbFixture();
    const f = fixture();
    if (scenario === 'phase') f.pending.phase = 'unknown' as never;
    if (scenario === 'epoch') f.pending.epoch = 9;
    if (scenario === 'device') f.pending.deviceId = 'other-device';
    if (scenario === 'base') f.pending.beforeSerialized = 'other-private-base';
    if (scenario === 'duplicate-device') f.pending.recipients.push({ ...f.pending.recipients[0]! });
    if (scenario === 'progress-before-acceptance') f.pending.recipients[0]!.status = 'stored';
    const record = { ...f.disk(), pendingAdd: f.pending };
    if (scenario === 'both-journals') record.pendingRemoval = { version: 1, kind: 'remove', phase: 'prepared', deviceId: 'owner-device',
      removedDeviceId: 'departed', beforeSerialized: 'before-private', serialized: 'removed-private', cipherSuite: 'fixture', epoch: 2, commit: 'remove' };
    const { putGroupState } = await import('../src/crypto/mlsDb');
    await expect(putGroupState(record, 'alice', f.operation.assertCurrent, null)).rejects.toThrow('pending MLS');
    f.replace(record);
    await expect(f.repo().recoverAdd('group', f.operation, f.relay)).rejects.toThrow('pending MLS');
    expect(f.relay.publish).not.toHaveBeenCalled();
    expect(f.relay.welcome).not.toHaveBeenCalled();
  },
);

it.each(['missing', 'different-commit', 'different-device', 'different-epoch', 'unreachable'] as const)(
  'retains an ambiguous Add and blocks Welcome when ordered-log evidence is %s', async (scenario) => {
    const f = fixture();
    f.pending.phase = 'publishing';
    f.replace({ ...f.disk(), pendingAdd: f.pending });
    const commits = [{ epoch: scenario === 'different-epoch' ? 3 : 2,
      commit: scenario === 'different-commit' ? 'other-commit' : f.pending.commit,
      senderDeviceId: scenario === 'different-device' ? 'other-device' : f.pending.deviceId }];
    if (scenario === 'unreachable') f.relay.findPublished.mockRejectedValue(new Error('offline'));
    else f.relay.findPublished.mockResolvedValue({ currentEpoch: 2, commits: scenario === 'missing' ? [] : commits });
    await expect(f.repo().recoverAdd('group', f.operation, f.relay)).rejects.toThrow('pending MLS Add/Welcome');
    expect(f.disk().pendingAdd).toEqual(f.pending);
    expect(f.disk().serialized).toBe('before-private');
    expect(f.relay.publish).not.toHaveBeenCalled();
    expect(f.relay.welcome).not.toHaveBeenCalled();
  },
);
