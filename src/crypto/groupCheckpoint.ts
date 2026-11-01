export interface GroupHistoryCheckpoint<T = unknown> {
  version: 1;
  messages: T[];
  hiddenIds: string[];
  /** Only the ordered HTTP reducer may advance this cursor. */
  cursor: string | null;
}

export interface PreparedMlsRemoval {
  version: 1;
  kind: 'remove';
  phase: 'prepared' | 'publishing';
  deviceId: string;
  removedDeviceId: string;
  beforeSerialized: string;
  serialized: string;
  cipherSuite: string;
  epoch: number;
  commit: string;
}

export interface MlsAddRecipient {
  userId: string;
  deviceId: string;
  status: 'pending' | 'publishing' | 'stored';
}

export interface PreparedMlsAdd {
  version: 1;
  kind: 'add';
  phase: 'prepared' | 'publishing' | 'welcoming';
  deviceId: string;
  beforeSerialized: string;
  serialized: string;
  cipherSuite: string;
  epoch: number;
  commit: string;
  welcome: string;
  recipients: MlsAddRecipient[];
}

/** Validate decrypted durable evidence before it can authorize any mutation. */
export function assertMlsAddCheckpoint(record: {
  deviceId: string; serialized: string; epoch: number; cipherSuite?: string | null;
  pendingAdd?: PreparedMlsAdd; pendingRemoval?: PreparedMlsRemoval;
}): void {
  const pending = record.pendingAdd;
  if (!pending) return;
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const welcoming = pending.phase === 'welcoming';
  if (record.pendingRemoval || pending.version !== 1 || pending.kind !== 'add' ||
      !['prepared', 'publishing', 'welcoming'].includes(pending.phase) || pending.deviceId !== record.deviceId ||
      !text(pending.beforeSerialized) || !text(pending.serialized) || !text(pending.cipherSuite) ||
      (record.cipherSuite && record.cipherSuite !== pending.cipherSuite) ||
      !text(pending.commit) || pending.commit.length > 256 * 1024 ||
      !text(pending.welcome) || pending.welcome.length > 256 * 1024 ||
      !Number.isSafeInteger(pending.epoch) || pending.epoch < 1 ||
      record.serialized !== (welcoming ? pending.serialized : pending.beforeSerialized) ||
      record.epoch !== (welcoming ? pending.epoch : pending.epoch - 1) ||
      !Array.isArray(pending.recipients) || pending.recipients.length < 1 || pending.recipients.length > 500 ||
      pending.recipients.some((recipient) => !recipient || !text(recipient.userId) || !text(recipient.deviceId) ||
        !['pending', 'publishing', 'stored'].includes(recipient.status) || (!welcoming && recipient.status !== 'pending')) ||
      new Set(pending.recipients.map((recipient) => recipient.deviceId)).size !== pending.recipients.length) {
    throw new Error('Malformed or conflicting pending MLS Add/Welcome; recovery evidence retained');
  }
}

export interface AddRecoveryPorts {
  assertCurrent(): void;
  savePending(pending: PreparedMlsAdd): Promise<void>;
  publish(commit: string, epoch: number): Promise<void>;
  findPublished(epoch: number): Promise<{
    currentEpoch: number;
    commits: Array<{ epoch: number; commit: string; senderDeviceId: string }>;
  }>;
  /** Promote successor secrets atomically, retaining the Welcome outbox. */
  accept(pending: PreparedMlsAdd): Promise<void>;
  receipt(identity: WelcomeIdentity): Promise<unknown>;
  welcome(recipient: MlsAddRecipient, welcome: string, identity: WelcomeIdentity): Promise<unknown>;
  complete(): Promise<void>;
}

export class PendingMlsRecoveryError extends Error {
  readonly code = 'MLS_PENDING_RECOVERY';
  constructor(groupId: string, detail: string, kind = 'removal') {
    super(`Suite ${groupId}: pending MLS ${kind} recovery required. ${detail} The exact prepared state and commit are retained; do not clear local storage or regenerate the operation.`);
    this.name = 'PendingMlsRecoveryError';
  }
}

