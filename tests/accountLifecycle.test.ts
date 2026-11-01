import { describe, expect, it, vi } from 'vitest';
import { AccountOperationSuperseded, captureAccountOperation, retainedMessages, runCleanup, serializeAccountTransition } from '../src/utils/accountLifecycle';

describe('account lifecycle boundaries', () => {
  it('invalidates an operation even when logging back in to the same UID', async () => {
    const auth = { user: { id: 'alice' }, authOperationGeneration: 1 };
    const operation = captureAccountOperation(auth);
    auth.authOperationGeneration++;
    await expect(operation.wait(() => 'secret')).rejects.toBeInstanceOf(AccountOperationSuperseded);
  });
  it('rejects a response that settles after an account transition', async () => {
    const auth = { user: { id: 'alice' }, authOperationGeneration: 1 };
    const operation = captureAccountOperation(auth);
    let finish!: (value: string) => void;
    const result = operation.wait(() => new Promise<string>(resolve => { finish = resolve; }));
    auth.user = { id: 'bob' };
    finish('alice data');
    await expect(result).rejects.toBeInstanceOf(AccountOperationSuperseded);
  });
  it('serializes transitions and recovers the queue after a failure', async () => {
    const owner = {};
    const trace: string[] = [];
    const a = serializeAccountTransition(owner, async () => { trace.push('a'); throw new Error('failed'); });
    const b = serializeAccountTransition(owner, async () => { trace.push('b'); return true; });
    await expect(a).rejects.toThrow('failed');
    await expect(b).resolves.toBe(true);
    expect(trace).toEqual(['a', 'b']);
  });
  it('reports incomplete cleanup and still attempts remaining owners', async () => {
    const last = vi.fn();
    const result = await runCleanup([{ owner: 'first', clear: () => { throw new Error('disk failure'); } }, { owner: 'last', clear: last }]);
    expect(result.success).toBe(false);
    expect(result.failed.map(item => item.owner)).toEqual(['first']);
    expect(last).toHaveBeenCalledOnce();
  });
  it('filters invalid and expired timed messages at the persistence boundary', () => {
    const messages = [{ at: 1 }, { at: 9_000_000 }, { at: NaN }];
    expect(retainedMessages(messages, { mode: 'ephemeral_time', retainHours: 1 }, m => m.at, 10_000_000)).toEqual([messages[1]]);
    expect(retainedMessages(messages, { mode: 'ephemeral_time' }, m => m.at)).toEqual([]);
    expect(retainedMessages(messages, { mode: 'persistent' }, m => m.at)).toBe(messages);
  });
});
