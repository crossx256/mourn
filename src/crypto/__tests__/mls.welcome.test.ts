import { describe, expect, it } from 'vitest';
import { MlsGroupClient } from '../mlsGroup';
import { mlsSingleFlight } from '../mlsSingleFlight';

describe('MLS Welcome device isolation', () => {
  it('a Welcome for device A cannot initialize device B', async () => {
    const { client: owner } = await MlsGroupClient.create(new TextEncoder().encode('multi-device'));
    const a = await MlsGroupClient.generateKeyPackagePair('device-A');
    const b = await MlsGroupClient.generateKeyPackagePair('device-B');
    const { welcomeB64 } = await owner.addMember(a.publicPackageB64);
    await expect(MlsGroupClient.join(welcomeB64,
      await MlsGroupClient.decodeKeyPackage(b.publicPackageB64), b.privatePackage)).rejects.toThrow();
    const joined = await MlsGroupClient.join(welcomeB64,
      await MlsGroupClient.decodeKeyPackage(a.publicPackageB64), a.privatePackage);
    expect(await joined.decrypt(await owner.encrypt('correct device'))).toBe('correct device');
  });
});

describe('MLS onboarding single flight', () => {
  it('coalesces concurrent HTTP and WebSocket joins', async () => {
    const run = mlsSingleFlight<number>();
    let calls = 0;
    const operation = async () => ++calls;
    expect(await Promise.all([run('user/device/group', operation), run('user/device/group', operation)]))
      .toEqual([1, 1]);
    expect(calls).toBe(1);
  });

  it('allows retry after failure and isolates device scopes', async () => {
    const run = mlsSingleFlight<number>();
    await expect(run('A', async () => { throw new Error('storage unavailable'); })).rejects.toThrow();
    expect(await run('A', async () => 1)).toBe(1);
    expect(await Promise.all([run('A', async () => 2), run('B', async () => 3)])).toEqual([2, 3]);
  });
});