export interface RemovalRecoveryPorts {
  assertCurrent(): void;
  /** Persist the phase BEFORE any publication can escape. */
  savePending(pending: PreparedMlsRemoval): Promise<void>;
  publish(commit: string, epoch: number): Promise<void>;
  findPublished(epoch: number): Promise<Array<{ epoch: number; commit: string; senderDeviceId: string }>>;
  /** Atomically promote the prepared state + existing history/cursor and clear pending. */
  promote(pending: PreparedMlsRemoval): Promise<void>;
}

/** A lost response is not proof of rejection. The existing ordered commit log
 * can confirm exact acceptance, but neither epoch equality nor an empty page
 * authorizes retrying an ambiguous request with freshly generated secrets.
 */
export async function recoverMlsRemoval(
  groupId: string,
  pending: PreparedMlsRemoval,
  ports: RemovalRecoveryPorts,
  publishPrepared = false,
): Promise<void> {
  ports.assertCurrent();
  if (pending.phase === 'prepared') {
    if (!publishPrepared) {
      throw new PendingMlsRecoveryError(groupId, 'Retry the original device removal to publish its saved operation.');
    }
    const publishing: PreparedMlsRemoval = { ...pending, phase: 'publishing' };
    await ports.savePending(publishing);
    ports.assertCurrent();
    try {
      await ports.publish(publishing.commit, publishing.epoch);
      ports.assertCurrent();
    } catch (error) {
      ports.assertCurrent();
      throw new PendingMlsRecoveryError(groupId, `Publication was not confirmed (${error instanceof Error ? error.message : String(error)}). Retry recovery after reconnecting.`);
    }
    await ports.promote(publishing);
    ports.assertCurrent();
    return;
  }

  let commits: Awaited<ReturnType<RemovalRecoveryPorts['findPublished']>>;
  try { commits = await ports.findPublished(pending.epoch); }
  catch {
    ports.assertCurrent();
    throw new PendingMlsRecoveryError(groupId, 'Cannot inspect the ordered commit log. Reconnect and retry recovery.');
  }
  ports.assertCurrent();
  if (!commits.some((item) => item.epoch === pending.epoch && item.commit === pending.commit && item.senderDeviceId === pending.deviceId)) {
    throw new PendingMlsRecoveryError(groupId, `The commit log does not confirm the exact saved commit at epoch ${pending.epoch}. Keep this device's data for manual recovery; publication will not be guessed or repeated.`);
  }
  await ports.promote(pending);
  ports.assertCurrent();
}

export interface WelcomeIdentity extends Record<string, unknown> {
  groupId: string;
  inviteeId: string;
  inviteeDeviceId: string;
  epoch: number;
  commitHash: string;
  welcomeHash: string;
}

