import { expect, it } from 'vitest';
import { fixture } from './helpers/groupAddFixture';

it('retries an absent receipt with only exact saved public artifacts after a lost response', async () => {
  const f = fixture(), repo = f.repo();
  f.pending.commit = 'exact commit UTF8 é\n';
  f.pending.welcome = 'exact Welcome UTF8 🔒\n';
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.welcome.mockRejectedValueOnce(new Error('lost'));
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow();
  f.relay.welcome.mockClear();
  await f.repo().recoverAdd('group', f.operation, f.relay);
  const call = f.relay.welcome.mock.calls[0]!;
  const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
  expect(call[1]).toBe(f.pending.welcome);
  expect(call[2]).toEqual({ groupId: 'group', inviteeId: 'bob', inviteeDeviceId: 'bob-device', epoch: 2,
    commitHash: await hash(f.pending.commit), welcomeHash: await hash(f.pending.welcome) });
  expect(JSON.stringify([...f.relay.receipt.mock.calls, ...f.relay.welcome.mock.calls])).not.toContain('private');
  expect(f.relay.receipt.mock.invocationCallOrder[1]!).toBeLessThan(f.relay.welcome.mock.invocationCallOrder[0]!);
});

it('posts exact saved artifacts for a replaceable receipt rather than treating it as stored', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.receipt.mockImplementation(async identity => ({ ...identity, protocol: 'mourn-welcome-v1', status: 'replaceable' }));
  f.relay.welcome.mockRejectedValueOnce(new Error('lost response'));
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('pending MLS Add/Welcome');
  expect(f.disk().pendingAdd?.recipients[0]?.status).toBe('publishing');
  await f.repo().recoverAdd('group', f.operation, f.relay);
  expect(f.relay.welcome).toHaveBeenCalledTimes(2);
  expect(f.relay.welcome.mock.calls[0]?.[1]).toBe(f.pending.welcome);
  expect(f.relay.welcome.mock.calls[1]?.slice(1)).toEqual(f.relay.welcome.mock.calls[0]?.slice(1));
  expect(f.relay.welcome.mock.calls[1]?.[0]).toMatchObject({ userId: 'bob', deviceId: 'bob-device' });
  expect(f.disk().pendingAdd).toBeUndefined();
});

it.each(['different', 'legacy-unverifiable', 'missing-marker', 'wrong-identity', 'replaceable-wrong-identity', '404'])(
  'blocks even the first Welcome for receipt %s without discarding the journal', async scenario => {
    const f = fixture(), repo = f.repo();
    await repo.stageAdd('group', f.pending, f.operation);
    f.relay.receipt.mockImplementation(async identity => {
      if (scenario === '404') throw new Error('404');
      return { ...identity, protocol: scenario === 'missing-marker' ? '' : 'mourn-welcome-v1',
        status: scenario === 'wrong-identity' ? 'exact' : scenario === 'replaceable-wrong-identity' ? 'replaceable' : scenario,
        groupId: scenario.endsWith('wrong-identity') ? 'other' : identity.groupId };
    });
    await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('pending MLS Add/Welcome');
    expect(f.relay.welcome).not.toHaveBeenCalled();
    expect(f.disk().pendingAdd?.welcome).toBe(f.pending.welcome);
  });

it.each(['old-server', 'groupId', 'inviteeId', 'deviceId', 'epoch', 'commitHash', 'welcomeHash', 'senderDeviceId', 'memberId', 'publisherMemberId', 'replay'])(
  'does not accept an unguarded or mismatched POST acknowledgement (%s)', async field => {
    const f = fixture(), repo = f.repo();
    await repo.stageAdd('group', f.pending, f.operation);
    f.relay.welcome.mockImplementationOnce(async (_recipient, _welcome, identity) => ({
      ...identity, protocol: 'mourn-welcome-v1', status: 'stored', deviceId: 'bob-device',
      senderDeviceId: 'owner-device', memberId: 'member', publisherMemberId: 'publisher-member', replay: false,
      [field === 'old-server' ? 'protocol' : field]: null,
    }) as never);
    await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('pending MLS Add/Welcome');
    expect(f.disk().pendingAdd?.recipients[0]?.status).toBe('publishing');
  });

it.each([undefined, ''])('rejects a missing or empty publisher membership (%s)', async publisherMemberId => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.welcome.mockImplementationOnce(async (_recipient, _welcome, identity) => ({
    ...identity, protocol: 'mourn-welcome-v1', status: 'stored', deviceId: 'bob-device',
    senderDeviceId: 'owner-device', memberId: 'member', publisherMemberId, replay: false,
  }) as never);
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow('pending MLS Add/Welcome');
  expect(f.disk().pendingAdd?.recipients[0]?.status).toBe('publishing');
});

it('recovers a lost Welcome response after restart from an exact receipt even at an advanced epoch', async () => {
  const f = fixture(), repo = f.repo();
  await repo.stageAdd('group', f.pending, f.operation);
  f.relay.welcome.mockRejectedValueOnce(new Error('lost response'));
  await expect(repo.recoverAdd('group', f.operation, f.relay)).rejects.toThrow();
  expect(f.disk().pendingAdd?.recipients[0]?.status).toBe('publishing');
  f.relay.receipt.mockImplementation(async identity => ({ ...identity, protocol: 'mourn-welcome-v1', status: 'exact' }));
  f.relay.findPublished.mockResolvedValue({ currentEpoch: 99, commits: [] });
  f.relay.welcome.mockClear();
  await f.repo().recoverAdd('group', f.operation, f.relay);
  expect(f.relay.welcome).not.toHaveBeenCalled();
  expect(f.disk().pendingAdd).toBeUndefined();
});
