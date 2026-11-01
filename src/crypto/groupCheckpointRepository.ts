import type { MlsGroupRecord } from './mlsDb';
import type { GroupOperation } from './groupOperation';
import { groupOperationKey } from './groupOperation';
import { assertMlsAddCheckpoint, copyGroupHistory, recoverMlsRemoval, recoverMlsAdd, PendingMlsRecoveryError, type GroupHistoryCheckpoint, type PreparedMlsRemoval, type RemovalRecoveryPorts, type PreparedMlsAdd, type AddRecoveryPorts } from './groupCheckpoint';

export interface GroupCheckpointPorts {
  read(groupId: string, operation: GroupOperation): Promise<MlsGroupRecord | null>;
  write(record: Omit<MlsGroupRecord, 'updatedAt'>, operation: GroupOperation, expectedRevision: string | null): Promise<string>;
  legacyHistory(groupId: string, operation: GroupOperation): Promise<unknown[]>;
  legacyHidden(groupId: string, operation: GroupOperation): Promise<string[]>;
  legacyCursor(groupId: string, operation: GroupOperation): string | null;
    invalidate?(groupId: string, operation: GroupOperation): void;
}

/** Call under withGroupOperation. The single encrypted MLS row is authoritative:
 * old history and localStorage cursors are read only during first import.
 */
export class GroupCheckpointRepository {
  private records = new Map<string, MlsGroupRecord | null>();
  private histories = new Map<string, GroupHistoryCheckpoint>();
  constructor(private ports: GroupCheckpointPorts) {}

  clear(): void { this.records.clear(); this.histories.clear(); }

  async load(groupId: string, operation: GroupOperation): Promise<MlsGroupRecord | null> {
    operation.assertCurrent();
    const key = groupOperationKey(operation, groupId);
    if (this.records.has(key)) return this.records.get(key) ?? null;
    const record = await operation.wait(() => this.ports.read(groupId, operation));
    if (record) {
      if (record.deviceId !== operation.deviceId || record.groupId !== groupId) throw new Error('MLS checkpoint scope mismatch');
      assertMlsAddCheckpoint(record);
    }
    const history: GroupHistoryCheckpoint = record?.checkpoint ?? {
      version: 1,
      messages: await operation.wait(() => this.ports.legacyHistory(groupId, operation)),
      hiddenIds: await operation.wait(() => this.ports.legacyHidden(groupId, operation)),
      cursor: this.ports.legacyCursor(groupId, operation),
    };
    operation.assertCurrent();
    this.histories.set(key, copyGroupHistory(history));
    this.records.set(key, record);
    return record;
  }

  async history<T>(groupId: string, operation: GroupOperation): Promise<GroupHistoryCheckpoint<T>> {
    await this.load(groupId, operation);
    operation.assertCurrent();
    return copyGroupHistory(this.histories.get(groupOperationKey(operation, groupId))!) as GroupHistoryCheckpoint<T>;
  }

  private async write(groupId: string, record: MlsGroupRecord, operation: GroupOperation): Promise<string> {
    operation.assertCurrent();
    assertMlsAddCheckpoint(record);
    const key = groupOperationKey(operation, groupId);
    try {
      const snapshot = JSON.parse(JSON.stringify(record)) as MlsGroupRecord;
      const revision = await operation.wait(() => this.ports.write(snapshot, operation, snapshot.revision ?? null));
      this.records.set(key, { ...snapshot, revision });
      this.histories.set(key, copyGroupHistory(snapshot.checkpoint!));
      return revision;
    } catch (error) {
      // A failed acknowledgement may hide a committed transaction or a CAS
      // winner in another window. Never continue from cached pre-write evidence.
      this.records.delete(key);
      this.histories.delete(key);
      this.ports.invalidate?.(groupId, operation);
      throw error;
    }
  }

  async checkpoint(
    groupId: string,
    state: { serialized: string; epoch: number; cipherSuite: string },
    history: GroupHistoryCheckpoint,
    operation: GroupOperation,
    sourceRevision?: string | null,
  ): Promise<string> {
    if (!operation.deviceId) throw new Error('MLS checkpoint requires an initialized device');
    const before = await this.load(groupId, operation);
    if (sourceRevision !== undefined && sourceRevision !== (before?.revision ?? null)) {
      this.ports.invalidate?.(groupId, operation);
      throw new Error('MLS base checkpoint changed; reload before persisting derived state');
    }
    if (before?.pendingAdd) throw new PendingMlsRecoveryError(groupId, 'Resolve the saved outbox before changing this checkpoint.', 'Add/Welcome');
    if (before?.pendingRemoval) throw new PendingMlsRecoveryError(groupId, 'Resolve the saved removal before changing this checkpoint.');
    return this.write(groupId, {
      revision: sourceRevision ?? before?.revision,
      id: JSON.stringify([operation.uid, operation.deviceId, groupId]),
      groupId, deviceId: operation.deviceId, ...state, updatedAt: Date.now(),
      checkpoint: copyGroupHistory(history),
    }, operation);
  }