async function hashWelcomeArtifact(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function welcomeResponse(value: unknown, identity: WelcomeIdentity, stored = false, senderDeviceId?: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Unsupported guarded Welcome response');
  const response = value as Record<string, unknown>;
  if (response.protocol !== 'mourn-welcome-v1' ||
      Object.entries(identity).some(([key, expected]) => response[stored && key === 'inviteeDeviceId' ? 'deviceId' : key] !== expected) ||
      (stored && (response.status !== 'stored' || response.senderDeviceId !== senderDeviceId ||
        typeof response.memberId !== 'string' || !response.memberId ||
        typeof response.publisherMemberId !== 'string' || !response.publisherMemberId || typeof response.replay !== 'boolean'))) {
    throw new Error('Unsupported or mismatched guarded Welcome response');
  }
  return response;
}

/** Receipt support and exact identity must be confirmed before every guarded write. */
export async function recoverMlsAdd(groupId: string, saved: PreparedMlsAdd, ports: AddRecoveryPorts): Promise<void> {
  let pending = saved;
  ports.assertCurrent();
  if (pending.phase === 'prepared') {
    pending = { ...pending, phase: 'publishing' };
    await ports.savePending(pending);
    ports.assertCurrent();
    try { await ports.publish(pending.commit, pending.epoch); }
    catch {
      ports.assertCurrent();
      throw new PendingMlsRecoveryError(groupId, 'Commit publication is uncertain. Reconnect to inspect the exact ordered-log entry.', 'Add/Welcome');
    }
    ports.assertCurrent();
    pending = { ...pending, phase: 'welcoming' };
    await ports.accept(pending);
    ports.assertCurrent();
  }
  if (pending.phase === 'publishing') {
    let log: Awaited<ReturnType<AddRecoveryPorts['findPublished']>>;
    try { log = await ports.findPublished(pending.epoch); }
    catch {
      ports.assertCurrent();
      throw new PendingMlsRecoveryError(groupId, 'Cannot inspect the ordered commit log. Reconnect and retry.', 'Add/Welcome');
    }
    ports.assertCurrent();
    const entry = log.commits[0];
    if (!entry || entry.epoch !== pending.epoch || entry.commit !== pending.commit || entry.senderDeviceId !== pending.deviceId) {
      throw new PendingMlsRecoveryError(groupId, 'The ordered log does not confirm this exact Add. Publication will not be guessed or regenerated.', 'Add/Welcome');
    }
    pending = { ...pending, phase: 'welcoming' };
    await ports.accept(pending);
    ports.assertCurrent();
  }
  for (let index = 0; index < pending.recipients.length; index++) {
    const recipient = pending.recipients[index]!;
    if (recipient.status === 'stored') continue;
    try {
      const identity: WelcomeIdentity = { groupId, inviteeId: recipient.userId, inviteeDeviceId: recipient.deviceId,
        epoch: pending.epoch, commitHash: await hashWelcomeArtifact(pending.commit), welcomeHash: await hashWelcomeArtifact(pending.welcome) };
      ports.assertCurrent();
      const receipt = welcomeResponse(await ports.receipt(identity), identity);
      ports.assertCurrent();
      if (receipt.status !== 'exact') {
        if (receipt.status !== 'absent' && receipt.status !== 'replaceable') throw new Error(`Welcome receipt ${String(receipt.status)}; delivery blocked`);
        pending = { ...pending, recipients: pending.recipients.map((item, i) => i === index ? { ...item, status: 'publishing' } : item) };
        await ports.savePending(pending);
        ports.assertCurrent();
        const response = await ports.welcome(recipient, pending.welcome, identity);
        ports.assertCurrent();
        welcomeResponse(response, identity, true, pending.deviceId);
      }
    } catch (error) {
      ports.assertCurrent();
      throw new PendingMlsRecoveryError(groupId, `Welcome delivery unconfirmed (${error instanceof Error ? error.message : String(error)}). Exact artifacts retained; deploy the guarded backend before retrying.`, 'Add/Welcome');
    }
    ports.assertCurrent();
    pending = { ...pending, recipients: pending.recipients.map((item, i) => i === index ? { ...item, status: 'stored' } : item) };
    await ports.savePending(pending);
    ports.assertCurrent();
  }
  await ports.complete();
  ports.assertCurrent();
}

export function copyGroupHistory<T>(history: GroupHistoryCheckpoint<T>): GroupHistoryCheckpoint<T> {
  return JSON.parse(JSON.stringify(history)) as GroupHistoryCheckpoint<T>;
}

/** Promote live state only after the complete durable checkpoint succeeds. */
export async function publishGroupCheckpoint<T>(
  assertCurrent: () => void,
  persist: () => Promise<void>,
  promote: () => T,
): Promise<T> {
  assertCurrent();
  await persist();
  assertCurrent();
  return promote();
}
