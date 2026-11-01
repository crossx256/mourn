// mls.remove.e2e.test.ts
// Verifies forward-secrecy on group removal: after a member is Remove-committed
// out of an MLS group, the removed device can no longer decrypt subsequent
// messages, while the remaining members still can (epoch advanced).
//
// Run: bunx vitest run src/crypto/__tests__/mls.remove.e2e.test.ts
import { describe, it, expect } from 'vitest';
import { MlsGroupClient, type MlsKeyPackagePair } from '../mlsGroup';

const enc = new TextEncoder();

describe('MLS group removal (forward secrecy on leave/kick)', () => {
  it('removing a member blanks their leaf and stops their decryption of future messages', async () => {
    // 1. Owner creates the group.
    const groupId = enc.encode('group-remove-test-1');
    const { client: ownerClient } = await MlsGroupClient.create(groupId);

    // 2. Owner adds ONE member, joins via Welcome, applies nothing extra.
    const memberA = await addMemberTo(ownerClient, 'device-A');

    // 3. Both can exchange messages before removal.
    const toAll = await ownerClient.encrypt('before-remove');
    expect((await memberA.client.decrypt(toAll)).trim()).toBe('before-remove');
    const back = await memberA.client.encrypt('from-A');
    expect((await ownerClient.decrypt(back)).trim()).toBe('from-A');

    // 4. Owner issues a Remove commit for device-A. removeMember() already
    //    advances the OWNER's state internally (owner is the remaining member,
    //    already in sync). device-A is NOT told to apply the commit — a
    //    removed member cannot process what ejected it (that is the point).
    const removed = await ownerClient.removeMember('device-A');
    console.log('EPOCHS before removal: owner=%d A=%d', ownerClient.epoch, memberA.client.epoch);
    expect(ownerClient.epoch).toBeGreaterThan(memberA.client.epoch); // owner advanced, A did not
    void removed;

    // 5. A new message is encrypted after removal.
    const postRemove = await ownerClient.encrypt('after-remove');

    // device-A was REMOVED: its local state is out of epoch / leaf blanked, so
    // it must NOT be able to produce the plaintext for this new application
    // message.
    await expect(memberA.client.decrypt(postRemove)).rejects.toThrow();
  }, 60_000);

  it('removing one member leaves the other remaining members able to decrypt', async () => {
    // 1. Owner creates the group.
    const groupId = enc.encode('group-remove-test-3');
    const { client: ownerClient } = await MlsGroupClient.create(groupId);

    // 2. Owner adds memberA then memberB. memberA, who preceded memberB, must
    //    apply memberB's Add commit to stay on the newest epoch.
    const memberA = await addMemberTo(ownerClient, 'device-A');
    const memberB = await addMemberTo(ownerClient, 'device-B');
    await memberA.client.applyCommit(memberB.commitB64); // A catches up to B's add

    // 3. All three exchange messages before removal.
    const before = await ownerClient.encrypt('before-remove');
    expect((await memberA.client.decrypt(before)).trim()).toBe('before-remove');
    expect((await memberB.client.decrypt(before)).trim()).toBe('before-remove');

    // 4. Owner removes device-A. The OTHER still-member (memberB) applies the
    //    commit; the owner is already advanced by removeMember(); device-A is not.
    const { commitB64 } = await ownerClient.removeMember('device-A');
    const ownerEpochAfterRemove = ownerClient.epoch;
    await memberB.client.applyCommit(commitB64);
    expect(memberB.client.epoch).toBe(ownerEpochAfterRemove);
    // device-A lags (its leaf was blanked by the commit it cannot process).
    expect(memberA.client.epoch).toBeLessThan(ownerEpochAfterRemove);

    // 5. A message after removal: owner + memberB can decrypt; device-A cannot.
    const postRemove = await ownerClient.encrypt('after-remove');
    expect((await memberB.client.decrypt(postRemove)).trim()).toBe('after-remove');
    await expect(memberA.client.decrypt(postRemove)).rejects.toThrow();
  }, 60_000);

  it('self-leave: after a member leaves, the owner Remove-commits their device and the leaver can no longer decrypt future messages', async () => {
    // Simulates the self-leave orchestration:
    //   1. member self-leaves (their device rows are deleted);
    //   2. the remaining OWNER (notified via GROUP_MEMBER_LEFT) Remove-commits
    //      the leaver's device leaf;
    //   3. the leaver's stale ratchet can no longer decrypt newer messages.
    const groupId = enc.encode('group-leave-test');
    const { client: ownerClient } = await MlsGroupClient.create(groupId);

    const leaver = await addMemberTo(ownerClient, 'device-leaver');

    // Before leaving, leaver can decrypt a group message.
    const before = await ownerClient.encrypt('before-leave');
    expect((await leaver.client.decrypt(before)).trim()).toBe('before-leave');

    // The leaver's device leaves the group. The owner (who holds the
    // authoritative tree) issues the MLS Remove commit for it.
    const removed = await ownerClient.removeMember('device-leaver');
    // Owner is already advanced by removeMember(); the leaver is NOT given the
    // commit (that would require it to still be a valid member).
    expect(ownerClient.epoch).toBeGreaterThan(leaver.client.epoch);
    void removed;

    // A message sent after the leave is decryptable by no one but the owner
    // (the leaver's leaf is blanked / its epoch stale).
    const after = await ownerClient.encrypt('after-leave');
    await expect(leaver.client.decrypt(after)).rejects.toThrow();
  }, 60_000);

  it('listMemberDeviceIds enumerates the active leaves (owner sweep primitive)', async () => {
    const groupId = enc.encode('group-sweep-test');
    const { client: ownerClient } = await MlsGroupClient.create(groupId);

    // Initially the creator device is a leaf (its credential is the byte
    // string of groupId, so exactly one leaf exists and it is non-empty).
    expect(ownerClient.listMemberDeviceIds().length).toBe(1);

    const memberA = await addMemberTo(ownerClient, 'device-A');
    const memberB = await addMemberTo(ownerClient, 'device-B');
    await memberA.client.applyCommit(memberB.commitB64); // A stays in sync

    const leaves = ownerClient.listMemberDeviceIds();
    expect(leaves).toContain('device-A');
    expect(leaves).toContain('device-B');

    // Simulate "member A left while owner was offline": its leaf is still in
    // the owner's local tree (it was never Remove-committed because the owner
    // missed the GROUP_MEMBER_LEFT signal)...
    expect(leaves).toContain('device-A');

    // ...so the owner's next-open sweep detects it as departed (not in the
    // active roster) and Remove-commits it. After removal it is gone.
    await ownerClient.removeMember('device-A');
    const afterSweep = ownerClient.listMemberDeviceIds();
    expect(afterSweep).not.toContain('device-A');
    expect(afterSweep).toContain('device-B');
  }, 60_000);

  it('throws when removing a device that is not a group member', async () => {
    const groupId = enc.encode('group-remove-test-2');
    const { client: ownerClient } = await MlsGroupClient.create(groupId);
    await expect(ownerClient.removeMember('ghost-device')).rejects.toThrow();
  }, 30_000);
});

/**
 * Add a member to the owner's group: generate their key pair, owner commits an
 * Add, broadcasts it to existing members, and the new member joins via Welcome.
 * Returns the new member's client plus their key pair (for later reuse).
 */
async function addMemberTo(
  owner: MlsGroupClient,
  deviceId: string,
): Promise<{ client: MlsGroupClient; pair: MlsKeyPackagePair; commitB64: string }> {
  const pair = await MlsGroupClient.generateKeyPackagePair(deviceId);
  // addMember() advances the OWNER's state internally and returns the commit
  // and welcome for the OTHER members / new member to apply.
  const { commitB64, welcomeB64 } = await owner.addMember(pair.publicPackageB64);
  const kp = await MlsGroupClient.decodeKeyPackage(pair.publicPackageB64);
  const member = await MlsGroupClient.join(welcomeB64, kp, pair.privatePackage);
  // The new member's freshly-joined state is already at the new epoch; the
  // owner is too. The commit is only needed for members who were in the group
  // BEFORE this add, so a caller managing a multi-member roster applies it.
  return { client: member, pair, commitB64 };
}
