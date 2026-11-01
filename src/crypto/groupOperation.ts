export interface GroupAccountOperation {
  uid: string | null;
  generation: number;
  isCurrent(): boolean;
  assertCurrent(): void;
}

export interface GroupOperation {
  readonly uid: string;
  readonly deviceId: string | null;
  readonly generation: number;
  isCurrent(): boolean;
  assertCurrent(): void;
  wait<T>(work: () => T | PromiseLike<T>): Promise<T>;
}

/** Capture before scheduling work, including before entering the group queue. */
export function bindGroupOperation(
  account: GroupAccountOperation,
  currentDevice: () => string | null,
  currentReset: () => number,
): GroupOperation {
  if (!account.uid) throw new Error('Group operation requires an account');
  const deviceId = currentDevice();
  const reset = currentReset();
  const isCurrent = () => account.isCurrent() && currentDevice() === deviceId && currentReset() === reset;
  const assertCurrent = () => {
    account.assertCurrent();
    if (!isCurrent()) throw new Error('Group operation superseded by a device change or reset');
  };
  return {
    uid: account.uid, deviceId, generation: account.generation, isCurrent, assertCurrent,
    async wait<T>(work: () => T | PromiseLike<T>): Promise<T> {
      assertCurrent();
      try {
        const value = await work();
        assertCurrent();
        return value;
      } catch (error) {
        assertCurrent();
        throw error;
      }
    },
  };
}

export function groupOperationKey(operation: GroupOperation, groupId: string): string {
  return JSON.stringify([operation.uid, operation.deviceId, groupId]);
}

const queues = new Map<string, Promise<unknown>>();
const leases = new WeakMap<GroupOperation, { key: string; active: boolean }>();

/** Invalidate the account/reset first, then drain its queued writes before wiping. */
export async function drainGroupOperationsForUser(uid: string): Promise<void> {
  const owned = [...queues].filter(([key]) => (JSON.parse(key) as unknown[])[0] === uid);
  await Promise.allSettled(owned.map(([, work]) => work));
}

/** Explicit, awaited nested calls reuse a lease; unrelated work always queues.
 * Never clear these queues on logout: old continuations must drain with their
 * original (invalidated) scope, not acquire a fresh account at execution time.
 */
export function withGroupOperation<T>(
  operation: GroupOperation,
  groupId: string,
  work: (lease: GroupOperation) => Promise<T>,
): Promise<T> {
  operation.assertCurrent();
  const key = groupOperationKey(operation, groupId);
  const existing = leases.get(operation);
  if (existing) {
    if (!existing.active || existing.key !== key) throw new Error('Invalid nested group operation');
    return work(operation);
  }
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(async () => {
    operation.assertCurrent();
    const lease = { ...operation };
    const state = { key, active: true };
    const assertCurrent = () => {
      operation.assertCurrent();
      if (!state.active) throw new Error('Group operation lease expired');
    };
    lease.assertCurrent = assertCurrent;
    lease.isCurrent = () => state.active && operation.isCurrent();
    lease.wait = async <U>(action: () => U | PromiseLike<U>): Promise<U> => {
      assertCurrent();
      try { const value = await action(); assertCurrent(); return value; }
      catch (error) { assertCurrent(); throw error; }
    };
    leases.set(lease, state);
    try { return await work(lease); }
    finally { state.active = false; }
  });
  queues.set(key, result);
  void result.finally(() => { if (queues.get(key) === result) queues.delete(key); }).catch(() => {});
  return result;
}