  async stageAdd(groupId: string, pending: PreparedMlsAdd, operation: GroupOperation): Promise<void> {
    const before = await this.load(groupId, operation);
    if (before?.pendingAdd || before?.pendingRemoval) throw new PendingMlsRecoveryError(groupId, 'Resolve the existing operation before preparing another Add.', 'Add/Welcome');
    if (pending.phase !== 'prepared') throw new Error('New MLS Add must be prepared before staging');
    if (!before || before.serialized !== pending.beforeSerialized || pending.deviceId !== operation.deviceId || pending.epoch !== before.epoch + 1) {
      throw new Error('MLS Add base checkpoint changed; reload before preparing Add');
    }
    await this.write(groupId, { ...before, checkpoint: await this.history(groupId, operation), pendingAdd: pending }, operation);
  }

  async recoverAdd(
    groupId: string,
    operation: GroupOperation,
    relay: Pick<AddRecoveryPorts, 'publish' | 'findPublished' | 'receipt' | 'welcome'>,
  ): Promise<boolean> {
    const record = await this.load(groupId, operation);
    if (!record?.pendingAdd) return false;
    await recoverMlsAdd(groupId, record.pendingAdd, {
      ...relay,
      assertCurrent: operation.assertCurrent,
      savePending: async (pending) => {
        const latest = this.records.get(groupOperationKey(operation, groupId))!;
        await this.write(groupId, { ...latest, pendingAdd: pending }, operation);
      },
      accept: async (pending) => {
        const latest = this.records.get(groupOperationKey(operation, groupId))!;
        await this.write(groupId, { ...latest, serialized: pending.serialized, cipherSuite: pending.cipherSuite,
          epoch: pending.epoch, pendingAdd: pending }, operation);
      },
      complete: async () => {
        const latest = this.records.get(groupOperationKey(operation, groupId))!;
        await this.write(groupId, { ...latest, pendingAdd: undefined }, operation);
      },
    });
    return true;
  }

  async stageRemoval(groupId: string, pending: PreparedMlsRemoval, operation: GroupOperation): Promise<void> {
    const before = await this.load(groupId, operation);
    if (!before || before.serialized !== pending.beforeSerialized || pending.deviceId !== operation.deviceId) {
      throw new Error('MLS removal base checkpoint changed; reload before preparing removal');
    }
    if (before.pendingAdd) throw new PendingMlsRecoveryError(groupId, 'Resolve the Add outbox before preparing removal.', 'Add/Welcome');
    if (before.pendingRemoval) throw new PendingMlsRecoveryError(groupId, 'A previous removal must be recovered first.');
    await this.write(groupId, { ...before, checkpoint: await this.history(groupId, operation), pendingRemoval: pending }, operation);
  }

  async recoverRemoval(
    groupId: string,
    operation: GroupOperation,
    relay: Pick<RemovalRecoveryPorts, 'publish' | 'findPublished'>,
    publishPrepared = false,
  ): Promise<boolean> {
    const record = await this.load(groupId, operation);
    const pending = record?.pendingRemoval;
    if (!record || !pending) return false;
    await recoverMlsRemoval(groupId, pending, {
      ...relay,
      assertCurrent: operation.assertCurrent,
      savePending: async (next) => {
        await this.write(groupId, { ...record, checkpoint: await this.history(groupId, operation), pendingRemoval: next }, operation);
      },
      promote: async (accepted) => {
        const latest = this.records.get(groupOperationKey(operation, groupId));
        if (!latest?.pendingRemoval || latest.serialized !== accepted.beforeSerialized || latest.pendingRemoval.commit !== accepted.commit) {
          throw new PendingMlsRecoveryError(groupId, 'The local base state changed; automatic promotion is unsafe.');
        }
        await this.write(groupId, {
          ...latest, serialized: accepted.serialized, cipherSuite: accepted.cipherSuite,
          epoch: accepted.epoch, pendingRemoval: undefined,
          checkpoint: await this.history(groupId, operation),
        }, operation);
      },
    }, publishPrepared);
    return true;
  }
}
