import { defineStore } from 'pinia';
import { KeyManager } from '../crypto/keys';
import { CipherEngine } from '../crypto/engine';
import { VaultTransport } from '../crypto/transport';
import { api, refreshMobileSession, resolveApiUrl } from 'boot/axios';
import sodium from 'libsodium-wrappers';
import { Notify, Dialog } from 'quasar';
import { get, set, del, keys } from 'idb-keyval';
import { AccountOperationSuperseded, captureAccountOperation, retainedMessages, runCleanup } from "../utils/accountLifecycle";
import { getEncryptedRatchetState, setEncryptedRatchetState, removeEncryptedRatchetStates, clearOfflineBlobsForUser } from "../crypto/offlineVault";
import { useAuthStore } from "./auth";
import { purgeAttachmentAccount, purgeAttachmentLink, purgeAttachmentMessage, purgeAttachmentSession, purgeExpiredAttachments } from "src/composables/useBlobAttachmentCache";
import { useBlobAttachmentCache } from 'src/composables/useBlobAttachmentCache';
import { showArrivalBanner } from 'src/composables/useArrivalBanner';
import { chatMessageStorageKeys, linkIdFromMessageKey } from '../utils/storageRecovery';
import { MAX_RATCHET_RECEIPTS } from '../crypto/types';
import type {
  InternalMessagePacket,
  DecryptedMessage as BaseDecryptedMessage,
  RatchetState,
} from '../crypto/types';
import type { Link, LinkUserDevice } from 'src/types/links';
import { sanitizeStoredMessages } from 'src/utils/storedMessages';
import { isNativeBuild, isNativeShellActive, isTauriRuntime, mobilePlatform } from 'src/utils/platform';
import {
  applyMobileDeviceRegistration,
  isMobileAuthRuntime,
  scheduleMobileSessionRefresh,
} from 'src/services/mobileAuth';
import {
  buildHistoryEnvelope,
  historyEntryId,
  parseHistoryEnvelope,
  resolveSelfSessionInitiator,
} from '../crypto/selfSession';
import type { MobileDeviceRegistrationPayload } from 'src/types/api';

/**
 * Per-link throttle for read receipts. The UI calls `markLinkRead` on every
 * message-count change and every focus event, but the server cursor only needs
 * one write per conversation every few seconds — without this, opening a busy
 * chat hammered POST /vault/links/:id/read.
 */
const readReportedAt = new Map<string, number>();
function packetReceiptHash(linkId: string, packet: InternalMessagePacket, senderDevicePub: string): string {
  // Fixed-order, domain-separated transcript; id alone is relay-controlled, not
  // proof that this ciphertext/header/direction was authenticated and retained.
  return sodium.to_hex(sodium.crypto_generichash(32, sodium.from_string(JSON.stringify([
    'vault-receipt-v1', linkId, senderDevicePub, packet.id,
    packet.linkId ?? null, packet.suiteId ?? null, packet.senderDeviceId,
    packet.ciphertextHex, packet.nonceHex, packet.senderDHRPubHex,
    packet.messageIndex ?? 0, packet.pn ?? 0, packet.outgoing === true,
    packet.createdAt, packet.expiresAt ?? null,
  ])), null));
}

const READ_REPORT_MIN_INTERVAL_MS = 4_000;

/**
 * Upper bound on frames held in `realtimeBuffer`.
 *
 * The buffer exists to hold socket frames for the gap when the vault cannot
 * decrypt yet (init in flight, pending fetch in flight, a retry that must wait
 * for history). Nothing used to cap it, so a device that cannot initialize (no
 * password yet, enrollment cooldown) accumulated every pushed frame in memory
 * for as long as it stayed that way — and then lost all of them on teardown.
 * These frames are relay copies: the server keeps them as pending until ACKed,
 * so dropping the OLDEST is safe (a redelivery replaces it) while keeping the
 * newest keeps the conversation moving.
 */
const REALTIME_BUFFER_LIMIT = 200;

/** Push a frame into the buffer, drop-oldest past the cap, never duplicate an id. */
function bufferRealtimeFrame(
  buffer: InternalMessagePacket[],
  packet: InternalMessagePacket,
): boolean {
  if (buffer.some((entry) => entry.id === packet.id)) return false;
  buffer.push(packet);
  if (buffer.length > REALTIME_BUFFER_LIMIT) {
    const dropped = buffer.splice(0, buffer.length - REALTIME_BUFFER_LIMIT);
    console.warn('[Vault] Realtime buffer at capacity; dropped oldest frames (relay redelivers unacknowledged)', {
      dropped: dropped.length,
      limit: REALTIME_BUFFER_LIMIT,
      droppedIds: dropped.map((entry) => entry.id),
    });
  }
  return true;
}

/**
 * The visible text of a stored message. Outgoing rows hold the full JSON
 * envelope while history rows hold the bare body, so comparing two rows means
 * comparing what they would RENDER, not their raw storage payload.
 */
function messageBodyOf(raw: string | undefined): string {
  if (!raw) return '';
  if (raw.charAt(0) !== '{') return raw;
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    return typeof parsed?.text === 'string' ? parsed.text : raw;
  } catch {
    return raw;
  }
}

export type RetentionMode = 'persistent' | 'ephemeral_time' | 'ephemeral_session';
export type MessageStatus = 'SENDING' | 'SENT' | 'FAILED_NETWORK' | 'FAILED_PROTOCOL';

export interface ChatSettings {
  mode: RetentionMode;
  retainHours?: number;
  /** Per-chat mute: suppress notification sounds for this chat when true. */
  muted?: boolean;
}

export interface ClientMessage extends BaseDecryptedMessage {
  id: string;
  isSender: boolean;
  // Owning user id of the message sender. Resolved once at append time from
  // already-available link metadata; never re-derived per render and never sent
  // to the server. Prefer this over `isSender` for rendering identity so a stale
  // per-account flag can't mislabel messages after an account switch.
  senderId?: string;
  timestamp: number;
  isUnsafe?: boolean;
  reactions?: Record<string, string[]>;
  status?: MessageStatus;
}

function resolveVaultTransportTarget(): { host: string; secure: boolean; path: string } {
  const envWsBase = (import.meta.env.VITE_VAULT_WS_BASE || import.meta.env.VITE_WS_BASE) as
    string | undefined;
  const fallbackBase = resolveApiUrl('/');
  const rawBase = envWsBase || fallbackBase;
  const parsed = new URL(rawBase, 'http://localhost:3000');
  const isDev = import.meta.env.QUASAR_DEV;

  if (isDev) {
    return {
      host: 'localhost:3000',
      secure: false,
      path: '/ws/secure',
    };
  }

  const explicitWsPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : null;
  return {
    host: parsed.host || 'localhost:3000',
    secure: parsed.protocol === 'https:' || parsed.protocol === 'wss:',
    path: explicitWsPath || '/api/v1/vault/ws/secure',
  };
}

interface QuarantinedMessage {
  packet: InternalMessagePacket;
  senderDevicePub: string;
  senderIdentityPub?: string | null;
}

/** Upper bound on quarantined frames kept per link (memory and storage). */
const QUARANTINE_MAX_PER_LINK = 200;
const QUARANTINE_KEY_PREFIX = 'vault_quarantine_v1_';
const QUARANTINE_SEAL_CONTEXT = 'mourn:vault-quarantine:v1';

/** Account-scoped storage key for a link's quarantined frames. */
function quarantineStorageKey(linkId: string, uid: string): string {
  return `${QUARANTINE_KEY_PREFIX}${linkId}_uid_${uid}`;
}

/**
 * Derive the at-rest sealing key for this account's quarantine.
 *
 * HKDF over the account's stored vault device PRIVATE key, salted with the
 * account id and bound (as AEAD `additionalData`) to account + link: the record
 * is opaque to anything that can only read IndexedDB, cannot be moved to another
 * link or account, and fails loudly (rather than silently mis-decrypting) if it
 * was tampered with. No new key material is stored.
 */
async function quarantineSealKey(uid: string, linkId: string): Promise<Uint8Array> {
  const stored = await useVaultStore().keyManager.getStoredKey(`vault_device_priv_${uid}`);
  if (!stored || stored.length === 0) throw new Error('Quarantine seal key is unavailable');
  return sodium.crypto_generichash(
    sodium.crypto_generichash_BYTES,
    sodium.from_string(`${QUARANTINE_SEAL_CONTEXT}|${linkId}|${uid}`),
    stored,
  );
}

/** Encrypt quarantined frames into the opaque record written to storage. */
async function sealQuarantine(
  uid: string,
  linkId: string,
  queue: readonly QuarantinedMessage[],
): Promise<{ v: 1; n: string; c: string }> {
  const key = await quarantineSealKey(uid, linkId);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(JSON.stringify(queue)),
    sodium.from_string(`${uid}|${linkId}`),
    null,
    nonce,
    key,
  );
  return { v: 1, n: sodium.to_hex(nonce), c: sodium.to_hex(ciphertext) };
}

/** Decrypt an opaque quarantine record. Corrupt/foreign records return []. */
async function openQuarantine(
  uid: string,
  linkId: string,
  sealed: unknown,
): Promise<QuarantinedMessage[]> {
  try {
    const record = sealed as { v?: unknown; n?: unknown; c?: unknown };
    if (record?.v !== 1 || typeof record.n !== 'string' || typeof record.c !== 'string') return [];
    const key = await quarantineSealKey(uid, linkId);
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      sodium.from_hex(record.c),
      sodium.from_string(`${uid}|${linkId}`),
      sodium.from_hex(record.n),
      key,
    );
    const parsed: unknown = JSON.parse(sodium.to_string(plaintext));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is QuarantinedMessage =>
        Boolean(
          entry &&
            typeof entry === 'object' &&
            (entry as QuarantinedMessage).packet &&
            typeof (entry as QuarantinedMessage).packet.id === 'string' &&
            typeof (entry as QuarantinedMessage).senderDevicePub === 'string',
        ),
    );
  } catch (err) {
    console.warn('[Vault] Quarantined record could not be opened', err);
    return [];
  }
}

/** One encrypted copy of an outgoing message, bound to a recipient device. */
interface SendFrame {
  targetDeviceId: string;
  ciphertextHex: string;
  nonceHex: string;
  messageIndex: number;
  senderDHRPubHex: string;
  pn: number;
  clientMessageId?: string;
}

/**
 * Frames built for an outgoing row that has not been delivered yet.
 *
 * A frame is bound to the sender's ratchet index the moment it is encrypted, and
 * that index is persisted immediately (another process may have consumed it), so
 * re-encrypting a retry advances the chain again and leaves a hole the receiver
 * can never fill. A retry replays these frames instead. In-memory only and lost
 * on restart, which is correct: the relay dedupes by row id, and the sender
 * chain stays consistent either way.
 */
const sendFramesByRow = new WeakMap<ClientMessage, { partnerUserId: string; frames: SendFrame[] }>();
/** Monotonic suffix for locally-created row ids (see `nextLocalMessageId`). */
let nextLocalMessageSeq = 0;

/** One of the current user's OWN devices, as returned by GET /api/v1/vault/devices. */
export interface OwnVaultDevice {
  id: string;
  devicePub: string;
  /** Server DevicePlatform (ANDROID/IOS/UNKNOWN) — null for older rows. */
  platform?: string | null;
}

/** How long a fetched own-devices list stays fresh before a refetch (5 min). */
const OWN_VAULT_DEVICES_TTL_MS = 5 * 60 * 1000;

/** Per-account own-device cache (uid -> { at, devices }). */
const ownVaultDevicesCache = new Map<string, { at: number; devices: OwnVaultDevice[] }>();

/**
 * Last time (ms) each account asked the desktop to relay history. Guards
 * `requestHistoryFromDesktop()` so re-`initialize()` (reconnect, account switch
 * in the same page load) and socket re-connections do not spam the desktop —
 * but unlike the old once-per-session Set, it expires, so a request that was
 * lost to a socket flap or an offline desktop is retried on the next reconnect.
 */
const historyRequestedAt = new Map<string, number>();
const HISTORY_REQUEST_COOLDOWN_MS = 20_000;

/**
 * Map the runtime's `mobilePlatform()` value onto the server `DevicePlatform`
 * enum. Android/iOS pass through; desktop/Tauri/browser map to UNKNOWN (the
 * schema has no DESKTOP value) — which is exactly the "not mobile" signal
 * `resolveSelfSessionInitiator()` keys off to elect the desktop as initiator.
 */
export function serverPlatformFromMobile(
  p: 'android' | 'ios' | 'other',
): 'ANDROID' | 'IOS' | 'UNKNOWN' {
  if (p === 'android') return 'ANDROID';
  if (p === 'ios') return 'IOS';
  return 'UNKNOWN';
}

interface VaultState {
  isInitialized: boolean;
  deviceId: string | null;
  transport: VaultTransport | null;
  transportHost: string | null;
  transportPath: string;
  /** Send-budget reservations, as `<reservation-ms>:<sequence>` tokens. Named
   *  differently from the old `sendTimestamps` STATE key on purpose: a Pinia
   *  option-store action that shares a state key's name shadows that field, so
   *  `this.sendTimestamps = …` inside such an action silently wrote the action. */
  sendBudgetEntries: string[];
  rateLimitedUntil: number | null;
  connectionError: string | null;
  /** Live socket state for the connectivity indicator — flips on every
   *  transport open/close (reactive, unlike `transport.isOpen()`). */
  transportConnected: boolean;
  /** The server's `code` from the last failed device registration — lets the UI
   *  distinguish "wrong password" (CURRENT_PASSWORD_REQUIRED) from every other
   *  enrollment failure, which all previously collapsed into one opaque message. */
  enrollmentErrorCode: string | null;
  /** Server `retryAfter` hint from a 429 on the enrollment endpoint. */
  enrollmentRetryAfter: string | null;
  /** Timestamp until which device-enrollment HTTP requests are skipped. A single
   *  failed enrollment used to be re-fired by every concurrent `initialize()`
   *  caller (auto-login, boot prompt, messaging watchers), exhausting the
   *  server's per-user 30/hour limit within seconds of one Unlock tap. */
  enrollmentCooldownUntil: number | null;
  serverClockOffsetMs: number;
  serverClockSyncedAt: number | null;
  engines: Record<string, CipherEngine>; // linkId -> engine
  freshEngineBindings?: Record<
    string,
    { myDevicePubHex: string; theirDevicePubHex: string; bindingTime: number }
  >; // Bindings for fresh engines
  activeSettings: Record<string, ChatSettings>; // linkId -> settings
  /** Account-level retention default (source of truth across devices). */
  accountRetention: ChatSettings | null;
  messages: Record<string, ClientMessage[]>; // linkId -> messages
  /**
   * linkId -> whether its message list has finished loading.
   *
   * Distinguishes "we have not read this conversation yet" from "this conversation
   * is genuinely empty". Without it a transient empty read (a store re-init, or a
   * teardown mid-send) rendered the empty "SECURE CHANNEL ACTIVE" state over a chat
   * that has messages — the "chats show empty" report.
   */
  messageLoadState: Record<string, 'loading' | 'ready' | 'error'>;
  keyManager: KeyManager;
  devicePubKeyHex: string | null;
  deviceToken: string | null;
  compromisedLinks: Record<string, boolean>;
  overrideSecurity: Record<string, boolean>;
  unreadLinks: Record<string, boolean>;
  unreadMessageCounts: Record<string, number>;
  /**
   * Last message activity per link (ms epoch), persisted alongside the unread
   * state. The chat list sorts by this so ordering stays correct even for
   * conversations whose messages have not been loaded into memory yet — the
   * server's `Link.updatedAt` is not bumped when a message is sent, so sorting
   * on it alone produced the "random" order users reported.
   */
  linkLastActivity: Record<string, number>;
  quarantinedMessages: Record<string, QuarantinedMessage[]>;
  /**
   * Devices whose identity pin MISMATCHED and was quarantined.
   *
   * A mismatch used to be recorded only in `compromisedLinks`, which is a link
   * flag: every later frame on the link was "unsafe" (decrypted on the same
   * ratchet the mismatching frame never consumed) and the link stayed blocked
   * until the user acted. Recording the device makes the state recoverable — the
   * link is released the moment the user re-pins THAT device — and lets the
   * mismatching identity alone be quarantined while the rest of the link works.
   */
  quarantinedDevices: Record<string, Record<string, true>>;
  trustedPartnerDevices: Record<string, string | null>;
  trustedPartnerIdentities: Record<string, string | null>;
  /**
   * Pinned identity keys, one per DEVICE of the link: linkId -> deviceId -> hex.
   *
   * A link is held by every device the partner has (phone + desktop), and each
   * device generates its own identity key. `trustedPartnerIdentities` kept a
   * single key per link, so the partner messaging from their second device (or
   * from any new install) looked like a key swap and the client quarantined
   * every message and told the link it was "not safe". Pinning per device keeps
   * the real signal — the SAME device presenting a DIFFERENT key — and treats a
   * new device as a first-seen device instead of a compromise.
   */
  trustedDeviceIdentities: Record<string, Record<string, string>>;
  pendingPartnerDevices: Record<string, string | null>;
  pendingPartnerIdentities: Record<string, string | null>;
  tempSafetyUntil: Record<string, number | null>;
  lastPartnerDevices: Record<string, string | null>;
  deletedMessageIds: Record<string, string[]>;
  lastDecryptFailureAt: Record<string, number>;
  decryptQueueByEngine: Map<string, Promise<void>>;
  decryptFailureCountByMessageId: Record<string, number>;
  engineFailureCounts: Record<string, number>;
  droppedCiphertextIds: Set<string>;
  activeLinkId: string | null;
  loadingLinks: Set<string>; // SAFETY: Track which links are loading to prevent race conditions
  processingMessageIds: Set<string>; // SAFETY: Prevent concurrent decryption of same message ID
  processedMessageIds: Record<string, number>; // SAFETY: Skip duplicate redelivery after successful handling
  pendingFetchInProgress: boolean; // Buffer realtime WS messages during pending fetch
  realtimeBuffer: InternalMessagePacket[]; // Buffered realtime messages during pending fetch
  deliveryStatusUnavailable: boolean;
  lastHeartbeatTimes: Record<string, number>; // Track last heartbeat time per linkId to enable rate limiting
  attemptedMessageIds: Set<string>; // SAFETY: Track messages attempted for decryption to prevent re-attempts
  sessionId: string; // SECURITY: Session ID to invalidate ratchet state from prior sessions
  initializationPromise: Promise<void> | null;
  skRecoveryAttempted: Set<string>; // SAFETY: Track messages already retried for SK recovery (device pub mismatch)
  nackRetryQueue: Record<
    string,
    { messageText: string; partnerUserId: string; retryCount: number }
  >; // Transient queue for NACK retries
  reestablishingLinks: Set<string>; // Links currently re-establishing after NACK
  appFocused: boolean;
  /**
   * When true, per-message notification sounds are suppressed (batch sync /
   * initial vault establishment). At the end of the batch we play a single
   * sound only if the aggregate unread count is > 3.
   */
  batchSyncInProgress: boolean;
  /** Counts unread messages accumulated during a batch sync (for the >3 rule). */
  batchUnreadAccumulated: number;
}

// Stable per-install identifier used to re-key an existing device row after a
// local key wipe instead of registering the same physical device a second time.
// Stored in IndexedDB (survives app restarts and the vault-key regeneration that
// happens on a failed enrollment), keyed globally — not per account.
const VAULT_INSTALL_ID_KEY = 'vault_install_id';
let installIdCache: string | null = null;

function generateInstallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 for environments without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getOrCreateInstallId(): Promise<string> {
  if (installIdCache) return installIdCache;
  try {
    const stored = await get<string | null>(VAULT_INSTALL_ID_KEY);
    if (stored && /^[0-9a-fA-F-]{8,64}$/.test(stored)) {
      installIdCache = stored;
      return stored;
    }
  } catch {
    // fall through to generation
  }
  const fresh = generateInstallId();
  installIdCache = fresh;
  try {
    await set(VAULT_INSTALL_ID_KEY, fresh);
  } catch {
    // non-fatal: a lost install id only means the next enrollment creates a new row
  }
  return fresh;
}

let sendBudgetSeq = 0;
/** Monotonic part of a send-budget reservation token (see `beginSendBudget`). */
function nextSendBudgetSeq(): number {
  sendBudgetSeq += 1;
  return sendBudgetSeq;
}

export const useVaultStore = defineStore('vault', {
  state: (): VaultState => ({
    isInitialized: false,
    deviceId: null,
    transport: null,
    transportHost: null,
    transportPath: '/api/v1/vault/ws/secure',
    sendBudgetEntries: [],
    rateLimitedUntil: null,
    connectionError: null,
    transportConnected: false,
    enrollmentErrorCode: null,
    enrollmentRetryAfter: null,
    enrollmentCooldownUntil: null,
    serverClockOffsetMs: 0,
    serverClockSyncedAt: null,
    engines: {},
    freshEngineBindings: {},
    activeSettings: {},
    accountRetention: null,
    messages: {},
    messageLoadState: {},
    keyManager: new KeyManager(),
    devicePubKeyHex: null,
    deviceToken: null,
    compromisedLinks: {},
    overrideSecurity: {},
    unreadLinks: {},
    unreadMessageCounts: {},
    linkLastActivity: {},
    quarantinedMessages: {},
    quarantinedDevices: {},
    trustedPartnerDevices: {},
    trustedPartnerIdentities: {},
    trustedDeviceIdentities: {},
    pendingPartnerDevices: {},
    pendingPartnerIdentities: {},
    tempSafetyUntil: {},
    lastPartnerDevices: {},
    deletedMessageIds: {},
    lastDecryptFailureAt: {},
    decryptQueueByEngine: new Map(),
    decryptFailureCountByMessageId: {},
    engineFailureCounts: {},
    droppedCiphertextIds: new Set(),
    activeLinkId: null,
    loadingLinks: new Set(),
    processingMessageIds: new Set(),
    processedMessageIds: {},
    pendingFetchInProgress: false,
    realtimeBuffer: [] as InternalMessagePacket[],
    deliveryStatusUnavailable: false,
    lastHeartbeatTimes: {},
    attemptedMessageIds: new Set(),
    sessionId: '',
    initializationPromise: null,
    skRecoveryAttempted: new Set(),
    nackRetryQueue: {},
    reestablishingLinks: new Set(),
    appFocused: true,
    batchSyncInProgress: false,
    batchUnreadAccumulated: 0,
  }),
  getters: {
    unreadCount(): number {
      return Object.values(this.unreadMessageCounts).reduce(
        (total, count) => total + (count || 0),
        0,
      );
    },
    isLinkCompromised:
      (state) =>
      (linkId: string): boolean => {
        return state.compromisedLinks[linkId] === true;
      },
  },
  actions: {
    async syncServerClockOffset(): Promise<void> {
      const startedAt = Date.now();

      try {
        const response = await api.get('/api/health', {
          headers: { Accept: 'application/json' },
          validateStatus: () => true,
        });
        const finishedAt = Date.now();
        const serverTimestamp = response.data?.timestamp;
        const serverMs = typeof serverTimestamp === 'string' ? Date.parse(serverTimestamp) : NaN;

        if (!Number.isFinite(serverMs)) {
          return;
        }

        // Estimate the server time at the midpoint of the request. This keeps
        // optimistic local messages on the same UTC epoch clock as backend
        // createdAt values, avoiding PC-clock/timezone skew in message sorting.
        const midpointClientMs = startedAt + (finishedAt - startedAt) / 2;
        this.serverClockOffsetMs = Math.round(serverMs - midpointClientMs);
        this.serverClockSyncedAt = finishedAt;
      } catch (err) {
        console.debug('[Vault] Server clock sync failed; falling back to local clock', err);
      }
    },

    async ensureTransportConnected(): Promise<void> {
      if (!this.transport) throw new Error('vault transport not ready');
      if (this.transport.isOpen()) return;

      const target = resolveVaultTransportTarget();
      const host = this.transportHost || target.host;
      const secureTransport = this.transportHost ? undefined : target.secure;
      const transportPath = this.transportPath || target.path;
      this.transportHost = host;
      this.transportPath = transportPath;
      await this.transport.connect(host, secureTransport, transportPath);
      this.connectionError = null;
    },

    /**
     * Bookkeeping for the send budget (10 frames per rolling 3 s per link).
     *
     * A slot is RESERVED before the first `await` so concurrent sends cannot all
     * pass the window check, and RELEASED on every exit that did not hand bytes
     * to the socket — a refused or failed attempt must not spend the budget.
     *
     * Entries are compared by a reservation token, not by timestamp: two sends
     * in the same millisecond are real on a fast device, and timestamp equality
     * made an accepted send erase an earlier accepted send's slot.
     */
    beginSendBudget(now: number): string {
      const entry = now + ':' + nextSendBudgetSeq();
      this.sendBudgetEntries = [
        ...(this.sendBudgetEntries || []).filter((t) => now - Number(t.split(':')[0]) <= 3000),
        entry,
      ];
      return entry;
    },

    settleSendBudget(entry: string, accepted: boolean): void {
      const current = this.sendBudgetEntries || [];
      if (!current.includes(entry)) return;
      this.sendBudgetEntries = accepted ? current : current.filter((t) => t !== entry);
    },

    currentServerEpochMs(): number {
      return Date.now() + (this.serverClockOffsetMs || 0);
    },

    /** Id for a locally-created outgoing row: unique even within one millisecond. */
    nextLocalMessageId(): string {
      return `local_${this.currentServerEpochMs()}_${nextLocalMessageSeq++}`;
    },

    parseMessageEpochMs(value: number | string | undefined | null): number {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value);
      }

      if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }

      return this.currentServerEpochMs();
    },

    compareMessagesByEpoch(a: ClientMessage, b: ClientMessage): number {
      const delta = a.timestamp - b.timestamp;
      if (delta !== 0) return delta;
      return String(a.id).localeCompare(String(b.id));
    },

    getStorageUid(): string {
      // Storage identity follows the active auth store, never a stale browser cache.
      return useAuthStore().user?.id || 'unknown';
    },

    async clearAllVaultDataForUser(userId: string): Promise<void> {
      if (!userId || userId === 'unknown') throw new Error('Local wipe requires an account');
      if (useAuthStore().user?.id === userId) throw new Error('Sign out before wiping active account data');
      const cleanup = await runCleanup([
        { owner: 'attachments', clear: () => purgeAttachmentAccount(userId) },
        { owner: 'ratchets', clear: () => removeEncryptedRatchetStates(userId) },
        { owner: 'offline blobs', clear: () => clearOfflineBlobsForUser(userId) },
        { owner: 'MLS checkpoints', clear: async () => {
          const { clearMlsStorageForUser } = await import('../crypto/mlsDb');
          const result = await clearMlsStorageForUser(userId);
          if (result.retainedLegacyRecords.length) throw new Error('Unscoped legacy MLS rows and recovery key retained; owner review required');
        } },
        { owner: 'native watcher', clear: async () => {
          if (!isTauriRuntime()) return;
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('watcher_clear_logs', { accountId: userId });
        } },
        { owner: 'browser cursors', clear: () => {
          if (typeof localStorage === 'undefined') return;
          for (const key of Object.keys(localStorage)) {
            if ((key.startsWith('group_sync_') && key.endsWith('_uid_' + userId)) || key === 'mourn_links_purged_' + userId || key === 'vault_unread_state_' + userId) localStorage.removeItem(key);
          }
        } },
      ]);
      if (!cleanup.success) throw new Error('Local wipe incomplete; recovery keys retained: ' + cleanup.failed.map((item) => item.owner + ': ' + item.error).join('; '));
      const failures: string[] = [];
      // Delete known key material and enumerate account-scoped legacy records.

      const keysToDelete = [
        `vault_identity_priv_${userId}`,
        `vault_identity_pub_${userId}`,
        `vault_device_priv_${userId}`,
        `vault_device_pub_${userId}`,
        `vault_device_id_${userId}`,
        `vault_device_token_${userId}`,
      ];

      const ratchetIndexKey = `vault_ratchet_index_${userId}`;
      const ratchetKeys = (await get<string[]>(ratchetIndexKey)) || [];

      // Remove key material from both the desktop OS keychain and any legacy
      // IndexedDB location. Browser builds only use IndexedDB.
      for (const key of keysToDelete) {
        await this.keyManager.deleteStoredKey(key).catch(() => { failures.push('secure storage'); });
      }

      for (const ratchetKey of ratchetKeys) {
        await del(ratchetKey).catch(() => { failures.push('ratchet storage'); });
      }
      await del(ratchetIndexKey).catch(() => { failures.push('ratchet index'); });

      // Account removal/deletion is a device wipe, not an ordinary logout.
      // Enumerate this app's idb-keyval store so decrypted messages, settings,
      // unread state, and any future user-scoped records cannot survive simply
      // because their link IDs were not available in memory at cleanup time.
      const allKeys = await keys();
      const userSuffix = `_uid_${userId}`;
      const userPrefixes = [
        `vault_unread_state_${userId}`,
        `vault_identity_`,
        `vault_device_`,
        `vault_ratchet_index_${userId}`,
      ];
      for (const key of allKeys) {
        if (typeof key !== 'string') continue;
        const isUserScoped =
          key.endsWith(userSuffix) ||
          key === ratchetIndexKey ||
          userPrefixes.some((prefix) =>
            prefix.endsWith('_')
              ? key.startsWith(prefix) && key.endsWith(`_${userId}`)
              : key === prefix,
          );
        if (isUserScoped) await del(key).catch(() => { failures.push('account storage'); });
      }

      if (failures.length) throw new Error('Local wipe incomplete: ' + [...new Set(failures)].join(', '));
      if (import.meta.env.DEV) {
        console.debug(`[Vault] Cleared all vault data for user: ${userId}`);
      }
    },

    async initialize(options: { currentPassword?: string } = {}): Promise<void> {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      if (this.initializationPromise) {
        const existingInitialization = this.initializationPromise;
        await operation.wait(() => existingInitialization);
        if (!this.isInitialized && options.currentPassword) {
          if (this.initializationPromise === existingInitialization) {
            this.initializationPromise = null;
          }
          return this.initialize(options);
        }
        return;
      }
      if (this.isInitialized) return;

      this.initializationPromise = (async () => {
        // SECURITY: Generate unique session ID to reject ratchet states from prior sessions
        // This prevents loading stale encryption state if purge didn't fully clear
        this.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        this.deliveryStatusUnavailable = false;
        console.debug('[Vault] Generated session ID', { sessionId: this.sessionId });

        const initSessionId = this.sessionId;
        const assertInitCurrent = () => {
          operation.assertCurrent();
          if (this.sessionId !== initSessionId) throw new Error('Vault initialization superseded');
        };
        const waitForInit = async <T>(work: () => T | PromiseLike<T>): Promise<T> => {
          assertInitCurrent();
          try {
            const result = await work();
            assertInitCurrent();
            return result;
          } catch (error) {
            assertInitCurrent();
            throw error;
          }
        };
        await waitForInit(() => this.keyManager.init());
        await waitForInit(() => sodium.ready);

        const authStore = useAuthStore();
        await waitForInit(() => authStore.fetchCsrfToken());
        await waitForInit(() => this.syncServerClockOffset());

        if (!authStore.user?.id) {
          console.warn('Cannot init vault without active user ID');
          return;
        }
        const uid = authStore.user.id;
        // Capture the identity + session this init belongs to. clearVaultState()
        // resets sessionId and the active user on logout, so an in-flight init from
        // a previous account can be aborted before it mutates shared vault state.
        const isStaleInit = () => !operation.isCurrent() || this.sessionId !== initSessionId || authStore.user?.id !== uid;

        this.hydrateUnreadState();

        // SECURITY-CONSCIOUS: Load the account-level Vault retention (decay timer)
        // so all devices share one setting (not per-device). Failure is non-fatal —
        // local per-link settings still work as a fallback.
        try {
          this.accountRetention = await waitForInit(() => this.loadAccountSettings());
        } catch (err) {
          assertInitCurrent();
          console.warn('[Vault] Could not load account retention on init', err);
          this.accountRetention = null;
        }

        // Check if we already have local keys for this device profile
        const identityPrivMap = await waitForInit(() => this.keyManager.getStoredKey(`vault_identity_priv_${uid}`));
        const devicePrivMap = await waitForInit(() => this.keyManager.getStoredKey(`vault_device_priv_${uid}`));

        let identityPubHex = '';
        let devicePubHex = '';

        if (!identityPrivMap || !devicePrivMap) {
          // Create brand new
          const idKeys = this.keyManager.generateIdentityKeyPair();
          const devKeys = this.keyManager.generateDeviceKeyPair();
          await waitForInit(() => this.keyManager.storeKey(`vault_identity_priv_${uid}`, idKeys.privateKey));
          await waitForInit(() => this.keyManager.storeKey(`vault_identity_pub_${uid}`, idKeys.publicKey));
          await waitForInit(() => this.keyManager.storeKey(`vault_device_priv_${uid}`, devKeys.privateKey));
          await waitForInit(() => this.keyManager.storeKey(`vault_device_pub_${uid}`, devKeys.publicKey));

          identityPubHex = sodium.to_hex(idKeys.publicKey);
          devicePubHex = sodium.to_hex(devKeys.publicKey);
        } else {
          // Load from IDB
          const idPubMap = await waitForInit(() => this.keyManager.getStoredKey(`vault_identity_pub_${uid}`));
          const devPubMap = await waitForInit(() => this.keyManager.getStoredKey(`vault_device_pub_${uid}`));
          if (idPubMap) identityPubHex = sodium.to_hex(idPubMap);
          if (devPubMap) devicePubHex = sodium.to_hex(devPubMap);
          this.deviceId = (await waitForInit(() => get<string>(`vault_device_id_${uid}`))) || null;
          this.deviceToken = null;
        }

        // True when this device already carried a local identity + backend device
        // id — i.e. this is a REOPEN of an already-enrolled device, not a first
        // enrollment. Used below to skip re-provisioning work (MLS group
        // enrollment, a redundant notification refetch) that only a brand-new
        // device needs, so reopening the app just reconnects instead of
        // re-running the whole bootstrap.
        const hadStoredDevice = Boolean(identityPubHex && devicePubHex && this.deviceId);

        // Always ensure backend registration to avoid stale/deleted device IDs.
        let registrationOk = false;
        // A brand-new device (no stored identity/device id) can ONLY enroll with a
        // password — the server rejects a password-less registration of a new
        // device with CURRENT_PASSWORD_REQUIRED. The auto-login path has no
        // password, so attempting it is a guaranteed 403 that still consumes two
        // rate-limit slots (challenge + register) on every cold start. Skip it
        // entirely and leave the "locked, needs enrollment" state for the UI to
        // surface, instead of wasting the enrollment budget.
        if (!hadStoredDevice && !options.currentPassword) {
          this.connectionError = 'vault_device_registration_failed';
          this.enrollmentErrorCode = 'CURRENT_PASSWORD_REQUIRED';
          return;
        }
        if (identityPubHex && devicePubHex) {
          // Cooldown: at most one enrollment request per window, regardless of how
          // many initialize() callers are in flight. Without this, a failed
          // enrollment is re-fired by every concurrent caller and the server's
          // 30/hour per-user limit is exhausted in seconds — which then presents
          // as a permanent "enrollment failed" no matter what the user does.
          // A password-bearing attempt is a deliberate user action (the Unlock
          // prompt) and is rare — let it through. The cooldown only gates the
          // password-less auto-retries (auto-login, boot prompt, messaging
          // watchers) that used to re-fire enrollment in a tight loop.
          if (
            !options.currentPassword &&
            this.enrollmentCooldownUntil &&
            Date.now() < this.enrollmentCooldownUntil
          ) {
            console.warn(
              '[Vault] Skipping device enrollment (cooldown until ' +
                new Date(this.enrollmentCooldownUntil).toISOString() +
                ')',
            );
            return;
          }
          try {
            const identityPrivKey = await waitForInit(() => this.keyManager.getStoredKey(
              `vault_identity_priv_${uid}`,
            ));
            if (!identityPrivKey) {
              throw new Error('Identity private key not found');
            }

            const deviceChallengePath = isMobileAuthRuntime()
              ? '/api/v1/auth/mobile/register-device/challenge'
              : '/api/v1/vault/devices/challenge';
            const deviceRegistrationPath = isMobileAuthRuntime()
              ? '/api/v1/auth/mobile/register-device'
              : '/api/v1/vault/devices';
            const challengeResponse = await api.post<{
              success: boolean;
              challenge: { id: string; nonce: string; expiresAt: string };
            }>(
              deviceChallengePath,
              {},
              {
                headers: { 'X-CSRF-Token': authStore.csrfToken },
                withCredentials: !isMobileAuthRuntime(),
              },
            );
            assertInitCurrent();
            const deviceChallenge = challengeResponse.data.challenge;
            if (!challengeResponse.data.success || !deviceChallenge?.id || !deviceChallenge.nonce) {
              throw new Error('Device proof challenge was not issued');
            }

            const msgToSign = [
              'mourn/device-bind/v1',
              deviceChallenge.id,
              deviceChallenge.nonce,
              uid,
            ].join('\n');
            const proofTranscript = `${msgToSign}\n${identityPubHex}\n${devicePubHex}`;
            const signatureBytes = sodium.crypto_sign_detached(
              sodium.from_string(proofTranscript),
              identityPrivKey,
            );
            const signatureHex = sodium.to_hex(signatureBytes);

            const res = await api.post<MobileDeviceRegistrationPayload>(
              deviceRegistrationPath,
              {
                identityPub: identityPubHex,
                devicePub: devicePubHex,
                signature: signatureHex,
                challengeId: deviceChallenge.id,
                challenge: deviceChallenge.nonce,
                currentPassword: options.currentPassword,
                installId: await waitForInit(() => getOrCreateInstallId()),
              },
              {
                headers: { 'X-CSRF-Token': authStore.csrfToken },
                withCredentials: !isMobileAuthRuntime(),
              },
            );
            assertInitCurrent();
            if (res.data.success && res.data.device?.id) {
              this.deviceId = res.data.device.id;
              this.deviceToken = res.data.deviceToken || null;
              const registeredDeviceId = this.deviceId;
              await waitForInit(() => set(`vault_device_id_${uid}`, registeredDeviceId));
              if (isMobileAuthRuntime()) {
                const mobileSession = await waitForInit(() => applyMobileDeviceRegistration(res.data));
                authStore.csrfToken = mobileSession?.csrfToken ?? '';
                if (mobileSession) {
                  scheduleMobileSessionRefresh(mobileSession, refreshMobileSession);
                }
                const { onMobileDeviceRegistered } = await waitForInit(() => import('src/services/mobilePush'));
                void onMobileDeviceRegistered().catch((error) => {
                  console.warn('[Push] Post-enrollment registration failed', error);
                });
              }
              registrationOk = true;
              this.enrollmentErrorCode = null;
              this.enrollmentCooldownUntil = null;
            } else {
              const errorMsg = res.data.error || 'Device registration failed';
              console.error('Failed to reg device (Success false):', errorMsg);
              this.enrollmentErrorCode =
                (res.data as unknown as { code?: string }).code || null;
              this.deviceId = null;
              this.deviceToken = null;
              // Enrollment failure does not revoke the stored device identity.
            }
          } catch (err) {
            assertInitCurrent();
            const axiosErr = err as {
              response?: {
                status?: number;
                data?: { error?: string; code?: string; retryAfter?: string };
              };
            };
            const errorMsg = axiosErr?.response?.data?.error || (err as Error).message;
            console.error('Failed to reg device err:', errorMsg);
            // The enrollment endpoint is rate-limited per user (30/hour). A 429
            // here is not a password problem — it is "stop retrying". Capture it
            // distinctly so the UI can say so, instead of collapsing it into the
            // generic "couldn't enroll" message that made it look like a bad
            // password. Also remember the server's retry hint.
            // 429 → rate-limited; otherwise trust the body's `code`, and fall
            // back to matching the message for DEVICE_LIMIT, which the server
            // returns as a bare message with no code field.
            this.enrollmentErrorCode =
              axiosErr?.response?.status === 429
                ? 'RATE_LIMITED'
                : axiosErr?.response?.data?.code ||
                  (/device limit/i.test(errorMsg) ? 'DEVICE_LIMIT' : null);
            this.enrollmentRetryAfter = axiosErr?.response?.data?.retryAfter || null;
            this.deviceId = null;
            this.deviceToken = null;
            // Preserve the enrolled identity for a password-less retry.
          }
        }

        if (!registrationOk) {
          this.connectionError = 'vault_device_registration_failed';
          // Back off: a failed enrollment must not be retried by the next
          // concurrent caller a millisecond later. 30s is enough for a transient
          // failure to clear but far under the server's 1-hour window, so a real
          // retry (after the user re-enters the password) still succeeds.
          this.enrollmentCooldownUntil = Date.now() + 30_000;
          return;
        }

        this.devicePubKeyHex = devicePubHex;

        // Best-effort: ensure every user is auto-added to the global
        // announcement broadcast channel (if they aren't already) and unlock
        // its key so the channel renders in the Suites tab. Never fatal — a
        // broadcast failure must not break vault init or the E2E transport.
        try {
          const { useBroadcastStore } = await waitForInit(() => import('./broadcastStore'));
          await waitForInit(() => useBroadcastStore().ensureInit());
        } catch (broadcastErr) {
          assertInitCurrent();
          console.warn('[Vault] Broadcast auto-add skipped (non-fatal):', broadcastErr);
        }

        if (isStaleInit()) return;

        // Ensure transport setup
        if (this.deviceId && this.deviceToken) {
          if (this.transport) {
            try {
              (this.transport as VaultTransport & { disconnect?: () => void }).disconnect?.();
            } catch {
              // ignore disconnect race
            }
          }
          const transportDeviceId = this.deviceId;
          const transportToken = this.deviceToken || '';
          this.transport = new VaultTransport(transportDeviceId, transportToken, async () => {
            // The Vault transport only exists inside a native shell (Tauri
            // desktop / Capacitor mobile). Fail closed on the website.
            if (!isNativeShellActive()) {
              throw new Error('Vault transport is not available in this runtime.');
            }

            await waitForInit(() => authStore.fetchCsrfToken());
            const { data } = await api.post<{
              success: boolean;
              deviceToken: string;
              challenge: { id: string; nonce: string; expiresAt: string };
            }>(
              '/api/v1/vault/ws-challenge',
              { deviceId: transportDeviceId },
              {
                headers: authStore.csrfToken ? { 'X-CSRF-Token': authStore.csrfToken } : undefined,
                withCredentials: true,
              },
            );
            assertInitCurrent();
            if (
              !data.success ||
              !data.deviceToken ||
              !data.challenge?.id ||
              !data.challenge.nonce
            ) {
              throw new Error('Vault WebSocket challenge was not issued.');
            }

            const identityPrivateKey = await waitForInit(() => this.keyManager.getStoredKey(
              `vault_identity_priv_${uid}`,
            ));
            if (!identityPrivateKey) {
              throw new Error('Vault identity private key is unavailable.');
            }
            const tokenDigest = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(data.deviceToken),
            );
            const tokenHash = Array.from(new Uint8Array(tokenDigest), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
            const transcript = [
              'mourn/vault-ws/v1',
              data.challenge.id,
              data.challenge.nonce,
              transportDeviceId,
              tokenHash,
            ].join('\n');
            assertInitCurrent();
            const signature = sodium.to_hex(
              sodium.crypto_sign_detached(sodium.from_string(transcript), identityPrivateKey),
            );
            return {
              token: data.deviceToken,
              proof: `device-proof.${data.challenge.id}.${data.challenge.nonce}.${signature}`,
            };
          });
          const {
            host,
            secure: secureTransport,
            path: transportPath,
          } = resolveVaultTransportTarget();
          this.transportHost = host;
          this.transportPath = transportPath;
          try {
            await waitForInit(() => this.transport!.connect(host, secureTransport, transportPath));
            this.connectionError = null;
            this.transportConnected = true;
          } catch (err) {
            assertInitCurrent();
            this.connectionError = err instanceof Error ? err.message : 'connect_failed';
            this.transportConnected = false;
            throw err;
          }
          this.transport.onMessage = this.handleIncomingMessage.bind(this);
          // Re-request history backfill whenever the socket re-establishes. The
          // one-shot init request is fire-and-forget, so a flap or an offline
          // desktop at boot left the phone with an empty chat list forever.
          this.transport.onConnectionChange = (open: boolean) => {
            this.transportConnected = open;
            if (open && isMobileAuthRuntime()) {
              void this.requestHistoryFromDesktop();
            }
          };
          // Another one of this account's devices read a thread: drop the badge
          // here too, so a phone in hand stops showing unread immediately.
          this.transport.onVaultReadSync = ({ linkId }) => {
            if (!linkId) return;
            if (!this.unreadLinks[linkId] && !this.unreadMessageCounts[linkId]) return;
            this.unreadLinks[linkId] = false;
            this.unreadMessageCounts[linkId] = 0;
            this.unreadLinks = { ...this.unreadLinks };
            this.unreadMessageCounts = { ...this.unreadMessageCounts };
            void this.persistUnreadState();
            void this.syncUnreadBadge();
          };

          const notificationsStore = (await waitForInit(() => import('stores/notifications'))).useNotificationsStore();
          this.transport.onNotification = (payload: unknown) => {
            try {
              const data = payload as { id?: string };
              // Minimal shape guard
              if (data && typeof data === 'object') {
                notificationsStore.addNotification(payload as never);
                const typed = data as {
                  id?: string;
                  type?: string;
                  data?: { groupId?: string; kind?: string };
                };
                if (typed.type === 'LINK_REQUEST') {
                  void import('stores/links')
                    .then((m) => m.useLinksStore().fetchLinks({ silent: true }))
                    .catch((err) => {
                      console.error(
                        '[Vault] Failed to refresh links for request notification',
                        err,
                      );
                    });
                }
                const groupKind = typed.data?.kind ?? typed.type;
                if (typed.data?.kind === 'DOMAIN_DECISION') {
                  // A domain the user asked us to verify was approved/rejected. On
                  // approval the visitor warning has to disappear without a restart:
                  // refresh the recognition overlay + the user's own request list.
                  void import('stores/approvedDomains')
                    .then(async (m) => {
                      await m.useApprovedDomainsStore().refresh();
                      const requests = await import('stores/domainRequests');
                      await requests.useDomainRequestsStore().fetchMine();
                    })
                    .catch((err) => {
                      console.error('[Vault] Failed to refresh domain recognition', err);
                    });
                } else if (groupKind === 'GROUP_JOIN_ACCEPTED' && typed.data?.groupId) {
                  // The owner accepted our public join request — publish our MLS
                  // key package so their client can compute the Add commit + Welcome.
                  void import('stores/groupStore')
                    .then(async (m) => {
                      const groupStore = m.useGroupStore();
                      const published = await groupStore.publishMlsKeyPackageForGroup(
                        typed.data!.groupId!,
                      );
                      if (!published) throw new Error('MLS key package publication failed');
                      await groupStore.handleGroupNotification(typed);
                      if (typed.id) await notificationsStore.markAsRead(typed.id);
                    })
                    .catch((err) => {
                      console.error('[Vault] Failed to publish key package for accepted join', err);
                    });
                } else if (
                  groupKind === 'GROUP_JOIN_REJECTED' ||
                  groupKind === 'GROUP_MEMBER_REMOVED'
                ) {
                  void import('stores/groupStore')
                    .then((m) => m.useGroupStore().handleGroupNotification(typed))
                    .catch((err) => {
                      console.error('[Vault] Failed to process Suite notification', err);
                    });
                }
              }
            } catch (err) {
              console.error('[Vault] Failed to process notification payload', err);
            }
          };

          this.transport.onLinkEstablished = async () => {
            try {
              // Do not set activeLinkId / localStorage — that auto-opens messaging + vault settings.
              const linksStore = (await import('stores/links')).useLinksStore();
              await linksStore.fetchLinks();
            } catch (err) {
              console.error('[Vault] Failed to handle LINK_ESTABLISHED payload', err);
            }
          };

          this.transport.onLinkSevered = async (payload: unknown) => {
            try {
              const data = payload as {
                linkId?: string;
                link?: Link;
                purged?: boolean;
                purgedLocally?: boolean;
                notification?: unknown;
                initiator?: string;
              };
              const linksStore = (await import('stores/links')).useLinksStore();
              const notificationsStore = (
                await import('stores/notifications')
              ).useNotificationsStore();
              const linkId = data.linkId ?? data.link?.id;

              // We purged: wipe device chat and drop from chat list (do not upsert SEVERED)
              if (data.purgedLocally && linkId) {
                await this.purgeLinkLocal(linkId);
                linksStore.markLinkPurgedLocally(linkId);
                delete this.unreadLinks[linkId];
                delete this.unreadMessageCounts[linkId];
                this.unreadLinks = { ...this.unreadLinks };
                this.unreadMessageCounts = { ...this.unreadMessageCounts };
                void this.syncUnreadBadge();
                return;
              }

              if (linkId) {
                await this.clearLinkCryptoState(linkId);
              }

              linksStore.applySeveredEvent({
                linkId,
                link: data.link as Link | undefined,
                purgedLocally: data.purgedLocally,
              });

              if (linkId) {
                // The chat no longer exists, so it cannot carry a message-unread
                // marker. The durable sever notification below remains in Signals
                // until the user reads it there.
                delete this.unreadLinks[linkId];
                delete this.unreadMessageCounts[linkId];
                this.unreadLinks = { ...this.unreadLinks };
                this.unreadMessageCounts = { ...this.unreadMessageCounts };
                void this.syncUnreadBadge();
              }

              if (data.notification) {
                notificationsStore.addNotification(data.notification as never);
              }

              if (!data.purgedLocally && data.initiator) {
                Notify.create({
                  type: 'warning',
                  message: 'Link was closed by your partner.',
                  position: 'bottom-right',
                  classes: 'font-mono',
                });
              }
            } catch (err) {
              console.error('[Vault] Failed to handle LINK_SEVERED payload', err);
            }
          };

          this.transport.onVaultSyncRequest = async (payload) => {
            try {
              // Surface the request to the user so it's not a silent nudge.
              const data = (payload || {}) as { requesterDeviceId?: string };
              const requesterId = data.requesterDeviceId ?? this.deviceId ?? '';
              try {
                Notify.create({
                  type: 'info',
                  message:
                    requesterId && requesterId !== this.deviceId
                      ? 'Message sync requested by another device.'
                      : 'Message sync requested across your devices.',
                  timeout: 4000,
                  classes: 'font-mono bg-black text-white border border-[#1a1a1a]',
                });
              } catch (notifyErr) {
                console.warn('[Vault] Failed to show sync request notification', notifyErr);
              }

              await this.beginBatchSync(async () => {
                await this.fetchPendingMessages();
              });
              const notificationsStore = (
                await import('stores/notifications')
              ).useNotificationsStore();
              await notificationsStore.fetchNotifications();
            } catch (err) {
              console.error('[Vault] Failed to process VAULT_SYNC_REQUEST', err);
            }
          };

          // Desktop answers another own-device's request to relay history.
          this.transport.onVaultHistoryRequest = this.handleVaultHistoryRequest.bind(this);

          // SIGNAL-LIKE RECOVERY: Handle incoming NACKs to trigger reestablishment
          this.transport.onMessageNack = this.handleMessageNack.bind(this);

          // Handle delete-for-everyone notices (both real-time and queued on reconnect)
          this.transport.onDeleteNotice = ({
            linkId,
            targetMessageId,
          }: {
            tombstoneId: string;
            linkId: string;
            targetMessageId: string;
          }) => {
            this.trackDeletedMessage(linkId, targetMessageId);
            void this.deleteMessageById(linkId, targetMessageId);
          };
          this.transport.flushPendingEvents();

          this.transport.onAccountLogin = async (payload: unknown) => {
            try {
              const data = payload as {
                id?: string;
                sessionId?: string;
                deviceName?: string;
                ipAddress?: string | null;
                ipHash?: string | null;
                userAgent?: string | null;
                createdAt?: string;
                identityPub?: string | null;
              };
              if (!data?.sessionId) return;
              const { useSecurityStore } = await import('stores/security');
              void useSecurityStore().pushLoginAlert({
                id: data.id || data.sessionId,
                sessionId: data.sessionId,
                deviceName: data.deviceName || 'Unknown',
                ipAddress: data.ipAddress ?? null,
                ipHash: data.ipHash ?? null,
                userAgent: data.userAgent ?? null,
                createdAt: data.createdAt || new Date().toISOString(),
                identityPub: data.identityPub ?? null,
              });
            } catch (err) {
              console.error('[Vault] Failed to handle ACCOUNT_LOGIN payload', err);
            }
          };

          this.transport.onPartnerIdentityTrust = async (payload: unknown) => {
            try {
              const data = payload as { linkId?: string; identityPub?: string };
              if (!data?.linkId || !data?.identityPub) return;
              await this.markLinkSafe(data.linkId, data.identityPub);
            } catch (err) {
              console.error('[Vault] Failed to handle PARTNER_IDENTITY_TRUST payload', err);
            }
          };

          this.transport.onBroadcastMessage = (p) => {
            import('./broadcastStore')
              .then((m) => {
                const store = m.useBroadcastStore();
                if (store.activeChannel?.id === p.channelId) {
                  void store.loadHistory({ background: true, notify: !store.viewing });
                }
              })
              .catch((err) => console.error('[Vault] broadcast message handler failed', err));
          };

          // --- MLS group real-time handlers (zero-trust: server only relays blobs) ---
          this.transport.onGroupMessage = (p) => {
            import('stores/groupStore')
              .then((m) => m.useGroupStore().handleIncomingGroupMessage(p as never))
              .catch((err) => console.error('[Vault] group message handler failed', err));
          };
          this.transport.onGroupMlsCommit = (p) => {
            import('stores/groupStore')
              .then(async (m) => {
                const store = m.useGroupStore();
                await store.applyInboundCommit(p.groupId, p.commit);
                await store.fetchGroupDetails(p.groupId);
              })
              .catch((err) => console.error('[Vault] group mls commit handler failed', err));
          };
          this.transport.onGroupMlsWelcome = (p) => {
            if (p.deviceId && p.deviceId !== this.deviceId) return;
            import('stores/groupStore')
              .then(async (m) => {
                const groupStore = m.useGroupStore();
                await groupStore.joinMlsFromWelcome(p.groupId, p.welcomeBlob);
                // A Welcome may arrive after the initial history request. Retry
                // now that this device has the correct per-member MLS state.
                await groupStore.fetchHistory(p.groupId);
              })
              .catch((err) => console.error('[Vault] group mls welcome handler failed', err));
          };
          this.transport.onGroupEpochMismatch = (p) => {
            // Our local MLS ratchet fell behind the group epoch (e.g. we missed
            // a commit). Reconcile from server tree state so the next send works
            // instead of silently dropping the message.
            import('stores/groupStore')
              .then((m) => m.useGroupStore().handleEpochMismatch(p.groupId, p.receivedEpoch))
              .catch((err) => console.error('[Vault] group epoch mismatch handler failed', err));
          };
          this.transport.onGroupMessageRejected = (p) => {
            // The server kept hitting a Serializable conflict for this Suite
            // message and refused it. The local row was written before the send,
            // so mark it failed instead of leaving it looking delivered.
            import('stores/groupStore')
              .then((m) => m.useGroupStore().handleMessageRejected(p.groupId, p.epoch, p.reason))
              .catch((err) => console.error('[Vault] group message rejected handler failed', err));
          };
          this.transport.onGroupMemberLeft = (p) => {
            // A member left voluntarily. If we are the group's remaining owner
            // (we hold the authoritative ratchet tree), Remove-commit their
            // device leaves so the departed device can't decrypt future
            // messages — restoring forward secrecy on self-leave too.
            import('stores/groupStore')
              .then((m) =>
                m.useGroupStore().handleMemberLeft(p.groupId, p.leftDeviceIds, p.leftUserId),
              )
              .catch((err) => console.error('[Vault] group member-left handler failed', err));
          };
          this.transport.onInviteAccepted = (p) => {
            // Owner/Admin side: an invitee accepted — compute + relay the MLS
            // Add commit + Welcome for them (the server only relayed this signal).
            import('stores/groupStore')
              .then(async (m) => {
                const store = m.useGroupStore();
                await store.ownerAddMember(
                  p.groupId,
                  p.inviteeId,
                  p.inviteeDeviceId,
                  p.reAdd === true,
                );
                await store.fetchGroupDetails(p.groupId);
              })
              .catch((err) => console.error('[Vault] invite accepted mls handler failed', err));
          };
          this.transport.onInviteReceived = (p) => {
            // Invitee side: someone invited us — surface it in the Signals panel
            // and toast a realtime notification. The MLS join happens on accept.
            import('stores/groupStore')
              .then((m) => {
                const store = m.useGroupStore();
                // Refetch the durable row instead of constructing a partial
                // invite from a realtime payload. This keeps Signals identical
                // whether the invite arrived online or while the app was closed.
                void store.fetchMyInvites();
                Notify.create({
                  type: 'info',
                  message: `Invited to ${p.groupName}`,
                  caption: 'Open Signals to accept',
                  position: 'bottom-right',
                  classes: 'font-mono',
                });
              })
              .catch((err) => console.error('[Vault] invite received handler failed', err));
          };

          if (isStaleInit()) return;

          // Fetch any pending offline messages immediately after transport is live
          try {
            const linksStore = (await waitForInit(() => import('stores/links'))).useLinksStore();
            await waitForInit(() => linksStore.fetchLinks());
          } catch (err) {
            assertInitCurrent();
            console.warn('[Vault] Failed to refresh links before pending-message fetch', err);
          }
          await waitForInit(() => this.fetchPendingMessages());
          try {
            const groupStore = (await waitForInit(() => import('stores/groupStore'))).useGroupStore();
            await waitForInit(() => groupStore.fetchGroups());
            await waitForInit(() => groupStore.enrollCurrentDeviceInGroups());
            await waitForInit(() => groupStore.syncOfflineMessages());
          } catch (err) {
            assertInitCurrent();
            console.warn('[Vault] Failed to synchronize offline Suite messages', err);
          }
          // Only needed on a first enrollment — MainLayout fetches notifications
          // on mount and every push now triggers a refetch, so on a reopen this
          // was a redundant round-trip in the critical path of the "syncing"
          // overlay.
          if (!hadStoredDevice) {
            await waitForInit(() => notificationsStore.fetchNotifications());
          }
        }
        assertInitCurrent();

        // NEVER mark the vault initialized without a usable WSS transport. The
        // transport is only built when deviceId + deviceToken are both present (the
        // `if (this.deviceId && this.deviceToken)` block above); a mobile re-auth /
        // session refresh that lost the device token used to fall straight through
        // to here, set the flag, and then EVERY send threw "WSS transport missing.
        // Initialize vault first." with no way back — because `initialize()` no-ops
        // once `isInitialized` is true. That is the reported "can't text after a
        // ghost notification" + media-send failure. Leaving the flag false lets the
        // next send/foreground re-init cleanly.
        if (!this.transport) {
          this.connectionError = 'vault_transport_unavailable';
          console.warn(
            '[Vault] Init finished without a WSS transport — leaving uninitialized so a later send can recover',
          );
          return;
        }

        // Mark vault as initialized BEFORE draining buffered messages
        // This ensures any NEW messages arriving during drain see isInitialized = true
        this.isInitialized = true;

        // Mobile: once per app session, ask the desktop to backfill history so a
        // freshly-paired phone reconstructs the conversation. Best-effort and
        // fire-and-forget — never blocks or fails initialization.
        if (isMobileAuthRuntime()) {
          void this.requestHistoryFromDesktop();
        }

        // Reconcile badges with what the account already read elsewhere. A device
        // that was offline while the desktop read a thread used to come back with
        // every unread dot still lit.
        void this.syncReadStates();

        // Clean up duplicate history rows left on disk by older builds.
        void this.repairDuplicateHistoryRows();

        // Drain any messages that arrived during reinitialization (e.g., account switch)
        // These were buffered to prevent use with stale/uninitialized state
        if (this.realtimeBuffer.length > 0) {
          console.log('[Vault] Draining buffered messages after initialization', {
            count: this.realtimeBuffer.length,
          });
          const buffered = this.realtimeBuffer.splice(0);
          for (const pkt of buffered) {
            try {
              await this.handleIncomingMessage(pkt);
            } catch (err) {
              console.error('[Vault] Failed to process buffered message', {
                messageId: pkt.id,
                err,
              });
            }
          }
        }
      })();

      const initialization = this.initializationPromise;
      try {
        await initialization;
      } finally {
        if (this.initializationPromise === initialization) this.initializationPromise = null;
      }
    },

    /**
     * Guarantee a LIVE WSS transport, rebuilding it when it has gone missing.
     *
     * The old send path threw "WSS transport missing. Initialize vault first."
     * from a dead end: `initialize()` no-ops once `isInitialized` is true, so any
     * state where the transport was torn down (a mobile re-auth / session refresh
     * that lost the device token, a failed reconnect, a mid-init failure) while
     * the flag survived left sending PERMANENTLY broken until the app was
     * restarted — the reported "can't text after a ghost notification" and the
     * image/camera send failure. Clearing the stale flag and re-running init makes
     * every send self-heal instead of dead-ending.
     */
    async ensureVaultTransport(): Promise<void> {
      if (!this.transport) {
        // A "initialized with no transport" state can only be stale — clear the
        // flag so initialize() actually runs instead of early-returning.
        if (this.isInitialized) this.isInitialized = false;
        try {
          await this.initialize();
        } catch (err) {
          console.warn('[Vault] Transport recovery via initialize failed', err);
        }
      }

      if (!this.transport) {
        throw new Error('WSS transport missing. Initialize vault first.');
      }

      if (!this.transport.isOpen()) {
        const target = resolveVaultTransportTarget();
        const host = this.transportHost || target.host;
        const secureTransport = this.transportHost ? undefined : target.secure;
        const transportPath = this.transportPath || target.path;
        this.transportHost = host;
        this.transportPath = transportPath;
        try {
          await this.transport.connect(host, secureTransport, transportPath);
          this.connectionError = null;
        } catch (err) {
          this.connectionError = err instanceof Error ? err.message : 'connect_failed';
          throw err;
        }
      }

      await this.transport.ensureConnected();
    },

    /**
     * Device-authorization drift: the server no longer authorises the device id
     * this client is sending (the session's bound device changed). Clear the
     * cached identity so the next vault init re-registers cleanly instead of
     * every request failing with 403 forever.
     */
    async clearStaleDeviceIdentity(): Promise<void> {
      // A 403 on the pending fetch means the SESSION bound to this device was
      // invalidated/rebound, NOT that the device is gone. Keep the persisted
      // device id + keys: the next initialize() re-registers the same keypair,
      // re-binds the session, and recovers without a password prompt. Deleting
      // the persisted id here (the old behaviour) is what turned a transient
      // 403 into the permanent "unlock" lockout.
      this.deviceId = null;
      this.deviceToken = null;
      console.warn('[Vault] Marked device identity stale after a 403 (will re-register on next init).');
    },

    async fetchPendingMessages(options?: { forceRetry?: boolean }) {
      const operation = captureAccountOperation();
      const deviceId = this.deviceId;
      const transport = this.transport;
      const isCurrent = () => operation.isCurrent() && this.deviceId === deviceId && this.transport === transport;
      if (!operation.uid || !deviceId) return;
      // Prevent concurrent pending fetches
      if (this.pendingFetchInProgress) return;
      this.pendingFetchInProgress = true;

      const affectedLinks = new Set<string>();
      const maxRetries = 3;

      try {
        const authStore = (await import('stores/auth')).useAuthStore();
        if (!isCurrent()) return;
        await authStore.fetchCsrfToken();
        if (!isCurrent()) return;

        let lastErr: unknown;
        let fetched = false;
        // A 403 is an authorization failure, not a transient one: retrying the
        // same device id can never succeed, and it is exactly the case the
        // stale-identity recovery below exists for. (The retry loop used to
        // swallow the error, which made that recovery branch unreachable — the
        // client hammered the endpoint 3x per call instead of re-registering.)
        let forbidden = false;

        for (let attempt = 0; attempt < maxRetries && !fetched; attempt++) {
          if (!isCurrent()) return;
          try {
            const { data } = await api.get('/api/v1/vault/messages/pending', {
              params: { deviceId },
            });
            if (!isCurrent()) return;

            const pending = Array.isArray(data?.data) ? data.data : [];
            for (const msg of pending) {
              const pkt = {
                id: msg.id,
                linkId: msg.linkId,
                senderDeviceId: msg.senderDeviceId,
                suiteId: msg.suiteId,
                ciphertextHex: msg.ciphertextHex,
                nonceHex: msg.nonceHex,
                createdAt: msg.createdAt,
                messageIndex: msg.messageIndex ?? 0,
                senderDHRPubHex: msg.senderDHRPubHex,
                pn: msg.pn ?? 0,
                // Server-derived (vault.routes.js pending route): true when this
                // row is a self-sync copy addressed to one of OUR OWN devices.
                // Dropping it made every relayed own-device frame enter as an
                // inbound partner message: wrong engine, phantom unread/sound,
                // or a silent drop when the own device is not in the link yet.
                // Undefined (not false) for rows that do not carry it.
                outgoing: msg.outgoing === true ? true : undefined,
              };

              try {
                const msgCopy = { ...pkt };
                if ('linkId' in msgCopy) {
                  affectedLinks.add((msgCopy as { linkId: string }).linkId);
                }
              } catch {
                /* ignore */
              }

              if (options?.forceRetry) {
                delete this.processedMessageIds[pkt.id];
                this.attemptedMessageIds.delete(pkt.id);
                this.droppedCiphertextIds.delete(pkt.id);
              }

              await this.handleIncomingMessage(pkt);
              if (!isCurrent()) return;
            }

            fetched = true;
            console.log('[Vault] Pending messages fetched successfully', { count: pending.length });
          } catch (err) {
            if (!isCurrent()) return;
            lastErr = err;
            const status = (err as { response?: { status?: number } })?.response?.status;
            const backoffMs = 100 * Math.pow(2, attempt);

            if (status === 403) {
              forbidden = true;
              console.warn(
                '[Vault] Pending fetch returned 403 — device identity is stale. Not retrying.',
              );
              break;
            }

            if (attempt < maxRetries - 1) {
              console.warn(
                `[Vault] Pending fetch failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${backoffMs}ms`,
                err,
              );
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            } else {
              console.error(`[Vault] Pending fetch failed after ${maxRetries} attempts`, lastErr);
            }
          }
        }

        if (!isCurrent()) return;
        if (forbidden) {
          this.pendingFetchInProgress = false;
          this.connectionError = 'vault_device_not_authorized';
          await this.clearStaleDeviceIdentity();
          return;
        }

        // SECURITY: Re-sort all affected links after pending fetch to ensure correct chronological order.
        // Pending and realtime messages may have arrived out of order; timestamp sort fixes this.
        for (const linkId of affectedLinks) {
          if (this.messages[linkId]) {
            this.messages[linkId].sort(this.compareMessagesByEpoch);
          }
        }

        // Force reactive refresh after batch append
        this.messages = { ...this.messages };
      } catch (err) {
        if (!isCurrent()) return;
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr?.response?.status === 403) {
          // Same recovery as the in-loop 403 path (e.g. the CSRF prefetch 403s).
          this.pendingFetchInProgress = false;
          this.connectionError = 'vault_device_not_authorized';
          await this.clearStaleDeviceIdentity();
          return;
        }
        console.error('[Vault] Failed to fetch pending messages', err);
      } finally {
        if (isCurrent()) {
          this.pendingFetchInProgress = false;
          // Drain any realtime messages that arrived during the pending fetch
          // SECURITY: Filter out messages already processed during pending fetch
          const buffered = this.realtimeBuffer.splice(0);
          const toProcess = buffered.filter((pkt) => {
            // Skip if already marked as processed (within 5-minute window)
            const processedAt = this.processedMessageIds[pkt.id] || 0;
            if (processedAt > 0 && Date.now() - processedAt < 5 * 60 * 1000) {
              console.debug(
                '[Vault] Skipping realtime buffer message already processed during pending fetch',
                {
                  messageId: pkt.id,
                },
              );
              return false;
            }
            return true;
          });

          // Track which links were affected by realtime drain
          for (const pkt of toProcess) {
            if (!isCurrent()) break;
            await this.handleIncomingMessage(pkt);
          }

          if (isCurrent()) {
            // Final sort pass on all active message arrays to ensure absolute chronological order
            for (const linkId in this.messages) {
              if (this.messages[linkId] && this.messages[linkId].length > 0) {
                this.messages[linkId].sort(this.compareMessagesByEpoch);
              }
            }

            this.messages = { ...this.messages };
          }
        }
      }
    },

    async getTrustedPartnerDevice(linkId: string): Promise<string | null> {
      if (this.trustedPartnerDevices[linkId] !== undefined) {
        return this.trustedPartnerDevices[linkId] ?? null;
      }
      const uid = this.getStorageUid();
      const key = `vault_partner_device_${linkId}_uid_${uid}`;
      const stored = await get<string | null>(key);
      this.trustedPartnerDevices[linkId] = stored ?? null;
      return stored ?? null;
    },

    async setTrustedPartnerDevice(linkId: string, deviceId: string | null) {
      this.trustedPartnerDevices[linkId] = deviceId;
      const uid = this.getStorageUid();
      const key = `vault_partner_device_${linkId}_uid_${uid}`;
      await set(key, deviceId ?? null);
    },

    async getTrustedPartnerIdentity(linkId: string): Promise<string | null> {
      if (this.trustedPartnerIdentities[linkId] !== undefined) {
        return this.trustedPartnerIdentities[linkId] ?? null;
      }
      const uid = this.getStorageUid();
      const key = `vault_trusted_identity_${linkId}_uid_${uid}`;
      const stored = await get<string | null>(key);
      this.trustedPartnerIdentities[linkId] = stored ?? null;
      return stored ?? null;
    },

    async setTrustedPartnerIdentity(linkId: string, identityPubHex: string | null) {
      this.trustedPartnerIdentities[linkId] = identityPubHex ?? null;
      const uid = this.getStorageUid();
      const key = `vault_trusted_identity_${linkId}_uid_${uid}`;
      await set(key, identityPubHex ? identityPubHex.trim().toLowerCase() : null);
    },

    /**
     * The identity key we pinned for ONE device of this link.
     * Returns null when this device has never been seen for the link.
     */
    async getTrustedDeviceIdentity(linkId: string, deviceId: string): Promise<string | null> {
      if (!deviceId) return null;
      const operation = captureAccountOperation();
      if (!operation.uid) return null;
      let pins = this.trustedDeviceIdentities[linkId];
      if (!pins) {
        const key = `vault_trusted_device_identity_${linkId}_uid_${operation.uid}`;
        const stored = await operation.wait(() => get<Record<string, string>>(key));
        pins = stored && typeof stored === 'object' ? stored : {};
        this.trustedDeviceIdentities[linkId] = pins;
      }
      const pinned = pins[deviceId];
      return pinned ? pinned.trim().toLowerCase() : null;
    },

    /** Pin (or re-pin) the identity key of one device of this link. */
    async setTrustedDeviceIdentity(
      linkId: string,
      deviceId: string,
      identityPubHex: string | null,
    ): Promise<void> {
      if (!deviceId) return;
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      await operation.wait(() => this.getTrustedDeviceIdentity(linkId, deviceId));
      const normalized = identityPubHex ? identityPubHex.trim().toLowerCase() : null;
      const pins = { ...(this.trustedDeviceIdentities[linkId] || {}) };
      if (normalized) pins[deviceId] = normalized;
      else delete pins[deviceId];
      this.trustedDeviceIdentities[linkId] = pins;
      this.trustedDeviceIdentities = { ...this.trustedDeviceIdentities };
      const key = `vault_trusted_device_identity_${linkId}_uid_${operation.uid}`;
      await operation.wait(() => set(key, pins));
    },

    async getEngine(
      linkId: string,
      partnerDevicePubHex: string,
      engineKey?: string,
      partnerUserId?: string,
      selfSessionPeer?: { platform?: string | null },
    ): Promise<CipherEngine> {
      const operation = captureAccountOperation();
      const uid = operation.uid;
      if (!uid) throw new Error('Cannot run engine missing user id');
      const deviceId = this.deviceId;
      const keyManager = this.keyManager;
      const assertCurrent = () => {
        operation.assertCurrent();
        if (this.deviceId !== deviceId || this.keyManager !== keyManager) throw new Error('Vault device changed during engine creation');
      };
      const key = engineKey || linkId;
      if (this.engines[key]) return this.engines[key];

      // SECURITY: Crash detection - check for orphaned index entries from incomplete persistence
      // If index has entries but corresponding states don't exist, this signals a crash during persist.
      // We clean up the index to prevent repeated import failures.
      try {
        const idxKey = `vault_ratchet_index_${uid}`;
        const indexEntries = (await get<string[]>(idxKey)) || [];

        if (indexEntries.length > 0) {
          const cleanedEntries = [];
          for (const entryKey of indexEntries) {
            const stateExists = await get(entryKey);
            if (stateExists) {
              cleanedEntries.push(entryKey);
            } else {
              console.warn(
                '[Vault] Detected orphaned index entry (crash during persist), removing:',
                entryKey.slice(0, 30) + '...',
              );
            }
          }

          if (cleanedEntries.length !== indexEntries.length) {
            await set(idxKey, cleanedEntries.length > 0 ? cleanedEntries : []);
            console.log('[Vault] Reconciled ratchet state index after crash detection');
          }
        }
      } catch (crashDetectErr) {
        assertCurrent();
        console.error('[Vault] Crash detection check failed:', crashDetectErr);
      }
      assertCurrent();

      const myDevicePriv = await operation.wait(() => keyManager.getStoredKey(`vault_device_priv_${uid}`));
      assertCurrent();
      if (!myDevicePriv) throw new Error('Missing device priv key');

      // Cross-device (self-session) wiring: when the "partner" on this engine is
      // actually one of THIS account's own devices, the HMAC(userIds) role rule
      // degenerates (both sides compute the same sorted pair). Detect that here
      // and pass an explicit, symmetric role so the two devices pick opposite
      // ends of the ratchet. `resolveSelfSessionInitiator` guarantees the
      // desktop side initiates, so it can always send the history backfill.
      let selfSession: { iAmInitiator: boolean } | undefined;
      if (partnerUserId && partnerUserId === uid) {
        const myDevicePubHex = sodium.to_hex(sodium.crypto_scalarmult_base(myDevicePriv));
        const myPlatform = serverPlatformFromMobile(mobilePlatform());
        let theirPlatform: string | null = selfSessionPeer?.platform ?? null;
        if (theirPlatform == null) {
          try {
            const ownDevices = await this.getOwnVaultDevices();
            theirPlatform =
              ownDevices.find(
                (d) => d.devicePub?.toLowerCase() === partnerDevicePubHex.toLowerCase(),
              )?.platform ?? null;
          } catch (deviceLookupErr) {
            console.warn('[Vault] Self-session platform lookup failed', deviceLookupErr);
          }
        }
        selfSession = {
          iAmInitiator: resolveSelfSessionInitiator({
            myDevicePubHex,
            theirDevicePubHex: partnerDevicePubHex,
            myPlatform,
            theirPlatform,
          }),
        };
      }

      const engine = new CipherEngine();
      await engine.init(
        myDevicePriv,
        sodium.from_hex(partnerDevicePubHex),
        uid,
        partnerUserId,
        selfSession,
      );

      assertCurrent();
      const myDevicePub = sodium.crypto_scalarmult_base(myDevicePriv);
      const scope = { accountId: uid, deviceId: deviceId ?? sodium.to_hex(myDevicePub), sessionId: key };
      let state = await getEncryptedRatchetState(scope);
      operation.assertCurrent();
      const legacyKey = "vault_ratchet_v4_" + key + "_uid_" + uid;
      if (!state) {
        const legacy = await get<{ state?: RatchetState } | RatchetState>(legacyKey);
        operation.assertCurrent();
        if (legacy) {
          const candidate = "state" in legacy ? legacy.state : legacy as RatchetState;
          if (!candidate || (candidate.devicePubBinding && (candidate.devicePubBinding.myDevicePubHex !== sodium.to_hex(myDevicePub) || candidate.devicePubBinding.theirDevicePubHex !== partnerDevicePubHex))) throw new Error("Legacy ratchet binding mismatch; recovery required");
          await engine.importRatchetState(candidate);
          operation.assertCurrent();
          await setEncryptedRatchetState(scope, engine.exportRatchetState());
          operation.assertCurrent();
          await del(legacyKey);
          state = engine.exportRatchetState();
        }
      }
      if (state?.devicePubBinding && (
        state.devicePubBinding.myDevicePubHex !== sodium.to_hex(myDevicePub) ||
        state.devicePubBinding.theirDevicePubHex !== partnerDevicePubHex
      )) throw new Error('Ratchet binding mismatch; recovery required');
      if (state) await engine.importRatchetState(state);
      assertCurrent();
      this.freshEngineBindings ??= {};
      this.freshEngineBindings[key] = {
        myDevicePubHex: sodium.to_hex(myDevicePub),
        theirDevicePubHex: partnerDevicePubHex,
        bindingTime: Date.now(),
      };
      this.engines[key] = engine;
      return engine;
    },

    async persistEngineState(engineKey: string, operation = captureAccountOperation(), receivedPacketHash?: string): Promise<void> {
      operation.assertCurrent();
      const engine = this.engines[engineKey];
      if (!engine || !operation.uid || !this.deviceId) return;
      const scope = { accountId: operation.uid, deviceId: this.deviceId, sessionId: engineKey };
      const checkpoint = await operation.wait(() => getEncryptedRatchetState(scope));
      if (this.deviceId !== scope.deviceId) throw new Error('Vault device changed during checkpoint');
      const exported = engine.exportRatchetState();
      const binding = exported.devicePubBinding ?? this.freshEngineBindings?.[engineKey];
      const state = binding ? { ...exported, devicePubBinding: binding } : exported;
      // Engine export omits storage metadata. Carry evidence forward on EVERY
      // checkpoint, including sends, and commit a new receipt WITH key consumption.
      if (checkpoint?.receivedPacketHashes || receivedPacketHash) {
        const previous = checkpoint?.receivedPacketHashes ?? [];
        state.receivedPacketHashes = receivedPacketHash
          ? [...previous.filter((hash) => hash !== receivedPacketHash), receivedPacketHash].slice(-MAX_RATCHET_RECEIPTS)
          : [...previous];
      }
      await setEncryptedRatchetState(scope, state);
      operation.assertCurrent();
      // The encrypted write is the commit point. Legacy cleanup cannot turn a
      // durable checkpoint into a failure that callers would roll back in memory.
      try {
        await del("vault_ratchet_v4_" + engineKey + "_uid_" + operation.uid);
      } catch (error) {
        console.warn('[Vault] Encrypted checkpoint committed; legacy cleanup deferred', error);
      }
    },

    async persistMessages(linkId: string, operation = captureAccountOperation()): Promise<void> {
      operation.assertCurrent();
      if (!operation.uid) return;
      if (this.messageLoadState[linkId] !== 'ready') await operation.wait(() => this.loadMessages(linkId));
      operation.assertCurrent();
      if (this.messageLoadState[linkId] !== 'ready') throw new Error('Local history has not been read successfully; replacement write blocked');
      const settings = await this.loadChatSettings(linkId);
      operation.assertCurrent();
      const before = this.messages[linkId] ?? [];
      const current = retainedMessages(before, settings, (message) => message.timestamp);
      this.messages[linkId] = current;
      for (const message of before) if (!current.some((item) => item.id === message.id)) await purgeAttachmentMessage(operation.uid, linkId, message.id);
      operation.assertCurrent();
      const key = "vault_messages_" + linkId + "_uid_" + operation.uid;
      if (settings?.mode === "ephemeral_session") await del(key);
      else await set(key, JSON.parse(JSON.stringify(current)));
      operation.assertCurrent();
    },

    async exportRetainedMessages(linkId: string): Promise<ClientMessage[]> {
      const operation = captureAccountOperation();
      await this.persistMessages(linkId, operation);
      operation.assertCurrent();
      return JSON.parse(JSON.stringify(this.messages[linkId] ?? [])) as ClientMessage[];
    },

    async loadChatSettings(linkId: string): Promise<ChatSettings | null> {
      if (this.activeSettings[linkId]) return this.activeSettings[linkId];
      const operation = captureAccountOperation();
      const saved = await get<ChatSettings>(`vault_settings_${linkId}_uid_${this.getStorageUid()}`);
      operation.assertCurrent();
      if (saved) {
        this.activeSettings[linkId] = saved;
        return saved;
      }
      // Fall back to the account-level retention default (shared across devices).
      // The account default is the single source of truth for the decay timer;
      // a per-link local setting only overrides it for that one chat.
      if (this.accountRetention) {
        this.activeSettings[linkId] = { ...this.accountRetention };
        return this.activeSettings[linkId];
      }
      return null;
    },

    async saveChatSettings(linkId: string, settings: ChatSettings) {
      const plainSettings = JSON.parse(JSON.stringify(settings));
      this.activeSettings[linkId] = plainSettings;
      await set(`vault_settings_${linkId}_uid_${this.getStorageUid()}`, plainSettings);
    },

    /**
     * Fetch the account-level Vault retention (decay timer) setting from the
     * backend. This is the single source of truth shared across ALL devices.
     * Returns null if the server has no account default yet (caller may prompt).
     */
    async loadAccountSettings(): Promise<ChatSettings | null> {
      try {
        const authStore = (await import('stores/auth')).useAuthStore();
        await authStore.fetchCsrfToken();
        const { data } = await api.get<{ success: boolean; data: ChatSettings }>(
          '/api/v1/vault/settings',
        );
        if (data?.success && data.data) return data.data;
        return null;
      } catch (err) {
        console.warn('[Vault] Failed to load account settings, using local fallback', err);
        return null;
      }
    },

    /**
     * Persist the account-level Vault retention (decay timer) setting to the
     * backend so it applies on every device.
     */
    async saveAccountSettings(mode: RetentionMode, retainHours?: number) {
      const authStore = (await import('stores/auth')).useAuthStore();
      await authStore.fetchCsrfToken();
      await api.put(
        '/api/v1/vault/settings',
        { mode, retainHours: mode === 'ephemeral_time' ? retainHours : undefined },
        { headers: authStore.csrfToken ? { 'X-CSRF-Token': authStore.csrfToken } : {} },
      );
    },

    /**
     * Set/unset the per-chat mute flag for a link. Persisted alongside the
     * chat's retention settings so it survives reloads.
     */
    async setChatMuted(linkId: string, muted: boolean) {
      const current = (await this.loadChatSettings(linkId)) || {
        mode: this.activeSettings[linkId]?.mode || 'persistent',
      };
      await this.saveChatSettings(linkId, { ...current, muted });
    },

    /** Whether a chat is muted (suppresses notification sounds). */
    async isChatMuted(linkId: string): Promise<boolean> {
      const settings = await this.loadChatSettings(linkId);
      return settings?.muted === true;
    },

    async loadMessages(linkId: string) {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      this.messageLoadState[linkId] = 'loading';
      const storageKey = 'vault_messages_' + linkId + '_uid_' + operation.uid;
      // A failed read must not be overwritten with an empty successful write.
      let saved: ClientMessage[];
      try {
        const raw = await operation.wait(() => get<unknown>(storageKey));
        saved = sanitizeStoredMessages(raw) ?? [];
        if (raw != null && (!Array.isArray(raw) || raw.length !== saved.length)) {
          throw new Error('Malformed local history; repair or export the original record before replacing it');
        }
      } catch (error) {
        operation.assertCurrent();
        this.messageLoadState[linkId] = 'error';
        throw new Error('Unable to read local history; original record retained and replacement writes blocked', { cause: error });
      }

      const settings = await operation.wait(() => this.loadChatSettings(linkId));
      const deleted = new Set(this.deletedMessageIds[linkId] ?? []);
      const durable = settings?.mode === 'ephemeral_session' ? [] : saved;
      this.messages[linkId] = this.mergeMessageLists(this.messages[linkId] ?? [], durable)
        .filter((message) => !deleted.has(message.id));
      this.messages[linkId] = this.dedupeHistoryDuplicates(this.messages[linkId]);
      this.messageLoadState[linkId] = 'ready';
      await this.persistMessages(linkId, operation);
      await operation.wait(() => this.backfillLegacySenderIds(linkId));
    },

    async sendMessage(
      linkId: string,
      partnerUserId: string,
      partnerDevices: LinkUserDevice[],
      text: string,
      options?: { persistLocal?: boolean; localMessageId?: string; deleteTargetMessageId?: string },
    ) {
      const operation = captureAccountOperation();
      if (!operation.uid) throw new Error('Authentication required');
      const persistLocal = options?.persistLocal ?? true;
      const localMessageId = options?.localMessageId;
      const retryRow = localMessageId
        ? this.messages[linkId]?.find((message) => message.id === localMessageId)
        : undefined;
      const deleteTargetMessageId = options?.deleteTargetMessageId;
      const envelopeClientMessageId = this.extractClientMessageId(text) ?? undefined;

      if (text.length > 16_384) {
        throw new Error('MESSAGE_TOO_LONG');
      }

      const now = Date.now();
      // SECURITY: Rate limit per user per link, not just per device
      // This prevents user from opening many devices to bypass limit
      // Filter to the 3-second window (a reservation is settled later, so the
      // window is pruned here as well as in `beginSendBudget`).
      const inWindow = (this.sendBudgetEntries || []).filter(
        (t) => now - Number(t.split(':')[0]) <= 3000,
      );
      this.sendBudgetEntries = inWindow;

      // Max 10 messages per 3 seconds per unique link+device pair
      if (inWindow.length >= 10) {
        this.rateLimitedUntil = now + 3000;
        throw new Error('RATE_LIMIT');
      }

      this.rateLimitedUntil = null;

      // Reentrancy: two concurrent sends must not both pass the window check
      // above before either has reserved a slot. The budget entry is taken here —
      // BEFORE the first await — and released again unless the frame is accepted
      // by the transport (see `settleSendBudget`). Charging everything up front
      // billed every failure (a compromised link, no partner devices, a dead
      // socket) against the budget; charging only on success let a burst of
      // concurrent sends slip past the limit. A reservation does neither.
      const budgetEntry = this.beginSendBudget(now);
      let budgetSettled = false;

      try {
      // Guarantee a live transport (rebuilding it if it went missing) instead of
      // throwing from a dead end. See `ensureVaultTransport`.
      await operation.wait(() => this.ensureVaultTransport());
      if (!this.transport) throw new Error('WSS transport missing. Initialize vault first.');

      const unsafe = this.compromisedLinks[linkId] === true;
      const tempWindowActive = (this.tempSafetyUntil[linkId] ?? 0) > Date.now();
      if (unsafe && !tempWindowActive) {
        throw new Error('LINK_COMPROMISED');
      }

      const sanitizedDevices = (partnerDevices || []).filter((d): d is LinkUserDevice =>
        Boolean(d && d.id && d.devicePub),
      );
      if (sanitizedDevices.length === 0) {
        throw new Error('NO_PARTNER_DEVICES');
      }

      let outgoingMessageId = localMessageId;
      // A fresh send owns a brand-new row (SENDING). A retry (localMessageId
      // given) owns the existing one — it must not be treated as delivered just
      // because it was just appended.
      const wasAppendedNow = persistLocal;
      let outgoingRow: ClientMessage | undefined = undefined;
      type BuiltFrames = { partnerUserId: string; frames: SendFrame[] };
      const deliverableFrames = sendFramesByRow;
      // Accepted sends only: one entry per successful transport hand-off.
      // The frame is on the socket. Flip the row to SENT straight away and let
      // the durable write settle in the background: persisting used to run
      // inline, so a throw AFTER a successful hand-off surfaced to the caller as
      // a send failure and the row was marked FAILED although the peer had it.
      const markRowDelivered = (row: ClientMessage) => {
        row.status = 'SENT';
        deliverableFrames.delete(row);
        this.messages = { ...this.messages };
        if (!persistLocal) return;
        void this.persistMessages(linkId).catch((persistError) => {
          console.warn('[Vault] Failed to persist delivered status', persistError);
        });
      };
      if (persistLocal) {
        // Per-account counter, not only the timestamp: two sends in the same
        // millisecond produced the same `local_<ts>` id, and appendMessage then
        // dropped the second row while the frame still went out.
        outgoingMessageId ??= this.nextLocalMessageId();
        const timestamp = this.currentServerEpochMs();
        const clientMsg: ClientMessage = {
          id: outgoingMessageId,
          isSender: true,
          senderId: this.getStorageUid(),
          plaintext: text,
          senderDeviceId: this.deviceId!,
          timestamp,
          status: 'SENDING',
        };

        await this.appendMessage(linkId, clientMsg, operation);
        outgoingRow = this.messages[linkId]?.find((message) => message.id === outgoingMessageId) ?? clientMsg;
      } else {
        // persistLocal:false is the no-local-row mode (probe/internal sends).
        // `localMessageId` there means "optional correlation id", NOT "retry this
        // row": the row may legitimately be absent or have been replaced by an
        // account switch. Refusing on a missing row here broke callers that use
        // both options together. A given row is still only retried when it
        // exists AND is in a failed state (see the duplicate guard below).
        outgoingRow = retryRow;
      }

      if (!wasAppendedNow && outgoingRow && outgoingRow.status !== 'FAILED_NETWORK' && outgoingRow.status !== 'FAILED_PROTOCOL') {
        // Already delivered (or still in flight). A duplicate can never help —
        // the peer has the frame — and re-sending it used to re-encrypt and
        // duplicate the message in the conversation.
        //
        // A SENDING row is NOT "delivered": it means an earlier attempt with the
        // same id never finished (account switch, aborted preparation). Refusing
        // there silently dropped the caller's retry, so only a terminal,
        // successful status short-circuits. The caller still cannot double-send
        // a delivered row via `retryMessage`, which only targets failed rows.
        if (outgoingRow.status === 'SENT') {
          console.warn('[Vault] Send skipped: this row was already delivered', {
            linkId,
            messageId: outgoingRow.id,
            status: outgoingRow.status,
          });
          return;
        }
      }

      const frames: SendFrame[] = [];

      // Frames are bound to the sending ratchet index the moment they are
      // encrypted, and that index is persisted right away (it must be: another
      // process may have consumed it). A delivery that FAILS must therefore not
      // be re-encrypted on retry — that consumes a fresh index and leaves a hole
      // the receiver can never fill. The built frames are kept per row and the
      // retry replays them unchanged.
      const reusable: BuiltFrames | undefined =
        outgoingRow && deliverableFrames.has(outgoingRow) ? deliverableFrames.get(outgoingRow) : undefined;
      if (
        reusable &&
        reusable.partnerUserId === partnerUserId &&
        reusable.frames.length === sanitizedDevices.length
      ) {
        frames.push(...reusable.frames);
      }

      try {
        for (const device of sanitizedDevices) {
          // A replayed retry already carries this device's frame: encrypting it
          // again would consume a fresh ratchet index and send the message twice.
          if (frames.some((frame) => frame.targetDeviceId === device.id)) continue;
          // Signal DR: one engine per (linkId, partnerDeviceId) — shared for both send and receive.
          // Using a unified key means Bob's CKs (set after DHR step on first receive) is
          // available when Bob later sends, which is the Signal DR requirement.
          const outEngineKey = `${linkId}_${device.id}`;
          const previous = this.decryptQueueByEngine.get(outEngineKey) || Promise.resolve();
          const current = previous
            .catch(() => {})
            .then(async () => {
              operation.assertCurrent();
              const engine = await operation.wait(() => this.getEngine(
                linkId,
                device.devicePub,
                outEngineKey,
                partnerUserId,
              ));
              console.log('[Vault] Sender engine created', {
                engineKey: outEngineKey,
                recipientDeviceId: device.id,
                recipientDevicePubHead: device.devicePub.slice(0, 16) + '...',
              });
              const { ciphertext, nonce, messageIndex, senderDHRPub, PN } =
                await operation.wait(() => engine.encryptFrame(text));

              frames.push({
                targetDeviceId: device.id,
                ciphertextHex: sodium.to_hex(ciphertext),
                nonceHex: sodium.to_hex(nonce),
                messageIndex,
                senderDHRPubHex: sodium.to_hex(senderDHRPub),
                pn: PN,
                clientMessageId: envelopeClientMessageId,
              });

              await this.persistEngineState(outEngineKey, operation);
            });

          this.decryptQueueByEngine.set(outEngineKey, current);
          try {
            await current;
          } finally {
            if (operation.isCurrent() && this.decryptQueueByEngine.get(outEngineKey) === current) {
              this.decryptQueueByEngine.delete(outEngineKey);
            }
          }
        }
      } catch (error) {
        if (error instanceof AccountOperationSuperseded) {
          // The account moved on: the caller has to see that, and `wait()` has
          // already re-stamped this attempt's budget entry at "now". Drop it, or
          // a superseded send keeps occupying a slot in the new account's window.
          this.settleSendBudget(budgetEntry, false);
          budgetSettled = true;
        }
        if (operation.isCurrent()) {
          const message = persistLocal
            ? this.messages[linkId]?.find((item) => item.id === outgoingMessageId)
            : retryRow;
          if (message && this.messages[linkId]?.includes(message)) {
            message.status = 'FAILED_PROTOCOL';
            try {
              await this.persistMessages(linkId, operation);
            } catch (persistError) {
              console.warn('[Vault] Failed to persist preparation failure status', persistError);
            }
          }
        }
        throw error;
      }

      {
        const maxRetries = 3;
        let lastErr: unknown;
        let sendSucceeded = false;

        try {
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            operation.assertCurrent();
            try {
              this.transport.sendEncryptedPayloadToUser(partnerUserId, frames, {
                deleteTargetMessageId,
              });
              sendSucceeded = true;
              break;
            } catch (err) {
              lastErr = err;
              const backoffMs = 100 * Math.pow(2, attempt);

              if (attempt < maxRetries - 1) {
                console.warn(
                  `[Vault] Send failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${backoffMs}ms`,
                  err,
                );
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
              } else {
                console.error(`[Vault] Send failed after ${maxRetries} attempts`, err);
              }
            }
          }
        } finally {
          // Every exit from the delivery loop settles the budget reservation:
          // charged once the frame is accepted, released when nothing reached
          // the socket. Releasing on the success path too is what makes the
          // charge happen exactly once (the reservation is what counted the
          // attempt in the window before the bytes were handed over).
          this.settleSendBudget(budgetEntry, sendSucceeded);
          budgetSettled = true;
        }

        if (!sendSucceeded) {
          const isNetworkError = (err: unknown): boolean => {
            if (err instanceof Error) {
              const msg = err.message.toLowerCase();
              return (
                msg.includes('timeout') ||
                msg.includes('econnrefused') ||
                msg.includes('enotfound') ||
                msg.includes('connect') ||
                msg.includes('network') ||
                msg.includes('offline')
              );
            }
            return false;
          };

          const failureStatus: MessageStatus = isNetworkError(lastErr)
            ? 'FAILED_NETWORK'
            : 'FAILED_PROTOCOL';

          // Nothing reached the socket, so the row is genuinely failed. Keep the
          // built frames on it: the ratchet for this engine already advanced
          // (encryptFrame + persistEngineState) and cannot be rewound without
          // discarding a possibly-delivered frame on another device. A retry
          // therefore REPLAYS these exact frames instead of encrypting new ones
          // and leaving an unfillable hole in the sender's message index.
          if (outgoingRow) {
            outgoingRow.status = failureStatus;
            deliverableFrames.set(outgoingRow, { partnerUserId, frames });
            if (persistLocal) {
              const uid = this.getStorageUid();
              if (uid && uid !== 'unknown') {
                await this.persistMessages(linkId);
              }
            }
          }
          throw lastErr instanceof Error ? lastErr : new Error('Message was not sent');
        }
      }

      if (outgoingRow) markRowDelivered(outgoingRow);

      // Mirrored for this account's other devices. Best-effort: the recipient
      // send already completed, so nothing here may surface as a send failure.
      void (async () => {
            operation.assertCurrent();
            // ── Cross-device fan-out (Option C) ──────────────────────────────────
            // Mirror the message we just sent to this account's OTHER devices so
            // their local history stays complete. Best-effort ONLY: the primary
            // recipient send above has already completed, so any failure here must
            // never surface — swallow everything.
            try {
              if (this.transport) {
                const authStore = (await import('stores/auth')).useAuthStore();
                const uid = authStore.user?.id;
                if (uid) {
                  const ownDevices = await this.getOwnVaultDevices();
                  const otherDevices = ownDevices.filter(
                    (d) => d.id && d.devicePub && d.id !== this.deviceId,
                  );

                  const selfFrames: Array<{
                    targetDeviceId: string;
                    linkId: string;
                    ciphertextHex: string;
                    nonceHex: string;
                    senderDHRPubHex: string;
                    pn: number;
                    messageIndex: number;
                    clientMessageId?: string;
                    selfSync: boolean;
                  }> = [];

                  for (const device of otherDevices) {
                    try {
                      const selfEngineKey = `self_${linkId}_${device.id}`;
                      const previous =
                        this.decryptQueueByEngine.get(selfEngineKey) || Promise.resolve();
                      const current = previous
                        .catch(() => {})
                        .then(async () => {
                          const engine = await this.getEngine(
                            linkId,
                            device.devicePub,
                            selfEngineKey,
                            uid,
                            { platform: device.platform ?? null },
                          );
                          const { ciphertext, nonce, messageIndex, senderDHRPub, PN } =
                            await engine.encryptFrame(text);
                          selfFrames.push({
                            targetDeviceId: device.id,
                            linkId,
                            ciphertextHex: sodium.to_hex(ciphertext),
                            nonceHex: sodium.to_hex(nonce),
                            senderDHRPubHex: sodium.to_hex(senderDHRPub),
                            pn: PN,
                            messageIndex,
                            clientMessageId: envelopeClientMessageId,
                            selfSync: true,
                          });
                          await this.persistEngineState(selfEngineKey, operation);
                        });

                      this.decryptQueueByEngine.set(selfEngineKey, current);
                      await current;
                      if (this.decryptQueueByEngine.get(selfEngineKey) === current) {
                        this.decryptQueueByEngine.delete(selfEngineKey);
                      }
                    } catch (deviceErr) {
                      console.warn('[Vault] Self-device fan-out skipped one device (non-fatal)', {
                        deviceId: device.id,
                        error: deviceErr instanceof Error ? deviceErr.message : String(deviceErr),
                      });
                    }
                  }

                  if (selfFrames.length > 0) {
                    this.transport.sendEncryptedPayloadToUser(uid, selfFrames);
                  }
                }
              }
            } catch (selfFanoutErr) {
              console.warn('[Vault] Self-device fan-out failed (non-fatal)', selfFanoutErr);
            }
      })();
      } finally {
        // Any exit that did not accept the frame (refused, thrown, account
        // switched mid-send) gives the budget slot back. Settle exactly once:
        // the delivery loop re-stamps the entry at hand-off on success, so a
        // second release here would drop the accepted send's slot.
        if (!budgetSettled) this.settleSendBudget(budgetEntry, false);
      }
    },

    async clearVaultState(outgoingUid: string | undefined = useAuthStore().user?.id) {
      const oldSession = this.sessionId;
      this.realtimeBuffer = [];
      this.pendingFetchInProgress = false;
      this.accountRetention = null;
      if (this.transport) {
        try {
          (this.transport as unknown as { disconnect: () => void }).disconnect();
        } catch {
          /* error ignored */
        }
        this.transport = null;
      }

      this.isInitialized = false;
      this.initializationPromise = null;
      this.deviceId = null;
      this.deviceToken = null;
      this.transportHost = null;
      this.sendBudgetEntries = [];
      this.rateLimitedUntil = null;
      this.connectionError = null;
      this.transportConnected = false;
      this.enrollmentErrorCode = null;
      this.enrollmentRetryAfter = null;
      this.enrollmentCooldownUntil = null;
      this.serverClockOffsetMs = 0;
      this.serverClockSyncedAt = null;
      this.engines = {};
      this.freshEngineBindings = {};
      this.messages = {};
      // Reset the load flags with the data: leaving them 'ready' after a teardown
      // made the chat view believe an EMPTY store meant an empty conversation, so it
      // painted "SECURE CHANNEL ACTIVE" over chats that had messages.
      this.messageLoadState = {};
      this.activeSettings = {};
      this.compromisedLinks = {};
      this.overrideSecurity = {};
      this.unreadLinks = {};
      this.unreadMessageCounts = {};
      this.linkLastActivity = {};
      this.quarantinedMessages = {};
      this.quarantinedDevices = {};
      this.trustedPartnerDevices = {};
      this.trustedPartnerIdentities = {};
      this.trustedDeviceIdentities = {};

      // SECURITY: Clear all UID caches during logout to prevent stale state lookup on next login
      // This ensures getStorageUid() won't accidentally find the old user's cached value
      sessionStorage.removeItem('user_cache');
      this.pendingPartnerDevices = {};
      this.pendingPartnerIdentities = {};
      this.tempSafetyUntil = {};
      this.lastPartnerDevices = {};
      this.deletedMessageIds = {};
      this.lastDecryptFailureAt = {};
      this.decryptQueueByEngine = new Map();
      this.decryptFailureCountByMessageId = {};
      this.engineFailureCounts = {};
      this.droppedCiphertextIds = new Set();
      this.activeLinkId = null;
      this.loadingLinks = new Set(); // SAFETY: Clear loading set
      this.processingMessageIds = new Set();
      this.processedMessageIds = {};
      this.attemptedMessageIds = new Set(); // Clear attempted messages on logout
      this.sessionId = ''; // SECURITY: Clear session ID on logout
      this.skRecoveryAttempted = new Set(); // SAFETY: Clear SK recovery attempts on logout
      this.nackRetryQueue = {}; // SAFETY: Clear NACK retry queue on logout
      this.reestablishingLinks.clear(); // SAFETY: Clear reestablishing links on logout

      void this.syncUnreadBadge();
      if (outgoingUid && outgoingUid !== 'unknown') await purgeAttachmentSession(outgoingUid, oldSession);
      await purgeExpiredAttachments();
    },

    getUnreadStorageKey(): string | null {
      const uid = this.getStorageUid();
      if (!uid || uid === 'unknown') return null;
      return `vault_unread_state_${uid}`;
    },

    hydrateUnreadState() {
      if (typeof localStorage === 'undefined') return;
      const key = this.getUnreadStorageKey();
      if (!key) return;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;

        const parsed = JSON.parse(raw) as {
          unreadLinks?: Record<string, boolean>;
          unreadMessageCounts?: Record<string, number>;
          linkLastActivity?: Record<string, number>;
        };

        if (parsed.unreadLinks) {
          this.unreadLinks = { ...parsed.unreadLinks };
        }
        if (parsed.unreadMessageCounts) {
          this.unreadMessageCounts = { ...parsed.unreadMessageCounts };
        }
        if (parsed.linkLastActivity) {
          this.linkLastActivity = { ...parsed.linkLastActivity };
        }
      } catch (err) {
        console.warn('[Vault] Failed to hydrate unread state:', err);
      }
    },

    async persistUnreadState() {
      if (typeof localStorage === 'undefined') return;
      const key = this.getUnreadStorageKey();
      if (!key) return;

      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            unreadLinks: this.unreadLinks,
            unreadMessageCounts: this.unreadMessageCounts,
            linkLastActivity: this.linkLastActivity,
          }),
        );
      } catch (err) {
        console.warn('[Vault] Failed to persist unread state:', err);
      }
    },

    /**
     * Record the newest message timestamp seen for a link so the chat list can
     * sort by real activity (the server never bumps Link.updatedAt on a message).
     * Persisted with the unread state so the order survives an app restart.
     */
    noteLinkActivity(linkId: string, timestamp?: number) {
      const ts = timestamp ?? Date.now();
      if ((this.linkLastActivity[linkId] || 0) >= ts) return;
      this.linkLastActivity = { ...this.linkLastActivity, [linkId]: ts };
      void this.persistUnreadState();
    },

    setAppFocused(focused: boolean) {
      this.appFocused = focused;
    },

    markMessageProcessed(messageId: string) {
      this.processedMessageIds[messageId] = Date.now();
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [id, ts] of Object.entries(this.processedMessageIds)) {
        if (ts < cutoff) {
          delete this.processedMessageIds[id];
        }
      }
      this.processedMessageIds = { ...this.processedMessageIds };
    },

    async handleMessageNack(nack: { messageId: string; senderDeviceId?: string }) {
      const messageId = typeof nack?.messageId === 'string' ? nack.messageId.trim() : '';
      if (!messageId) {
        console.warn('[Vault] Ignoring malformed MESSAGE_NACK without messageId');
        return;
      }

      console.log('[Vault] NACK received from receiver', { messageId });

      // Find the link and original plaintext this message belongs to by searching local messages.
      let linkId: string | null = null;
      let messageText = '';

      for (const [lid, msgs] of Object.entries(this.messages)) {
        const msg = msgs.find((m) => m.id === messageId);
        if (msg) {
          linkId = lid;
          messageText = msg.plaintext;
          break;
        }
      }

      if (!linkId || !messageText) {
        console.warn('[Vault] Received NACK for unknown or empty local message', { messageId });
        return;
      }

      // Prevent concurrent reestablishment on same link
      if (this.reestablishingLinks.has(linkId)) {
        console.log('[Vault] Link already reestablishing, skipping duplicate NACK', { linkId });
        return;
      }

      // Store message for retry with retry count limit
      const retryState = this.nackRetryQueue[messageId];
      const retryCount = (retryState?.retryCount ?? 0) + 1;

      if (retryCount > 5) {
        console.error(
          '[Vault] Message failed to deliver after 5 reestablishment attempts - giving up',
          {
            messageId,
          },
        );
        delete this.nackRetryQueue[messageId];
        return;
      }

      // Store retry info
      console.log('[Vault] Triggering reestablishment after NACK', {
        linkId,
        messageId,
        retryCount,
      });

      this.nackRetryQueue[messageId] = {
        messageText: retryState?.messageText || messageText,
        partnerUserId: retryState?.partnerUserId || '',
        retryCount,
      };

      await this.initiateReestablishment(linkId, nack.senderDeviceId ?? '');
    },

    async initiateReestablishment(linkId: string, senderDeviceId?: string) {
      // SIGNAL-LIKE RECOVERY: When sender receives NACK on first message, perform engine reset and retry
      try {
        // Build engine key for this link+device pair
        const linksStore = (await import('stores/links')).useLinksStore();

        // CRITICAL: Refresh links to get current device list before reestablishing
        // Prevents "missing frame" errors by ensuring we have all target devices
        try {
          await linksStore.fetchLinks();
        } catch (refreshErr) {
          console.warn('[Vault] Failed to refresh links during reestablishment', refreshErr);
        }

        const link = linksStore.links.find((l) => l.id === linkId);
        if (!link) {
          console.warn('[Vault] Reestablishment: link not found', { linkId });
          return;
        }

        // Find the senderDeviceId within the link if not provided
        let targetDeviceId = senderDeviceId;
        if (!targetDeviceId) {
          const allDevices = [...(link.sender.devices || []), ...(link.receiver.devices || [])];
          targetDeviceId = allDevices[0]?.id ?? '';
        }

        if (!targetDeviceId) {
          console.warn('[Vault] Reestablishment: no device found in link', { linkId });
          return;
        }

        const engineKey = `${linkId}_${targetDeviceId}`;

        // Prevent concurrent reestablishment on same link
        if (this.reestablishingLinks.has(linkId)) {
          console.log('[Vault] Reestablishment already in progress', { linkId });
          return;
        }

        this.reestablishingLinks.add(linkId);

        try {
          console.log('[Vault] Initiating reestablishment due to first-message NACK', {
            linkId,
            engineKey,
          });

          // Step 1: Delete the broken engine (fresh engine with wrong SK)
          delete this.engines[engineKey];
          console.log('[Vault] Deleted stale engine', { engineKey });

          // Step 2: Delete persisted ratchet state so next message creates fresh engine
          const uid = this.getStorageUid();
          const ratchetKey = `vault_ratchet_v4_${engineKey}_uid_${uid}`;
          try {
            await del(ratchetKey);
            // Also remove from index
            const idxKey = `vault_ratchet_index_${uid}`;
            const existing = (await get<string[]>(idxKey)) || [];
            const cleaned = existing.filter((k) => k !== ratchetKey);
            await set(idxKey, cleaned.length > 0 ? cleaned : []);
            console.log('[Vault] Deleted persisted ratchet state', { ratchetKey });
          } catch (err) {
            console.warn('[Vault] Failed to delete ratchet state (best effort)', err);
          }

          // Step 3: Small backoff to let receiver settle and recreate its engine too
          const backoffMs = 500 + Math.random() * 500;
          console.log('[Vault] Waiting backoff before retry', { backoffMs });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));

          // Step 4: Retry queued messages from this link.
          const authStore = (await import('stores/auth')).useAuthStore();
          const myUserId = authStore.user?.id;
          const partnerUserId = myUserId === link.senderId ? link.receiverId : link.senderId;
          const toRetry: Array<{ messageId: string; text: string; userId: string }> = [];

          for (const [msgId, data] of Object.entries(this.nackRetryQueue)) {
            const belongsToLink = (this.messages[linkId] || []).some((m) => m.id === msgId);
            if (belongsToLink && data.messageText) {
              toRetry.push({
                messageId: msgId,
                text: data.messageText,
                userId: data.partnerUserId || partnerUserId,
              });
            }
          }

          console.log('[Vault] Queued messages for reestablishment retry', {
            count: toRetry.length,
            linkId,
          });

          // Attempt retry for each message
          for (const msg of toRetry) {
            try {
              console.log('[Vault] Reestablishment retry: resending message', {
                messageId: msg.messageId,
              });

              // Get devices for message recipient
              const targetDevices =
                msg.userId === link.senderId
                  ? link.sender.devices || []
                  : link.receiver.devices || [];

              // Re-send with new engine (will auto-create fresh)
              await this.sendMessage(linkId, msg.userId, targetDevices, msg.text, {
                localMessageId: msg.messageId,
              });

              delete this.nackRetryQueue[msg.messageId];
              console.log('[Vault] Reestablishment retry successful', {
                messageId: msg.messageId,
              });
            } catch (retryErr) {
              console.warn('[Vault] Reestablishment retry failed', {
                messageId: msg.messageId,
                error: retryErr instanceof Error ? retryErr.message : String(retryErr),
              });
            }
          }
        } finally {
          this.reestablishingLinks.delete(linkId);
          console.log('[Vault] Reestablishment complete', { linkId });
        }
      } catch (err) {
        console.error('[Vault] Reestablishment fatal error', err);
        this.reestablishingLinks.delete(linkId);
      }
    },

    async handleIncomingMessage(packet: InternalMessagePacket) {
      console.log('[Vault] Received incoming message packet', {
        messageId: packet.id,
        senderDeviceId: packet.senderDeviceId,
        ciphertextLength: packet.ciphertextHex?.length,
        hasNonce: !!packet.nonceHex,
        vaultReady: this.isInitialized,
      });

      // SECURITY: Refuse to process messages during vault reinitialization (account switch)
      // Messages arriving before vault.isInitialized could use stale engines or wrong UIDs
      if (!this.isInitialized) {
        console.warn(
          '[Vault] Message arrived before vault initialized (likely account switch), buffering',
          {
            messageId: packet.id,
          },
        );
        // Buffer the message for retry after initialization
        bufferRealtimeFrame(this.realtimeBuffer, packet);
        return;
      }

      // SECURITY: Verify user is still authenticated (catch edge case of cleared auth during async processing)
      const authStore = (await import('stores/auth')).useAuthStore();
      if (!authStore.user?.id) {
        console.error(
          '[Vault] Cannot process message - user not authenticated (possible race condition)',
          {
            messageId: packet.id,
          },
        );
        return;
      }

      // SECURITY: Validate packet structure before processing
      if (!packet.id || !packet.senderDeviceId || !packet.ciphertextHex || !packet.nonceHex) {
        console.error('[Vault] Invalid packet structure - missing required fields', { packet });
        return;
      }

      if (this.droppedCiphertextIds.has(packet.id)) {
        return;
      }

      const processedAt = this.processedMessageIds[packet.id] || 0;
      if (processedAt > 0 && Date.now() - processedAt < 5 * 60 * 1000) {
        return;
      }

      // Buffer realtime WebSocket messages while pending fetch is in progress
      // to prevent ratchet desync from concurrent processing of the same messages.
      if (this.pendingFetchInProgress) {
        bufferRealtimeFrame(this.realtimeBuffer, packet);
        return;
      }

      // DEDUP: Prevent concurrent decryption of the same message ID
      if (this.processingMessageIds.has(packet.id)) {
        // Silently skip in-flight duplicates to avoid ratchet state races.
        return;
      }
      this.processingMessageIds.add(packet.id);

      // SECURITY: Prevent re-attempting messages that were already tried and failed
      // This prevents ratchet advancement on retry without recovery
      if (this.attemptedMessageIds.has(packet.id)) {
        this.processingMessageIds.delete(packet.id);
        return;
      }
      this.attemptedMessageIds.add(packet.id);

      // SECURITY: Mark as processed immediately (even before decrypt attempt)
      // This prevents reprocessing of failed decryptions after buffering/pending refetch.
      // Failed decryptions will not retry within 5-minute window.
      // Both markers are provisional: any exit below that has not ACKed (or
      // deliberately NACKed / re-buffered) rolls them back, otherwise the relay's
      // redelivery would be suppressed for the rest of the session and a message
      // that decrypted fine could still be lost.
      this.markMessageProcessed(packet.id);
      let deliverySettled = false;

      // SECURITY: Validate messageIndex if present (prevent overflow/negative values)
      if (packet.messageIndex !== undefined) {
        if (!Number.isFinite(packet.messageIndex) || packet.messageIndex < 0) {
          console.error('[Vault] Invalid messageIndex - must be non-negative safe integer', {
            messageIndex: packet.messageIndex,
          });
          this.processingMessageIds.delete(packet.id);
          this.attemptedMessageIds.delete(packet.id);
          delete this.processedMessageIds[packet.id];
          return;
        }
      }

      try {
        const linksStore = (await import('stores/links')).useLinksStore();
        if (linksStore.links.length === 0) {
          console.log('[Vault] Loading links because none in store');
          await linksStore.fetchLinks();
        }
        console.log('[Vault] Available links:', linksStore.links.length);

        let matched = packet.linkId
          ? linksStore.links.find((l) => l.id === packet.linkId)
          : undefined;

        // A self-sync copy (`outgoing`) comes FROM one of our own devices, so it
        // is never listed in the link's partner device lists — and not always in
        // the lists at all. Matching it by device identity is what produced
        // "NO MATCHING LINK" and silently dropped own-device frames (no ACK, no
        // NACK, no redelivery). Its link is the one the relay row names.
        // Typed from the store's own link shape, so a narrowing mistake in the
        // caller is a type error here instead of a runtime "cannot read devices".
        const deviceMatchesLink = (l: Link) =>
          [...(l.sender.devices || []), ...(l.receiver.devices || [])].some(
            (d) => d.id === packet.senderDeviceId,
          );
        const acceptMatch = <T extends Link>(l: T | undefined): T | undefined =>
          l && (packet.outgoing === true || deviceMatchesLink(l)) ? l : undefined;

        matched = acceptMatch(matched);

        if (!matched) {
          matched = linksStore.links.find(
            (l) =>
              (l.sender.devices || []).some((d) => d.id === packet.senderDeviceId) ||
              (l.receiver.devices || []).some((d) => d.id === packet.senderDeviceId),
          );
        }

        // Stale-link recovery: force refresh once before dropping the packet.
        if (!matched) {
          await linksStore.fetchLinks();
          matched = acceptMatch(packet.linkId
            ? linksStore.links.find((l) => l.id === packet.linkId)
            : undefined);

          if (!matched) {
            matched = linksStore.links.find(
              (l) =>
                (l.sender.devices || []).some((d) => d.id === packet.senderDeviceId) ||
                (l.receiver.devices || []).some((d) => d.id === packet.senderDeviceId),
            );
          }
        }

        if (!matched) {
          console.warn('[Vault] NO MATCHING LINK found for incoming message', {
            senderDeviceId: packet.senderDeviceId,
            linksCount: linksStore.links.length,
          });
          return;
        }

        console.log('[Vault] FOUND matching link:', {
          linkId: matched.id,
          linkStatus: matched.status,
        });

        // SECURITY: Reject all messages for SEVERED links
        // If we've purged a conversation, we do not want to process any further messages
        // from that link. A SEVERED link means we've deleted the ratchet state locally.
        if (matched.status === 'SEVERED') {
          console.warn(
            '[Vault] Rejecting message for SEVERED link - link has been purged locally',
            {
              linkId: matched.id,
              messageId: packet.id,
            },
          );
          try {
            this.transport?.nackMessage(packet.id);
          } catch (nackErr) {
            console.warn('[Vault] Failed to NACK message for severed link', nackErr);
          }
          deliverySettled = true;
          return;
        }

        const linkId = matched.id;

        // SECURITY: Refresh link data before extracting sender device public key
        // Ensures we have current device list when creating decryption engine
        // Prevents SK mismatch if sender added new device or device pub changed
        let cachedSenderDevice: { id: string; devicePub: string } | undefined;
        try {
          // Capture cached version first for comparison
          cachedSenderDevice = [
            ...(matched.sender.devices || []),
            ...(matched.receiver.devices || []),
          ].find((d) => d.id === packet.senderDeviceId);

          await linksStore.fetchLinks();
          // Re-fetch the matched link after refresh to get current device info
          matched = linksStore.links.find((l) => l.id === linkId);
          if (!matched) {
            console.warn('[Vault] Link disappeared after refresh', { linkId });
            return;
          }

          // Log if device pub changed
          const refreshedSenderDevice = [
            ...(matched.sender.devices || []),
            ...(matched.receiver.devices || []),
          ].find((d) => d.id === packet.senderDeviceId);

          if (cachedSenderDevice?.devicePub !== refreshedSenderDevice?.devicePub) {
            console.warn('[Vault] Device pub mismatch detected at receive point', {
              cached: cachedSenderDevice?.devicePub?.slice(0, 16) + '...',
              refreshed: refreshedSenderDevice?.devicePub?.slice(0, 16) + '...',
              senderDeviceId: packet.senderDeviceId,
            });
          }
        } catch (refreshErr) {
          console.warn('[Vault] Failed to refresh links before decrypt', refreshErr);
          // Continue with stale link data (graceful degradation)
        }

        // At this point matched is guaranteed to be non-null (either from before or from refresh)
        let senderDevice:
          | { id: string; devicePub: string; identityPub?: string | null }
          | undefined = [
          ...(matched!.sender.devices || []),
          ...(matched!.receiver.devices || []),
        ].find((d) => d.id === packet.senderDeviceId);

        if (!senderDevice?.devicePub && packet.outgoing !== true) {
          console.warn('[Vault] Sender device not found in link', {
            senderDeviceId: packet.senderDeviceId,
            linkId,
          });
          return;
        }

        const authStore = (await import('stores/auth')).useAuthStore();
        const myId = authStore.user?.id;

        if (!senderDevice?.devicePub && packet.outgoing === true) {
          // The sending device is another device of THIS account. When the link
          // has not listed it yet, its public key comes from the server's own
          // device list rather than from a partner entry that can never hold it.
          const ownDevice = await this
            .getOwnVaultDevices()
            .then((devices) => devices.find((d) => d.id === packet.senderDeviceId))
            .catch(() => undefined);
          if (!ownDevice?.devicePub) {
            console.warn('[Vault] Self-sync sender device not found in own devices', {
              senderDeviceId: packet.senderDeviceId,
              linkId,
            });
            return;
          }
          senderDevice = { id: ownDevice.id, devicePub: ownDevice.devicePub };
          await this.setTrustedPartnerDevice(linkId, ownDevice.id);
        }

        // Both paths above either returned or assigned a device with a pubkey,
        // so this narrowing is the real invariant, not an assertion shortcut.
        if (!senderDevice?.devicePub) return;
        const sender = senderDevice;
        const senderIsInitiator = (matched!.sender.devices || []).some(
          (d) => d.id === sender.id,
        );
        const senderUserId = senderIsInitiator ? matched!.senderId : matched!.receiverId;
        // A self-sync copy is by definition written by this account, whatever the
        // device lists say (the other own device may not be listed yet).
        const isFromPartner = packet.outgoing === true ? false : senderUserId !== myId;

        const senderIdentity = sender.identityPub || null;
        const tempWindowActive = (this.tempSafetyUntil[linkId] ?? 0) > Date.now();
        const trustedIdentity = await this.getTrustedPartnerIdentity(linkId);

        if (isFromPartner) {
          this.lastPartnerDevices[linkId] = sender.id;
          const normalizedIdentity = senderIdentity ? senderIdentity.trim().toLowerCase() : null;
          // Compare against the pin for THIS device, not one key per link: the
          // same person messages from phone and desktop, and every device has
          // its own identity key, so a link-level pin flagged every device
          // switch as a compromise.
          const pinnedForDevice = normalizedIdentity
            ? await this.getTrustedDeviceIdentity(linkId, sender.id)
            : null;

          if (!normalizedIdentity) {
            // If partner doesn't provide identity, fallback to legacy device trust
            await this.setTrustedPartnerDevice(linkId, sender.id);
            this.compromisedLinks[linkId] = false;
          } else if (!pinnedForDevice) {
            // Device we have not seen before on this link: pin it (TOFU) instead
            // of calling it a compromise. The link record it came from is
            // server-verified, so this is the partner's own device.
            await this.setTrustedDeviceIdentity(linkId, sender.id, normalizedIdentity);
            if (!trustedIdentity) {
              await this.setTrustedPartnerIdentity(linkId, normalizedIdentity);
            }
            this.compromisedLinks[linkId] = false;
          } else if (pinnedForDevice !== normalizedIdentity) {
            // The SAME device now presents a DIFFERENT identity key. Quarantine
            // that device — never the whole link for the session: a genuine
            // partner reinstall must stay recoverable (re-pin releases it), and
            // the other devices on the link keep working meanwhile.
            this.quarantinedDevices[linkId] = { ...(this.quarantinedDevices[linkId] || {}), [sender.id]: true };
            this.quarantinedDevices = { ...this.quarantinedDevices };
            this.compromisedLinks[linkId] = true;
            this.pendingPartnerIdentities[linkId] = normalizedIdentity;
            this.pendingPartnerDevices[linkId] = sender.id;
            this.pendingPartnerIdentities = { ...this.pendingPartnerIdentities };
            this.pendingPartnerDevices = { ...this.pendingPartnerDevices };

            if (!tempWindowActive) {
              // Do not treat quarantined packets as processed. They remain
              // server-pending until the user trusts/rejects, so manual sync or
              // a restart can recover them instead of losing the message.
              delete this.processedMessageIds[packet.id];
            }
            // Quarantine the frame even inside the temporary-safety window:
            // decrypting it there would consume the ratchet on an identity the
            // user has not approved, which is precisely what the window does NOT
            // grant. Nothing is chained behind it (see the queue below), so the
            // link keeps working while the frame waits for the decision.
            this.attemptedMessageIds.delete(packet.id);
            this.queueQuarantinedMessage(
              linkId,
              packet,
              sender.devicePub,
              sender.identityPub,
            );
            if (!tempWindowActive) {
              this.markLinkUnread(linkId);
              this.notifyCompromised(linkId);
            }
            deliverySettled = true;
            return;
          } else {
            this.compromisedLinks[linkId] = false;
            this.pendingPartnerIdentities[linkId] = null;
            this.pendingPartnerDevices[linkId] = null;
          }
        }

        // Serialize on the SAME engine key the decrypt path uses: a self-sync
        // frame shares `self_<linkId>_<relayDeviceId>` with the outbound
        // fan-out engine, so both directions must share one queue.
        const engineKey =
          packet.outgoing === true
            ? `self_${linkId}_${packet.senderDeviceId}`
            : `${linkId}_${packet.senderDeviceId}`;

        // A quarantined packet is NOT decrypted, so it never consumes a ratchet
        // key. The mismatch branch above already returned, so the remaining way
        // to get here with one is the temporary-safety window. Never chain an
        // in-file sequence behind it: queuing frame N+2 behind a frame that
        // cannot decrypt left the link silent with a single decrypt error for
        // every following message.
        const alreadyQuarantined =
          this.quarantinedMessages[linkId]?.some((entry) => entry.packet.id === packet.id) ?? false;
        if (alreadyQuarantined) {
          deliverySettled = true;
          return;
        }
        const previous = this.decryptQueueByEngine.get(engineKey) || Promise.resolve();
        const current = previous
          .catch(() => {})
          .then(async () => {
            // Hand this device's OWN sender identity to the partner branch, so a
            // TOFU mismatch quarantines under the right identity instead of null.
            await this.decryptIncomingPacket(linkId, packet, sender.devicePub, {
              markUnsafe: this.compromisedLinks[linkId] === true,
              senderUserId,
            });
          });

        this.decryptQueueByEngine.set(engineKey, current);
        await current;
        if (this.decryptQueueByEngine.get(engineKey) === current) {
          this.decryptQueueByEngine.delete(engineKey);
        }
        deliverySettled = true;
      } finally {
        if (!deliverySettled) {
          // Any other exit (link refresh threw, sender device unknown, an
          // exception from the decrypt queue) left the packet neither ACKed nor
          // NACKed. Clear the markers so the relay's redelivery is processed
          // instead of being swallowed as "already attempted" for this session.
          this.attemptedMessageIds.delete(packet.id);
          delete this.processedMessageIds[packet.id];
        }
        this.processingMessageIds.delete(packet.id);
      }
    },

    mergeMessageLists(current: ClientMessage[], incoming: ClientMessage[]): ClientMessage[] {
      const byId = new Map<string, ClientMessage>();

      for (const msg of current || []) {
        byId.set(msg.id, msg);
      }

      for (const msg of incoming || []) {
        const existing = byId.get(msg.id);
        if (existing) {
          byId.set(msg.id, {
            ...existing,
            ...msg,
            reactions: msg.reactions ?? existing.reactions,
          });
        } else {
          byId.set(msg.id, msg);
        }
      }

      return Array.from(byId.values()).sort(this.compareMessagesByEpoch);
    },

    // Resolve the owning user id for a sender device WITHOUT any network I/O.
    // Uses the in-memory link list (already fetched by the caller) so this is a
    // cheap, synchronous-in-effect lookup — not a per-message refetch. Returns
    // null when the link or device is unknown.
    async resolveSenderUserId(linkId: string, senderDeviceId: string): Promise<string | null> {
      const linksStore = (await import('stores/links')).useLinksStore();
      const link = linksStore.links.find((l) => l.id === linkId);
      if (!link) return null;

      if ((link.sender.devices || []).some((d) => d.id === senderDeviceId)) {
        return link.senderId;
      }
      if ((link.receiver.devices || []).some((d) => d.id === senderDeviceId)) {
        return link.receiverId;
      }
      return null;
    },

    // One-time backfill for messages persisted before the senderId field existed.
    // Resolves ownership from the account-agnostic senderDeviceId (already stored
    // on the message) against the in-memory link — no network refetch, and only
    // runs on load, not per render.
    async backfillLegacySenderIds(linkId: string): Promise<void> {
      const operation = captureAccountOperation();
      const arr = this.messages[linkId];
      if (!arr || arr.length === 0) return;

      let changed = false;
      for (const m of arr) {
        if (m.senderId != null || !m.senderDeviceId) continue;
        const resolved = await operation.wait(() => this.resolveSenderUserId(linkId, m.senderDeviceId));
        if (resolved) {
          m.senderId = resolved;
          changed = true;
        }
      }

      if (!changed) return;

      operation.assertCurrent();
      this.messages[linkId] = [...arr];
      await this.persistMessages(linkId, operation);
    },

    /**
     * Fetch (and cache for ~5 min) the list of THIS account's own devices from
     * the server. Used to discover fan-out targets and their platform (which
     * the self-session role election needs). Returns [] on failure rather than
     * throwing — every caller treats multi-device sync as best-effort.
     */
    async getOwnVaultDevices(force = false): Promise<OwnVaultDevice[]> {
      const uid = this.getStorageUid();
      if (!uid || uid === 'unknown') return [];

      const cached = ownVaultDevicesCache.get(uid);
      if (!force && cached && Date.now() - cached.at < OWN_VAULT_DEVICES_TTL_MS) {
        return cached.devices;
      }

      try {
        const { data } = await api.get<{ success: boolean; data: OwnVaultDevice[] }>(
          '/api/v1/vault/devices',
        );
        const devices = Array.isArray(data?.data)
          ? data.data.filter((d): d is OwnVaultDevice => Boolean(d && d.id && d.devicePub))
          : [];
        ownVaultDevicesCache.set(uid, { at: Date.now(), devices });
        return devices;
      } catch (err) {
        console.warn('[Vault] Failed to fetch own vault devices', err);
        return cached?.devices ?? [];
      }
    },

    /**
     * Mobile-only: ask the linked desktop to replay its locally-persisted
     * history to this device over the self-session channel. Automatic requests
     * are cooldown-limited; manual sync can force a retry. Best-effort.
     */
    async requestHistoryFromDesktop(force = false): Promise<void> {
      const operation = captureAccountOperation();
      try {
        const uid = operation.uid;
        if (!uid || uid === 'unknown') return;
        const lastRequest = historyRequestedAt.get(uid) || 0;
        if (!force && Date.now() - lastRequest < HISTORY_REQUEST_COOLDOWN_MS) return;
        const transport = this.transport;
        if (!transport?.isOpen()) return;
        const devicePriv = await operation.wait(() => this.keyManager.getStoredKey(`vault_device_priv_${uid}`));
        if (this.transport !== transport) return;
        if (!devicePriv) return;

        const pubHex = this.devicePubKeyHex || sodium.to_hex(sodium.crypto_scalarmult_base(devicePriv));
        const platformStr = serverPlatformFromMobile(mobilePlatform());
        transport.requestVaultHistory(pubHex, platformStr);
        historyRequestedAt.set(uid, Date.now());
      } catch (err) {
        console.warn('[Vault] requestHistoryFromDesktop failed (non-fatal)', err);
      }
    },

    /**
     * Desktop-side responder to a VAULT_HISTORY_REQUEST. Re-encrypts each
     * link's locally-persisted plaintext back to the requesting own-device
     * using a self-session engine, wrapped in a history envelope so the
     * receiver keeps the ORIGINAL timestamp / side. Chunked to stay under the
     * server's 10-messages-per-3s limiter. Never throws.
     */
    async handleVaultHistoryRequest(payload: unknown): Promise<void> {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      try {
        // Only a DESKTOP device answers: it is the self-session initiator and
        // holds the authoritative local log. A mobile requester must never be
        // asked to serve history.
        if (isMobileAuthRuntime()) return;

        const data = (payload || {}) as {
          requesterDevicePub?: string;
          requesterDeviceId?: string;
          requesterPlatform?: string | null;
        };
        const requesterDevicePub =
          typeof data.requesterDevicePub === 'string'
            ? data.requesterDevicePub.trim().toLowerCase()
            : '';
        const requesterDeviceId =
          typeof data.requesterDeviceId === 'string' ? data.requesterDeviceId.trim() : '';
        const requesterPlatform = data.requesterPlatform ?? null;
        const ownDevices = await operation.wait(() => this.getOwnVaultDevices());
        if (!ownDevices.some((device) => device.id === requesterDeviceId && device.devicePub?.toLowerCase() === requesterDevicePub)) return;

        if (!/^[0-9a-f]{64}$/i.test(requesterDevicePub)) {
          console.warn('[Vault] Ignoring history request with invalid requesterDevicePub');
          return;
        }
        if (!requesterDeviceId || requesterDeviceId === this.deviceId || !this.transport) return;

        operation.assertCurrent();
        const uid = operation.uid;
        const linksStore = (await operation.wait(() => import('stores/links'))).useLinksStore();
        if (linksStore.links.length === 0) {
          try {
            await linksStore.fetchLinks();
          } catch (fetchErr) {
            console.warn('[Vault] History responder could not refresh links', fetchErr);
          }
        }

        // ≈25 frames/packet, 250 ms apart → well under 10 messages / 3 s.
        const CHUNK_SIZE = 25;
        const INTER_PACKET_DELAY_MS = 250;

        for (const link of linksStore.links) {
          const linkId = link.id;
          try {
            operation.assertCurrent();
            const settings = await operation.wait(() => this.loadChatSettings(linkId));
            if (settings?.mode === 'ephemeral_session') continue;
            await operation.wait(() => this.loadMessages(linkId));
            const stored = await operation.wait(() => this.exportRetainedMessages(linkId));
            const entries = stored.filter(
              (m) => m && typeof m.plaintext === 'string' && m.plaintext.length > 0,
            );
            if (entries.length === 0) continue;

            const selfEngineKey = `self_${linkId}_${requesterDeviceId}`;
            const previous = this.decryptQueueByEngine.get(selfEngineKey) || Promise.resolve();
            const current = previous
              .catch(() => {})
              .then(async () => {
                operation.assertCurrent();
                const engine = await operation.wait(() => this.getEngine(
                  linkId,
                  requesterDevicePub,
                  selfEngineKey,
                  uid,
                  { platform: requesterPlatform },
                ));

                let chunk: Array<{
                  targetDeviceId: string;
                  linkId: string;
                  ciphertextHex: string;
                  nonceHex: string;
                  senderDHRPubHex: string;
                  pn: number;
                  messageIndex: number;
                  selfSync: boolean;
                }> = [];

                const flush = async () => {
                  operation.assertCurrent();
                  if (chunk.length === 0) return;
                  this.transport!.sendEncryptedPayloadToUser(uid, chunk);
                  chunk = [];
                  await this.persistEngineState(selfEngineKey, operation);
                  await new Promise((resolve) => setTimeout(resolve, INTER_PACKET_DELAY_MS));
                };

                for (const msg of entries) {
                  const envelope = buildHistoryEnvelope({
                    ts: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
                    fromSelf: msg.isSender === true,
                    body: msg.plaintext,
                  });
                  const { ciphertext, nonce, messageIndex, senderDHRPub, PN } =
                    await operation.wait(() => engine.encryptFrame(envelope));
                  chunk.push({
                    targetDeviceId: requesterDeviceId,
                    linkId,
                    ciphertextHex: sodium.to_hex(ciphertext),
                    nonceHex: sodium.to_hex(nonce),
                    senderDHRPubHex: sodium.to_hex(senderDHRPub),
                    pn: PN,
                    messageIndex,
                    selfSync: true,
                  });
                  if (chunk.length >= CHUNK_SIZE) await flush();
                }
                await flush();
              });

            this.decryptQueueByEngine.set(selfEngineKey, current);
            await current;
            if (this.decryptQueueByEngine.get(selfEngineKey) === current) {
              this.decryptQueueByEngine.delete(selfEngineKey);
            }
          } catch (linkErr) {
            console.warn('[Vault] History backfill failed for one link (non-fatal)', {
              linkId,
              error: linkErr instanceof Error ? linkErr.message : String(linkErr),
            });
          }
        }
      } catch (err) {
        console.warn('[Vault] History request responder failed (non-fatal)', err);
      }
    },

    /**
     * Ingest a decrypted self/history payload WITHOUT touching unread state or
     * notifications. Returns true when `plaintext` was a history envelope or a
     * self-sync copy (both are silent, dedup-friendly stores); false means it
     * is an ordinary inbound message and the caller should continue its normal
     * (unread + sound) path.
     */
    async ingestSilentSelfMessage(
      linkId: string,
      packet: InternalMessagePacket,
      plaintext: string,
    ): Promise<boolean> {
      const operation = captureAccountOperation();
      if (!operation.uid) return true;
      try {
        // (1) History backfill: carries the ORIGINAL timestamp + side. Store
        // under a content-derived id so a repeated backfill is idempotent.
        //
        // ONLY on the self-sync channel. The owner's other device re-encrypts
        // stored history with a self-session engine and relays it with
        // `outgoing: true`. A PARTNER can send arbitrary plaintext, so a partner
        // frame whose body merely LOOKS like `{v:1,type:'history',ts,fromSelf,
        // body}` must never be written into the owner's own history at an
        // attacker-chosen timestamp with no unread signal.
        const hist = packet.outgoing === true ? parseHistoryEnvelope(plaintext) : null;
        if (hist) {
          const uid = this.getStorageUid();
          let partnerId: string | undefined;
          try {
            const link = (await operation.wait(() => import('stores/links')))
              .useLinksStore()
              .links.find((l) => l.id === linkId);
            if (link) partnerId = link.senderId === uid ? link.receiverId : link.senderId;
          } catch {
            operation.assertCurrent();
            // best effort — senderId is a rendering hint, not required
          }
          operation.assertCurrent();
          // A history entry is keyed by (timestamp, side, body) because the relay
          // does not carry the original message id. That id differs from the
          // `msg_<uuid>` a locally-sent or live-received copy already has, so a
          // naive append stored the SAME message twice — the "message sent twice"
          // report. Skip when an equivalent row is already present: same side,
          // same body, timestamp within a couple of seconds.
          const histId = historyEntryId(hist.ts, hist.fromSelf, hist.body);
          const alreadyStored = (this.messages[linkId] ?? []).some(
            (existing) =>
              existing.id === histId ||
              (existing.isSender === hist.fromSelf &&
                Math.abs((existing.timestamp ?? 0) - hist.ts) <= 2000 &&
                messageBodyOf(existing.plaintext) === hist.body),
          );
          if (!alreadyStored) {
            await this.appendMessage(linkId, {
              id: histId,
              isSender: hist.fromSelf,
              senderId: hist.fromSelf ? uid : partnerId,
              plaintext: hist.body,
              senderDeviceId: packet.senderDeviceId,
              timestamp: hist.ts,
              status: hist.fromSelf ? 'SENT' : undefined,
            }, operation);
          }
          return true;
        }

        // (2) Self-sync copy of a message THIS account sent from another own
        // device. Store as outgoing; never raise unread or play a sound.
        if (packet.outgoing === true) {
          if (!this.handleControlMessage(linkId, plaintext, operation.uid)) {
            const selfId = this.extractClientMessageId(plaintext) || packet.id;
            // A self-sync copy is stamped with the relay's createdAt, exactly like
            // any other delivery (the old code read it the same way through
            // parseMessageEpochMs; this keeps that behaviour explicit).
            const selfTs = this.parseMessageEpochMs(packet.createdAt);
            // Dedupe by IDENTITY ONLY. The previous rule also collapsed any two
            // sent rows with the same visible text within ±2 s — which is every
            // "ok", "lol" or "??" sent twice in quick succession from another
            // device: the second copy was silently dropped from history forever.
            // A self-sync copy carries a stable id (the envelope's
            // clientMessageId when present, otherwise the relay row id), and the
            // relay does not reuse ids, so id equality is the exact test.
            const duplicate = (this.messages[linkId] ?? []).some((m) => m.id === selfId);
            if (!duplicate) {
              await this.appendMessage(linkId, {
                id: selfId,
                isSender: true,
                senderId: this.getStorageUid(),
                plaintext,
                senderDeviceId: packet.senderDeviceId,
                timestamp: selfTs,
                status: 'SENT',
              }, operation);
            }
          }
          return true;
        }
      } catch (err) {
        operation.assertCurrent();
        console.warn('[Vault] Failed to ingest self/history message (non-fatal)', err);
        // Treat as handled so a malformed self payload cannot fall through into
        // the normal unread/sound path.
        return packet.outgoing === true;
      }
      return false;
    },

    async decryptIncomingPacket(
      linkId: string,
      packet: InternalMessagePacket,
      senderDevicePub: string,
      options?: { markUnsafe?: boolean; senderUserId?: string },
    ) {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      const deviceId = this.deviceId;
      const transport = this.transport;
      const isCurrent = () => operation.isCurrent() && this.deviceId === deviceId && this.transport === transport;
      const isSelfSync = packet.outgoing === true;
      const inboundEngineKey = isSelfSync
        ? `self_${linkId}_${packet.senderDeviceId}`
        : `${linkId}_${packet.senderDeviceId}`;
      const receiptHash = packetReceiptHash(linkId, packet, senderDevicePub);
      const deferReceipt = () => {
        if (!operation.isCurrent()) return;
        this.attemptedMessageIds.delete(packet.id);
        delete this.processedMessageIds[packet.id];
        if (!this.realtimeBuffer.some((item) => item.id === packet.id)) this.realtimeBuffer.push(packet);
      };
      // Only AEAD-authenticated checkpoint evidence permits ACK without decrypt.
      // This also works when history is temporarily unreadable after a restart.
      try {
        if (!deviceId) throw new Error('Receipt checkpoint requires a device');
        const checkpoint = await operation.wait(() => getEncryptedRatchetState({
          accountId: operation.uid!, deviceId, sessionId: inboundEngineKey,
        }));
        if (!isCurrent()) return;
        if (checkpoint?.receivedPacketHashes?.includes(receiptHash)) {
          transport?.ackMessage(packet.id);
          this.markMessageProcessed(packet.id);
          return;
        }
      } catch (error) {
        deferReceipt();
        console.warn('[Vault] Receipt checkpoint unavailable; relay retry retained', error);
        return;
      }
      // Do not consume a relay key while the original history cannot be merged.
      // Keep ciphertext (not memory-only plaintext) retryable across process loss.
      try {
        if (this.messageLoadState[linkId] !== 'ready') await operation.wait(() => this.loadMessages(linkId));
        operation.assertCurrent();
        if (this.messageLoadState[linkId] !== 'ready') throw new Error('Local history is not ready');
      } catch (error) {
        deferReceipt();
        console.warn('[Vault] Receipt deferred until local history is readable', error);
        return;
      }
      // Signal DR: same engine instance as the outbound — unified per (linkId, partnerDeviceId).
      // For a self-sync frame (`outgoing`), the "partner" device belongs to this
      // same account, so it lives on a dedicated `self_` engine keyed by the
      // relay device — never the partner engine used for the peer.
      // Platform hint for the self-session role election (desktop-vs-mobile).
      let selfSessionPeer: { platform?: string | null } | undefined;
      if (isSelfSync) {
        try {
          const ownDevices = await this.getOwnVaultDevices();
          selfSessionPeer = {
            platform:
              ownDevices.find(
                (d) => d.devicePub?.toLowerCase() === senderDevicePub.toLowerCase(),
              )?.platform ?? null,
          };
        } catch {
          selfSessionPeer = {};
        }
      }

      let engine = this.engines[inboundEngineKey];
      if (!engine) {
        console.log('[Vault] Engine not cached, creating new one', {
          linkId,
          senderDeviceId: packet.senderDeviceId,
          senderDevicePubHead: senderDevicePub.slice(0, 16) + '...',
          packetMessageIndex: packet.messageIndex,
          packetSenderDHRPubHead: packet.senderDHRPubHex?.slice(0, 16) + '...',
        });
        engine = await this.getEngine(
          linkId,
          senderDevicePub,
          inboundEngineKey,
          options?.senderUserId,
          selfSessionPeer,
        );
        const preState = engine.exportRatchetState();
        console.log('[Vault] Engine created successfully', {
          engineKey: inboundEngineKey,
          senderDevicePubHead: senderDevicePub.slice(0, 16) + '...',
          preDecryptState: {
            Ns: preState.Ns,
            Nr: preState.Nr,
            PN: preState.PN,
            CKr_exists: !!preState.CKr_hex,
            DHr_pubHead: preState.DHr_pubHex?.slice(0, 16) + '...',
          },
        });
      }

      const ciphertext = sodium.from_hex(packet.ciphertextHex);
      const nonce = sodium.from_hex(packet.nonceHex);

      // SECURITY: Validate and log messageIndex/PN transmission from backend
      // This diagnoses "AD field mismatch" issues where backend values don't reach frontend
      const messageIndex = packet.messageIndex ?? 0;
      const PN = packet.pn ?? 0;

      if (packet.messageIndex === undefined) {
        console.warn('[Vault] WARN: messageIndex undefined from backend packet (using default 0)', {
          messageId: packet.id,
          senderDeviceId: packet.senderDeviceId,
        });
      } else {
        console.debug('[Vault] MessageIndex from backend:', { messageIndex, messageId: packet.id });
      }

      if (packet.pn === undefined) {
        console.warn('[Vault] WARN: PN undefined from backend packet (using default 0)', {
          messageId: packet.id,
          senderDeviceId: packet.senderDeviceId,
        });
      } else {
        console.debug('[Vault] PN from backend:', { PN, messageId: packet.id });
      }

      if (!Number.isFinite(messageIndex) || messageIndex < 0) {
        console.error('[Vault] Rejecting message with invalid messageIndex', { messageIndex });
        return;
      }

      if (!packet.senderDHRPubHex) {
        console.error('[Vault] Rejecting message missing senderDHRPubHex');
        return;
      }
      const senderDHRPub = sodium.from_hex(packet.senderDHRPubHex);

      // Resolve sender identity once (no network I/O). The common path already
      // passes it in via options.senderUserId, so this only falls back for the
      // rare quarantined/trusted flows.
      const senderUserId =
        options?.senderUserId ?? (await this.resolveSenderUserId(linkId, packet.senderDeviceId));

      let receiptSnapshot = engine.exportRatchetState();
      let receiptCommitted = false;
      const commitReceipt = async (): Promise<boolean> => {
        try {
          // Plaintext first: a crash before the ratchet save leaves a decryptable
          // relay retry; a crash after it leaves an already-durable, deduped row.
          await this.persistMessages(linkId, operation);
          await this.persistEngineState(inboundEngineKey, operation, receiptHash);
          operation.assertCurrent();
          receiptCommitted = true;
          return true;
        } catch (error) {
          if (operation.isCurrent()) {
            await engine?.importRatchetState(receiptSnapshot);
            deferReceipt();
          }
          console.warn('[Vault] Receipt persistence failed; relay retry retained', error);
          return false;
        }
      };
      try {
        let plaintext: string;

        const inboundFrame = {
          ciphertext,
          nonce,
          messageIndex,
          senderDHRPub,
          PN,
        };

        // Snapshot ratchet state before any attempt so a failed decrypt
        // doesn't permanently advance (and corrupt) the ratchet chain.
        const stateSnapshot = engine.exportRatchetState();

        try {
const decryptingEngine = engine;
          if (!decryptingEngine) throw new Error('Decryption engine unavailable');
          plaintext = await operation.wait(() => decryptingEngine.decryptFrame(inboundFrame));
        } catch (err) {
          // SECURITY: Log full error details for debugging ratchet desync
          const errMsg = err instanceof Error ? err.message : String(err);
          const preFailureState = engine.exportRatchetState();

          if (errMsg.includes('Stale') && errMsg.includes('message key not available')) {
            await engine.importRatchetState(stateSnapshot);
            // A missing consumed key is not authenticated receipt evidence. Do
            // not let repeated unproven replays become poison-message ACKs either.
            try {
              this.transport?.nackMessage(packet.id);
            } catch (nackError) {
              console.warn('[Vault] Failed to NACK unproven consumed-key packet', nackError);
            }
            console.warn('[Vault] Consumed-key packet has no retained receipt proof', { messageId: packet.id });
            return;
          }

          console.error('[Vault] Decryption failed — full diagnostic', {
            messageId: packet.id,
            messageIndex,
            senderDeviceId: packet.senderDeviceId,
            senderDHRPubHex: packet.senderDHRPubHex?.slice(0, 16) + '...',
            errorMessage: errMsg,
            ratchetState: {
              Ns: preFailureState.Ns,
              Nr: preFailureState.Nr,
              PN: preFailureState.PN,
              DHr_pubHexHead: preFailureState.DHr_pubHex?.slice(0, 16) + '...',
              CKr_exists: !!preFailureState.CKr_hex,
              skippedKeysCount: preFailureState.MKSKIPPED?.length || 0,
            },
          });

          await engine.importRatchetState(stateSnapshot);
          console.error('[Vault] Decryption failed — ratchet state restored', { messageIndex });

          // SECURITY: Fresh Engine Self-Healing (SK Mismatch Recovery)
          // On first message failure with a brand-new engine (Nr=0, no prior state),
          // attempt to recover by refreshing device info and recreating the engine.
          // This handles cases where device pubs are stale from before link re-establishment.
          const isFreshEngineFailure = preFailureState.Nr === 0;
          // CHANGE: Track recovery per-link (not per-message) to prevent duplicate recovery attempts on same link
          const linkRecoveryKey = `${linkId}:${packet.senderDeviceId}`;
          const shouldAttemptSKRecovery =
            isFreshEngineFailure &&
            !this.skRecoveryAttempted.has(linkRecoveryKey) &&
            !this.decryptFailureCountByMessageId[packet.id];

          if (shouldAttemptSKRecovery) {
            this.skRecoveryAttempted.add(linkRecoveryKey); // Link-level recovery tracking
            console.warn('[Vault] Attempting SK mismatch recovery for fresh engine', {
              linkId,
              messageId: packet.id,
              senderDeviceId: packet.senderDeviceId,
            });

            try {
              // Re-fetch fresh link info to get current device details
              const linksStore = (await import('stores/links')).useLinksStore();
              await linksStore.fetchLinks();

              const refreshedLink = linksStore.links.find((l) => l.id === linkId);
              if (refreshedLink) {
                const refreshedSenderDevice = [
                  ...(refreshedLink.sender.devices || []),
                  ...(refreshedLink.receiver.devices || []),
                ].find((d) => d.id === packet.senderDeviceId);

                if (
                  refreshedSenderDevice?.devicePub &&
                  refreshedSenderDevice.devicePub !== senderDevicePub
                ) {
                  console.warn(
                    '[Vault] Device pub mismatch detected — refreshed device pub differs from cached',
                    {
                      cached: senderDevicePub.slice(0, 16) + '...',
                      refreshed: refreshedSenderDevice.devicePub.slice(0, 16) + '...',
                      senderDeviceId: packet.senderDeviceId,
                    },
                  );

                  // Delete stale engine and recreate with refreshed device pub
                  const staleEngineKey = inboundEngineKey;
                  delete this.engines[staleEngineKey];
                  const uid = this.getStorageUid();
                  const ratchetKey = `vault_ratchet_v4_${staleEngineKey}_uid_${uid}`;
                  try {
                    await del(ratchetKey);
                    const idxKey = `vault_ratchet_index_${uid}`;
                    const existing = (await get<string[]>(idxKey)) || [];
                    await set(
                      idxKey,
                      existing.filter((k) => k !== ratchetKey),
                    );
                  } catch {
                    /* best effort */
                  }

                  // Recreate engine with refreshed device pub and retry once
                  console.log('[Vault] Recreating engine with refreshed device pub', {
                    senderDeviceId: packet.senderDeviceId,
                  });
                  const recoveredEngine = await this.getEngine(
                    linkId,
                    refreshedSenderDevice.devicePub,
                    inboundEngineKey,
                    options?.senderUserId,
                    selfSessionPeer,
                  );

                  try {
                    receiptSnapshot = recoveredEngine.exportRatchetState();
                    plaintext = await operation.wait(() => recoveredEngine.decryptFrame(inboundFrame));
                    console.log(
                      '[Vault] SK recovery successful — message decrypted after device refresh',
                      { messageId: packet.id },
                    );
                    engine = recoveredEngine;
                    // Store recovered state and continue to successful path
                    operation.assertCurrent();
                    // Skip to message handling (jump over error path)
                    if (await this.ingestSilentSelfMessage(linkId, packet, plaintext)) {
                      if (!await commitReceipt()) return;
                      try {
                        this.transport?.ackMessage(packet.id);
                      } catch (ackErr) {
                        console.error('[Vault] Failed to ACK self/history message', ackErr);
                      }
                      return;
                    }
                    const resolvedMessageId = this.extractClientMessageId(plaintext) || packet.id;
                    const clientMsg: ClientMessage = {
                      id: resolvedMessageId,
                      isSender: false,
                      senderId: senderUserId ?? undefined,
                      plaintext,
                      senderDeviceId: packet.senderDeviceId,
                      timestamp: this.parseMessageEpochMs(packet.createdAt),
                      isUnsafe: options?.markUnsafe === true,
                    };

                    if (this.handleControlMessage(linkId, plaintext, senderUserId)) {
                      if (!await commitReceipt()) return;
                      try {
                        this.transport?.ackMessage(packet.id);
                      } catch (ackErr) {
                        console.error('[Vault] Failed to ACK control message', ackErr);
                      }
                      return;
                    }

                    await this.appendMessage(linkId, clientMsg, operation);
                    if (!await commitReceipt()) return;
                    this.markLinkUnread(linkId);

                    try {
                      this.transport?.ackMessage(packet.id);
                    } catch (ackErr) {
                      console.warn('[Vault] Failed to ACK decrypted message', ackErr);
                    }
                    return;
                  } catch (retryErr) {
                    console.warn(
                      '[Vault] SK recovery retry also failed — proceeding with normal error handling',
                      {
                        messageId: packet.id,
                        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
                      },
                    );
                    // Continue to normal error handling below
                  }
                } else {
                  console.log(
                    '[Vault] Device pub unchanged after refresh — proceeding with normal error handling',
                    {
                      senderDeviceId: packet.senderDeviceId,
                    },
                  );
                }
              } else {
                console.warn('[Vault] Could not refresh link info for SK recovery', { linkId });
              }
            } catch (recoveryErr) {
              console.warn(
                '[Vault] SK recovery attempt failed, proceeding with normal error handling',
                {
                  reason: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
                },
              );
            }
          }

          const failCount = (this.decryptFailureCountByMessageId[packet.id] ?? 0) + 1;
          this.decryptFailureCountByMessageId[packet.id] = failCount;

          // SECURITY: Report decryption failure back to sender (MESSAGE_NACK)
          // This allows the sender to know the message failed at recipient side
          try {
            this.transport?.nackMessage(packet.id);
            console.debug('[Vault] Sent MESSAGE_NACK to sender for failed decryption', {
              messageId: packet.id,
              messageIndex,
            });
          } catch (nackErr) {
            console.warn('[Vault] Failed to send MESSAGE_NACK', nackErr);
          }

          // Poison-message guard: after repeated failures, drop this packet so
          // it cannot block normal conversation progress on reconnect.
          if (failCount >= 3) {
            this.droppedCiphertextIds.add(packet.id);
            try {
              this.transport?.ackMessage(packet.id);
            } catch (ackErr) {
              console.warn('[Vault] Failed to ACK dropped undecipherable message', ackErr);
            }
            this.markMessageProcessed(packet.id);
            console.warn('[Vault] Dropped undecipherable packet after repeated failures', {
              messageId: packet.id,
              messageIndex,
              failCount,
            });
            return;
          }

          // Recovery path: request a one-shot sync to fill potential ordering gaps.
          const failureKey = `${linkId}:${packet.senderDeviceId}`;

          // Track per-engine cumulative failures to detect a fundamentally broken ratchet
          if (!this.engineFailureCounts) this.engineFailureCounts = {};
          const engineCumulative = (this.engineFailureCounts[failureKey] ?? 0) + 1;
          this.engineFailureCounts[failureKey] = engineCumulative;

          // Repeated authentication failures are not authority to destroy or
          // re-bootstrap a ratchet. Preserve it for explicit, verified recovery.
          if (engineCumulative === 10) {
            console.warn('[Vault] Repeated decryption failure; ratchet retained for recovery');
          }

          // Do NOT call fetchPendingMessages here — it re-delivers the same
          // messages and creates a recursive failure loop that corrupts ratchet state.
          return;
        }

        operation.assertCurrent();

        // Cross-device history backfill envelopes and self-sync copies are
        // ingested silently (no unread bump, no notification sound). Only a
        // genuine incoming partner message continues into the normal path.
        if (await this.ingestSilentSelfMessage(linkId, packet, plaintext)) {
          if (!await commitReceipt()) return;
          try {
            this.transport?.ackMessage(packet.id);
          } catch (ackErr) {
            console.error('[Vault] Failed to ACK self/history message', ackErr);
          }
          return;
        }

        const resolvedMessageId = this.extractClientMessageId(plaintext) || packet.id;
        const clientMsg: ClientMessage = {
          id: resolvedMessageId,
          isSender: false,
          senderId: senderUserId ?? undefined,
          plaintext,
          senderDeviceId: packet.senderDeviceId,
          timestamp: this.parseMessageEpochMs(packet.createdAt),
          isUnsafe: options?.markUnsafe === true,
        };

        // Intercept control messages (delete, reaction) before storing
        if (this.handleControlMessage(linkId, plaintext, senderUserId)) {
          if (!await commitReceipt()) return;
          // ACK control message too
          try {
            this.transport?.ackMessage(packet.id);
          } catch (ackErr) {
            console.error('[Vault] Failed to ACK control message', ackErr);
          }
          return; // Don't store as visible message
        }

        await this.appendMessage(linkId, clientMsg, operation);
        if (!await commitReceipt()) return;

        const isActiveConversation = this.activeLinkId === linkId && this.appFocused;
        if (isActiveConversation) {
          this.markLinkRead(linkId);
        } else {
          this.markLinkUnread(linkId);
        }

        // Notify only when this chat is not currently open.
        if (!clientMsg.isSender && !isActiveConversation) {
          // Respect per-chat mute (no notification sound for muted chats).
          const chatSettings = await this.loadChatSettings(linkId);
          const muted = chatSettings?.muted === true;

          // In-app banner (Discord-style). This is the ONE place every delivery path
          // funnels through — realtime socket, a pending-message fetch, or a push that
          // triggered that fetch — so hooking here is what makes the banner appear for
          // a message that never reached the FCM listener. (Observed on device: the
          // socket was mid-reconnect, the message arrived via the pending fetch, and
          // the push-only banner path never ran.)
          //
          // Only while the app is actually in front of the user and not mid-batch:
          // a backgrounded app is the tray notification's job, and an initial sync
          // would fire a banner per backlog message.
          if (
            this.appFocused &&
            !muted &&
            !this.batchSyncInProgress &&
            (await this.inAppBannerEnabled())
          ) {
            void this.announceInAppArrival(linkId, clientMsg);
          }

          if (!muted) {
            if (this.batchSyncInProgress) {
              // Batch/initial sync: suppress per-message sounds; play once at the
              // end of the batch only if the aggregate unread count is > 3.
              this.batchUnreadAccumulated += 1;
            } else {
              try {
                const { playNotificationSound } = await import('src/utils/notificationSound');
                await playNotificationSound();
              } catch (notifErr) {
                console.warn('[Vault] Failed to play notification sound:', notifErr);
              }
            }
          }
        }

        // ACK to server after successful decrypt to enable safe removal from queue
        try {
          this.transport?.ackMessage(packet.id);
        } catch (ackErr) {
          console.error('[Vault] Failed to ACK message to server', ackErr);
        }

        // Ensure messages are loaded for this link to prevent one-sided conversations
        // if a message arrives before the user opens the chat
        if (!this.messages[linkId]) {
          console.log('[Vault] Loading messages for link because it was null after append');
          await this.loadMessages(linkId);
        }
      } catch (err) {
        if (!receiptCommitted && operation.isCurrent()) {
          await engine.importRatchetState(receiptSnapshot);
          deferReceipt();
        }
        console.error('[Vault] Failed to decrypt inbound packet', err);
      }
    },

    markLinkRead(linkId: string) {
      this.unreadLinks[linkId] = false;
      this.unreadMessageCounts[linkId] = 0;
      this.unreadLinks = { ...this.unreadLinks };
      this.unreadMessageCounts = { ...this.unreadMessageCounts };
      void this.persistUnreadState();
      void this.syncUnreadBadge();
      void this.reportLinkRead(linkId);
    },

    /**
     * Drop `hist_*` backfill rows that duplicate a real message this device
     * already stored (same side, same visible text, timestamp within 2s).
     *
     * History entries are keyed by content because the relay frame carries no
     * original message id, so the backfill cannot tell "this message is new"
     * from "this message is already here under its own id" — which is what
     * produced duplicate bubbles. Only history rows are ever dropped; a real
     * message is never touched.
     */
    dedupeHistoryDuplicates(list: ClientMessage[]): ClientMessage[] {
      const real = list.filter((m) => !m.id.startsWith('hist_'));
      if (real.length === 0) return list;
      return list.filter((m) => {
        if (!m.id.startsWith('hist_')) return true;
        const body = messageBodyOf(m.plaintext);
        return !real.some(
          (r) =>
            r.isSender === m.isSender &&
            Math.abs((r.timestamp ?? 0) - (m.timestamp ?? 0)) <= 2000 &&
            messageBodyOf(r.plaintext) === body,
        );
      });
    },

    /**
     * Sweep every stored thread once and drop `hist_*` rows that duplicate a
     * real message. Rows written before the backfill dedupe existed are already
     * on disk, and they only disappear when their chat is opened — this repairs
     * them up front so nothing shows a doubled message even once.
     */
    async repairDuplicateHistoryRows(): Promise<void> {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      try {
        const uid = operation.uid;
        const allKeys = (await operation.wait(() => keys())) as IDBValidKey[];
        for (const key of allKeys) {
          if (typeof key !== 'string') continue;
          operation.assertCurrent();
          if (!key.startsWith('vault_messages_') || !key.endsWith(`_uid_${uid}`)) continue;
          let stored: ClientMessage[] | null = null;
          try {
            const raw = await operation.wait(() => get<unknown>(key));
            stored = sanitizeStoredMessages(raw);
            if (!Array.isArray(raw) || raw.length !== stored?.length) continue;
          } catch {
            continue;
          }
          if (!stored || stored.length === 0) continue;
          if (!stored.some((m) => m.id.startsWith('hist_'))) continue;
          const deduped = this.dedupeHistoryDuplicates(stored);
          if (deduped.length === stored.length) continue;
          const linkId = key.slice('vault_messages_'.length, -(`_uid_${uid}`.length));
          // Hydration merges concurrent arrivals and applies retention before writing.
          await operation.wait(() => this.loadMessages(linkId));
          console.log('[Vault] Repaired duplicate history rows', {
            linkId,
            removed: stored.length - deduped.length,
          });
        }
      } catch (err) {
        // A repair pass must never break startup.
        console.warn('[Vault] Duplicate-history repair skipped', err);
      }
    },

    /**
     * Tell the server this conversation was read, so the OTHER devices on the
     * account drop their badge and the next push starts counting at 1 instead of
     * the lifetime total. Throttled per link and fire-and-forget: a failed report
     * must never block opening a chat or throw into the read path (an older
     * backend without the endpoint simply 404s and is ignored).
     */
    async reportLinkRead(linkId: string, opts: { force?: boolean } = {}): Promise<void> {
      const operation = captureAccountOperation();
      if (!linkId || !operation.uid) return;
      const throttleKey = `${operation.uid}:${linkId}`;
      const now = Date.now();
      const last = readReportedAt.get(throttleKey) ?? 0;
      if (!opts.force && now - last < READ_REPORT_MIN_INTERVAL_MS) return;
      readReportedAt.set(throttleKey, now);
      try {
        operation.assertCurrent();
        await useAuthStore().postWithFreshCsrf(`/api/v1/vault/links/${encodeURIComponent(linkId)}/read`, {
          readAt: new Date(now).toISOString(),
        });
      } catch (err) {
        // 404 = backend without read-state support yet; anything else is a
        // transient network failure. Neither is worth surfacing.
        console.debug('[Vault] Read receipt not recorded', { linkId, err });
      }
    },

    /**
     * Apply the account's read cursors. Run once the vault is up so a device that
     * was offline while another one read a thread doesn't come back with a stale
     * badge. `linkLastActivity` is our local high-water mark for the thread: if
     * the cursor is at or past it, there is nothing unread left.
     */
    async syncReadStates(): Promise<void> {
      const operation = captureAccountOperation();
      if (!operation.uid) return;
      try {
        const { data } = await api.get<{
          success?: boolean;
          data?: { links?: Record<string, { readAt?: string } | null> };
        }>('/api/v1/vault/read-state');
        operation.assertCurrent();
        const links = data?.data?.links;
        if (!links || typeof links !== 'object') return;

        let changed = false;
        for (const [linkId, state] of Object.entries(links)) {
          const readAt = Date.parse(state?.readAt ?? '');
          if (!Number.isFinite(readAt)) continue;
          const lastActivity = this.linkLastActivity[linkId] ?? 0;
          const isUnread = this.unreadLinks[linkId] === true || (this.unreadMessageCounts[linkId] ?? 0) > 0;
          if (!isUnread || lastActivity > readAt) continue;
          this.unreadLinks[linkId] = false;
          this.unreadMessageCounts[linkId] = 0;
          changed = true;
        }
        if (!changed) return;
        this.unreadLinks = { ...this.unreadLinks };
        this.unreadMessageCounts = { ...this.unreadMessageCounts };
        void this.persistUnreadState();
        void this.syncUnreadBadge();
      } catch {
        /* no read-state support on this backend yet — badges stay local */
      }
    },

    markLinkUnread(linkId: string) {
      this.unreadLinks[linkId] = true;
      this.unreadMessageCounts[linkId] = (this.unreadMessageCounts[linkId] || 0) + 1;
      this.unreadLinks = { ...this.unreadLinks };
      this.unreadMessageCounts = { ...this.unreadMessageCounts };
      void this.persistUnreadState();
      void this.syncUnreadBadge();
      // Also update the links store to move this chat to top
      const unreadCount = this.unreadMessageCounts[linkId] || 0;
      void import('stores/links').then((module) => {
        // Use module instanceof check or direct call
        const linksStore = module.useLinksStore();
        linksStore.updateLinkUnreadCount(linkId, unreadCount);
      });
    },

    queueQuarantinedMessage(
      linkId: string,
      packet: InternalMessagePacket,
      senderDevicePub: string,
      senderIdentityPub?: string | null,
    ) {
      if (!this.quarantinedMessages[linkId]) {
        this.quarantinedMessages[linkId] = [];
      }
      // A redelivered frame must not be stored twice (it would decrypt twice on
      // release), and the queue is bounded: quarantined ciphertext is the user's
      // only copy, but an unbounded queue is a memory leak on a misbehaving peer.
      if (this.quarantinedMessages[linkId].some((entry) => entry.packet.id === packet.id)) {
        return;
      }
      this.quarantinedMessages[linkId].push({
        packet,
        senderDevicePub,
        senderIdentityPub: senderIdentityPub ?? null,
      });
      if (this.quarantinedMessages[linkId].length > QUARANTINE_MAX_PER_LINK) {
        this.quarantinedMessages[linkId] = this.quarantinedMessages[linkId].slice(
          -QUARANTINE_MAX_PER_LINK,
        );
      }
      this.quarantinedMessages = { ...this.quarantinedMessages };
      // Survive a restart / mobile reauth: the relay keeps the frame until the
      // user decides, but the in-memory copy is the only local one.
      void this.persistQuarantinedMessages(linkId).catch((err) => {
        console.warn('[Vault] Could not persist quarantined messages', err);
      });
      console.warn('[Vault] Message quarantined for compromised link', {
        linkId,
        packetId: packet.id,
      });
    },

    /* ------------------------------------------------------------------
       Durable quarantine (CS-03)
       ------------------------------------------------------------------ */

    /** Account-scoped storage key for a link's quarantined frames. */
    quarantineStorageKey(linkId: string, uid: string): string {
      return quarantineStorageKey(linkId, uid);
    },

    /**
     * Write the link's quarantined frames to storage, SEALED.
     *
     * The packets are ciphertext for a ratchet whose key this device already
     * holds, so the at-rest copy is encrypted with a key derived from the
     * account's stored vault device key (HKDF, XChaCha20-Poly1305): the record is
     * opaque to anything that can only read IndexedDB, and a different account's
     * key cannot open it. Never plaintext.
     */
    async persistQuarantinedMessages(linkId: string): Promise<void> {
      const operation = captureAccountOperation();
      const uid = operation.uid;
      if (!uid) return;
      const key = quarantineStorageKey(linkId, uid);
      const queue = this.quarantinedMessages[linkId] ?? [];
      if (queue.length === 0) {
        await operation.wait(() => del(key));
        return;
      }
      const sealed = await operation.wait(() => sealQuarantine(uid, linkId, queue));
      await operation.wait(() => set(key, sealed));
    },

    /**
     * Restore quarantined frames after a restart / reauth teardown. Best effort:
     * an unreadable record (no device key yet, another account, corrupt) is left
     * alone rather than surfaced as a protocol error.
     */
    async restoreQuarantinedMessages(): Promise<void> {
      const operation = captureAccountOperation();
      const uid = operation.uid;
      if (!uid) return;
      try {
        // Follow the active account, never a link list that may be empty yet.
        const linkIds = new Set<string>(Object.keys(this.quarantinedMessages));
        try {
          const linksStore = (await import('stores/links')).useLinksStore();
          if (linksStore.links.length === 0) await linksStore.fetchLinks();
          for (const l of linksStore.links) linkIds.add(l.id);
        } catch {
          operation.assertCurrent();
        }
        for (const linkId of linkIds) {
          const existing = this.quarantinedMessages[linkId] ?? [];
          if (existing.length > 0) continue;
          const sealed = await operation.wait(() => get<unknown>(quarantineStorageKey(linkId, uid)));
          if (!sealed) continue;
          const restored = await operation.wait(() => openQuarantine(uid, linkId, sealed));
          const firstRestored = restored[0];
          if (!firstRestored) continue;
          this.quarantinedMessages[linkId] = restored.slice(-QUARANTINE_MAX_PER_LINK);
          this.compromisedLinks[linkId] = true;
          this.quarantinedDevices[linkId] = {
            ...(this.quarantinedDevices[linkId] || {}),
            [firstRestored.packet.senderDeviceId]: true,
          };
        }
        this.quarantinedMessages = { ...this.quarantinedMessages };
        this.compromisedLinks = { ...this.compromisedLinks };
        this.quarantinedDevices = { ...this.quarantinedDevices };
      } catch (err) {
        if (err instanceof AccountOperationSuperseded) throw err;
        console.warn('[Vault] Could not restore quarantined messages', err);
      }
    },

    /** Drop the durable copy for a link (released, rejected or purged). */
    async forgetQuarantinedMessages(linkId: string): Promise<void> {
      const uid = this.getStorageUid();
      if (!uid || uid === 'unknown') return;
      try {
        await del(quarantineStorageKey(linkId, uid));
      } catch (err) {
        console.warn('[Vault] Could not clear the quarantined record', err);
      }
    },

    notifyCompromised(linkId: string) {
      Notify.create({
        type: 'warning',
        message: 'Messages blocked from a compromised link.',
        timeout: 5000,
        position: 'bottom-right',
        classes: 'font-mono',
        caption: `Link: ${linkId.slice(0, 6)}…`,
      });
    },

    async allowQuarantinedMessages(linkId: string) {
      const queue = this.quarantinedMessages[linkId] || [];
      this.quarantinedMessages[linkId] = [];
      this.quarantinedMessages = { ...this.quarantinedMessages };
      for (const entry of queue) {
        // Each frame carries its own sender device key: reusing one entry's key
        // for the whole batch decrypted every later frame with the wrong key.
        await this.decryptIncomingPacket(linkId, entry.packet, entry.senderDevicePub, {
          markUnsafe: true,
        });
      }
      await this.clearQuarantinedDevice(linkId);
      await this.forgetQuarantinedMessages(linkId);
    },

    /**
     * The link is no longer blocked: drop the per-device quarantine flag and, if
     * no other device of the link is still quarantined, release the link itself.
     */
    async clearQuarantinedDevice(linkId: string, deviceId?: string | null) {
      const devices = { ...(this.quarantinedDevices[linkId] || {}) };
      if (deviceId) delete devices[deviceId];
      else for (const id of Object.keys(devices)) delete devices[id];
      this.quarantinedDevices[linkId] = devices;
      this.quarantinedDevices = { ...this.quarantinedDevices };
      if (Object.keys(devices).length === 0) {
        this.compromisedLinks[linkId] = false;
        this.compromisedLinks = { ...this.compromisedLinks };
      }
    },

    rejectQuarantinedMessages(linkId: string) {
      this.quarantinedMessages[linkId] = [];
      this.quarantinedMessages = { ...this.quarantinedMessages };
      void this.clearQuarantinedDevice(linkId);
      void this.forgetQuarantinedMessages(linkId);
    },

    setSecurityOverride(linkId: string, enabled: boolean) {
      this.overrideSecurity[linkId] = enabled;
      this.overrideSecurity = { ...this.overrideSecurity };
    },

    async allowMessagingTemp(linkId: string) {
      const until = Date.now() + 5 * 60 * 1000;
      this.tempSafetyUntil[linkId] = until;
      this.tempSafetyUntil = { ...this.tempSafetyUntil };
    },

    async markLinkSafe(linkId: string, identityPubHex?: string | null) {
      const identityFromPending = this.pendingPartnerIdentities[linkId] || null;
      const normalizedIdentity = (identityPubHex || identityFromPending || '').trim().toLowerCase();
      if (normalizedIdentity) {
        await this.setTrustedPartnerIdentity(linkId, normalizedIdentity);
      }

      const deviceId =
        this.pendingPartnerDevices[linkId] || this.lastPartnerDevices[linkId] || null;
      if (deviceId) {
        await this.setTrustedPartnerDevice(linkId, deviceId);
        // Remember the pin for the exact device the user just approved.
        if (normalizedIdentity) {
          await this.setTrustedDeviceIdentity(linkId, deviceId, normalizedIdentity);
        }
      }

      const queued = this.quarantinedMessages[linkId] || [];
      for (const entry of queued) {
        await this.decryptIncomingPacket(linkId, entry.packet, entry.senderDevicePub, {
          markUnsafe: false,
        });
      }

      this.compromisedLinks[linkId] = false;
      this.overrideSecurity[linkId] = false;
      this.quarantinedMessages[linkId] = [];
      this.quarantinedDevices[linkId] = {};
      await this.forgetQuarantinedMessages(linkId);
      this.pendingPartnerDevices[linkId] = null;
      this.pendingPartnerIdentities[linkId] = null;
      this.tempSafetyUntil[linkId] = null;
      this.compromisedLinks = { ...this.compromisedLinks };
      this.overrideSecurity = { ...this.overrideSecurity };
      this.quarantinedMessages = { ...this.quarantinedMessages };
      this.quarantinedDevices = { ...this.quarantinedDevices };
      this.pendingPartnerDevices = { ...this.pendingPartnerDevices };
      this.pendingPartnerIdentities = { ...this.pendingPartnerIdentities };
      this.tempSafetyUntil = { ...this.tempSafetyUntil };
    },

    async unanchorLink(linkId: string) {
      const authStore = (await import('stores/auth')).useAuthStore();
      const linksStore = (await import('stores/links')).useLinksStore();
      await authStore.fetchCsrfToken();
      await api.post(
        '/api/v1/links/unanchor',
        { linkId },
        { headers: { 'X-CSRF-Token': authStore.csrfToken } },
      );
      await linksStore.fetchLinks();
    },

    async closeLinkRemote(linkId: string, purge = false) {
      const authStore = (await import('stores/auth')).useAuthStore();
      const linksStore = (await import('stores/links')).useLinksStore();
      await authStore.fetchCsrfToken();
      await api.post(
        '/api/v1/links/close',
        { linkId, purge },
        { headers: { 'X-CSRF-Token': authStore.csrfToken } },
      );
      if (purge) {
        await this.purgeLinkLocal(linkId);
        linksStore.markLinkPurgedLocally(linkId);
      } else {
        await this.clearLinkCryptoState(linkId);
      }
      await linksStore.fetchLinks();
    },

    async requestVaultSync() {
      const transport = this.transport as VaultTransport | null;
      if (!transport) throw new Error('WSS transport not initialized');
      await transport.ensureConnected();

      // Manual sync must always pull pending ciphertext for this device. The
      // WebSocket broadcast only nudges sibling devices; it does not hydrate the
      // current device by itself.
      const t = transport; // narrowed non-null (const, stable across closure)
      await this.beginBatchSync(async () => {
        await this.fetchPendingMessages({ forceRetry: true });
        // On mobile the authoritative message log lives on the desktop, so a
        // manual "sync everything" must also ask it to backfill history (force
        // bypasses the 20s auto-retry cooldown — the user explicitly asked).
        if (isMobileAuthRuntime()) {
          await this.requestHistoryFromDesktop(true);
        }
        t.requestVaultSync();
      });
    },

    /**
     * Run a block with per-message notification sounds suppressed (used for
     * initial vault establishment and manual multi-message syncs). At the end,
     * play a single notification sound if more than 3 unread messages arrived.
     */
    async beginBatchSync(fn: () => Promise<void> | void) {
      const wasAlreadyBatching = this.batchSyncInProgress;
      if (!wasAlreadyBatching) {
        this.batchSyncInProgress = true;
        this.batchUnreadAccumulated = 0;
      }
      try {
        await fn();
      } finally {
        if (!wasAlreadyBatching) {
          this.batchSyncInProgress = false;
          const total = this.batchUnreadAccumulated;
          this.batchUnreadAccumulated = 0;
          // Play a single chime if a meaningful batch of new (unread) messages arrived.
          if (total > 3) {
            const { playNotificationSound } = await import('src/utils/notificationSound').catch(
              () => ({ playNotificationSound: null as (() => Promise<void>) | null }),
            );
            await playNotificationSound?.();
          }
        }
      }
    },

    async deleteChatLocal(linkId: string) {
      // Clear only local messages and cached state, keep link for relinking
      this.messages[linkId] = [];
      this.unreadLinks[linkId] = false;
      this.unreadMessageCounts[linkId] = 0;
      this.quarantinedMessages[linkId] = [];
      this.messages = { ...this.messages };
      this.unreadLinks = { ...this.unreadLinks };
      this.unreadMessageCounts = { ...this.unreadMessageCounts };
      this.quarantinedMessages = { ...this.quarantinedMessages };
      delete this.deletedMessageIds[linkId];
      this.deletedMessageIds = { ...this.deletedMessageIds };
      void this.persistUnreadState();
      void this.syncUnreadBadge();

      const uid = this.getStorageUid();
      await set(`vault_messages_${linkId}_uid_${uid}`, []);
    },

    setActiveLink(linkId: string | null) {
      this.activeLinkId = linkId;
      if (linkId) {
        localStorage.setItem('active_chat_link_id', linkId);
      } else {
        localStorage.removeItem('active_chat_link_id');
      }
    },

    async purgeLinkLocal(linkId: string) {
      // Clear in-memory state
      delete this.messages[linkId];
      delete this.compromisedLinks[linkId];
      delete this.overrideSecurity[linkId];
      delete this.unreadLinks[linkId];
      delete this.unreadMessageCounts[linkId];
      delete this.quarantinedMessages[linkId];
      delete this.quarantinedDevices[linkId];
      delete this.trustedPartnerDevices[linkId];
      delete this.trustedDeviceIdentities[linkId];
      delete this.pendingPartnerDevices[linkId];
      delete this.tempSafetyUntil[linkId];
      delete this.lastPartnerDevices[linkId];
      delete this.deletedMessageIds[linkId];
      this.messages = { ...this.messages };
      this.compromisedLinks = { ...this.compromisedLinks };
      this.overrideSecurity = { ...this.overrideSecurity };
      this.unreadLinks = { ...this.unreadLinks };
      this.unreadMessageCounts = { ...this.unreadMessageCounts };
      this.quarantinedMessages = { ...this.quarantinedMessages };
      this.trustedPartnerDevices = { ...this.trustedPartnerDevices };
      this.pendingPartnerDevices = { ...this.pendingPartnerDevices };
      this.tempSafetyUntil = { ...this.tempSafetyUntil };
      this.lastPartnerDevices = { ...this.lastPartnerDevices };
      this.deletedMessageIds = { ...this.deletedMessageIds };
      void this.persistUnreadState();
      void this.syncUnreadBadge();

      // Drop engines tied to this link to avoid re-use of compromised state
      // SECURITY: Use exact boundary matching with delimiter to prevent substring collisions
      // Engine key format: "${linkId}_${deviceId}"
      Object.keys(this.engines).forEach((key) => {
        // Check if key starts with linkId followed by delimiter, not just substring
        if (key.startsWith(linkId + '_')) {
          console.debug('[Vault] Deleting engine from memory', { linkId, engineKey: key });
          delete this.engines[key];
        }
      });

      // Clear persisted message + settings
      const uid = this.getStorageUid();
      if (uid && uid !== 'unknown') {
        await purgeAttachmentLink(uid, linkId);
        await removeEncryptedRatchetStates(uid, linkId);
        await del(`vault_messages_${linkId}_uid_${uid}`);
        await del(`vault_settings_${linkId}_uid_${uid}`).catch(() => {});

        // Remove ratchet state entries for this link
        // SECURITY: Use exact boundary matching to prevent accidental deletion of other links
        // Ratchet key format: "vault_ratchet_v4_${linkId}_${deviceId}_uid_${uid}"
        const idxKey = `vault_ratchet_index_${uid}`;
        const existing = (await get<string[]>(idxKey)) || [];
        const keep: string[] = [];
        let deletedCount = 0;

        for (const key of existing) {
          // Check if key contains the exact engineKey pattern for this linkId
          // Pattern: "vault_ratchet_v4_${linkId}_${anything}_uid_${uid}"
          const ratchetPrefix = `vault_ratchet_v4_${linkId}_`;
          if (key.startsWith(ratchetPrefix) && key.endsWith(`_uid_${uid}`)) {
            console.debug('[Vault] Deleting ratchet state from storage', {
              linkId,
              key: key.slice(0, 50) + '...',
            });
            await del(key).catch((delErr) => {
              console.error('[Vault] Failed to delete ratchet state', { key, delErr });
            });
            deletedCount++;
          } else {
            keep.push(key);
          }
        }

        if (deletedCount > 0) {
          await set(idxKey, keep);
          console.log('[Vault] Purged link ratchet states', { linkId, deletedCount });
        } else {
          console.warn('[Vault] No ratchet states found to purge for link', { linkId });
        }
      }
    },

    async clearLinkCryptoState(linkId: string) {
      delete this.compromisedLinks[linkId];
      delete this.overrideSecurity[linkId];
      delete this.quarantinedMessages[linkId];
      delete this.quarantinedDevices[linkId];
      void this.forgetQuarantinedMessages(linkId);
      delete this.trustedPartnerDevices[linkId];
      delete this.trustedDeviceIdentities[linkId];
      delete this.pendingPartnerDevices[linkId];
      delete this.tempSafetyUntil[linkId];
      delete this.lastPartnerDevices[linkId];

      this.compromisedLinks = { ...this.compromisedLinks };
      this.overrideSecurity = { ...this.overrideSecurity };
      this.quarantinedMessages = { ...this.quarantinedMessages };
      this.trustedPartnerDevices = { ...this.trustedPartnerDevices };
      this.pendingPartnerDevices = { ...this.pendingPartnerDevices };
      this.tempSafetyUntil = { ...this.tempSafetyUntil };
      this.lastPartnerDevices = { ...this.lastPartnerDevices };

      Object.keys(this.engines).forEach((key) => {
        if (key.startsWith(linkId + '_')) {
          console.debug('[Vault] Deleting crypto engine from memory', { linkId, engineKey: key });
          delete this.engines[key];
        }
      });

      const uid = this.getStorageUid();
      if (!uid || uid === 'unknown') return;

      await removeEncryptedRatchetStates(uid, linkId);
      const idxKey = `vault_ratchet_index_${uid}`;
      const existing = (await get<string[]>(idxKey)) || [];
      const ratchetPrefix = `vault_ratchet_v4_${linkId}_`;
      const keep: string[] = [];
      let deletedCount = 0;

      for (const key of existing) {
        if (key.startsWith(ratchetPrefix) && key.endsWith(`_uid_${uid}`)) {
          await del(key).catch((err) => {
            console.error('[Vault] Failed to delete link ratchet state', { linkId, key, err });
          });
          deletedCount++;
        } else {
          keep.push(key);
        }
      }

      if (deletedCount > 0) {
        await set(idxKey, keep);
        console.log('[Vault] Cleared link crypto state', { linkId, deletedCount });
      }
    },

    async forceDeleteAllRatchetStatesForLink(linkId: string) {
      // NUCLEAR OPTION: When normal purge doesn't work, completely wipe all ratchet data
      // Useful for debugging or when IDB gets into a bad state
      const uid = this.getStorageUid();
      if (!uid || uid === 'unknown') {
        console.error('[Vault] Cannot force delete - no valid user ID');
        return;
      }

      try {
        const idxKey = `vault_ratchet_index_${uid}`;
        const existing = (await get<string[]>(idxKey)) || [];
        const ratchetPrefix = `vault_ratchet_v4_${linkId}_`;
        let forcedDeleteCount = 0;

        console.warn('[Vault] FORCE DELETING all ratchet states for link', { linkId });

        // Delete all keys matching this linkId
        for (const key of existing) {
          if (key.startsWith(ratchetPrefix) && key.endsWith(`_uid_${uid}`)) {
            try {
              await del(key);
              forcedDeleteCount++;
              console.log('[Vault] Force deleted ratchet state', { key: key.slice(0, 50) + '...' });
            } catch (err) {
              console.error('[Vault] Force delete failed', { key, err });
            }
          }
        }

        // Also try deleting by common patterns in case key format changed
        const allKeys = await get<string[]>(idxKey);
        for (const key of allKeys || []) {
          if (key.includes(`${linkId}_`) && key.includes(`_uid_${uid}`)) {
            try {
              await del(key);
              forcedDeleteCount++;
              console.log('[Vault] Pattern matched and deleted', { key: key.slice(0, 50) + '...' });
            } catch (err) {
              console.warn('[Vault] Pattern delete attempt failed', { key, err });
            }
          }
        }

        console.log('[Vault] Force delete complete', { linkId, deletedCount: forcedDeleteCount });
      } catch (err) {
        console.error('[Vault] Force delete failed', err);
      }
    },

    async appendMessage(linkId: string, msg: ClientMessage, operation = captureAccountOperation()) {
      operation.assertCurrent();
      if (!operation.uid) return;
      console.log('[Vault] appendMessage called', {
        linkId,
        messageId: msg.id,
        isSender: msg.isSender,
      });

      // An unread record is not an absent record. Keep arrivals in memory on
      // read failure, but never replace durable history until hydration succeeds.
      if (this.messageLoadState[linkId] !== 'ready') {
        try {
          await operation.wait(() => this.loadMessages(linkId));
        } catch (error) {
          operation.assertCurrent();
          console.warn('[Vault] Arrival retained in memory; local history is unreadable', error);
        }
      }
      this.messages[linkId] ??= [];

      operation.assertCurrent();
      // Duplicate prevention. Three cases, because history backfill and live
      // delivery can arrive in EITHER order:
      //   1. same id                      → exact replay, drop.
      //   2. incoming `hist_` twin exists → drop the backfill copy.
      //   3. incoming real message while a `hist_` twin is already stored
      //                                   → drop the twin, keep the real one
      //                                     (it carries the authoritative id).
      // Without (3) a backfill that landed first left the real message beside it
      // and the thread showed the same message twice.
      const incomingIsHist = msg.id.startsWith('hist_');
      const incomingBody = messageBodyOf(msg.plaintext);
      const sameLogicalMessage = (a: ClientMessage): boolean =>
        a.isSender === msg.isSender &&
        Math.abs((a.timestamp ?? 0) - (msg.timestamp ?? 0)) <= 2000 &&
        messageBodyOf(a.plaintext) === incomingBody;

      if (this.messages[linkId].some((m) => m.id === msg.id)) {
        console.warn('[Vault] Message already exists (duplicate):', { messageId: msg.id, linkId });
        return; // Don't duplicate
      }
      if (incomingIsHist && this.messages[linkId].some((m) => !m.id.startsWith('hist_') && sameLogicalMessage(m))) {
        console.debug('[Vault] Skipping history row already stored as a real message', {
          linkId,
          messageId: msg.id,
        });
        return;
      }
      if (!incomingIsHist) {
        const histTwin = this.messages[linkId].find((m) => m.id.startsWith('hist_') && sameLogicalMessage(m));
        if (histTwin) {
          this.messages[linkId] = this.messages[linkId].filter((m) => m.id !== histTwin.id);
        }
      }

      // Chat-list ordering: every appended message (sent OR received) moves its
      // conversation to the top, independent of whether it is currently open.
      this.noteLinkActivity(linkId, msg.timestamp);

      if (this.wasMessageDeleted(linkId, msg.id)) {
        console.debug('[Vault] Skipping append for message tombstoned by delete control', {
          linkId,
          messageId: msg.id,
        });
        return;
      }

      this.messages[linkId].push(msg);
      // Sort by absolute UTC epoch time to ensure correct chronological order
      // across timezones, skewed local clocks, reconnects, and pending queues.
      this.messages[linkId].sort(this.compareMessagesByEpoch);
      // Reassign to trigger reactivity in consumers that depend on array identity
      this.messages[linkId] = [...this.messages[linkId]];
      // Reassign container map to notify watchers bound to messages object
      this.messages = { ...this.messages };
      console.log('[Vault] Message appended successfully', {
        linkId,
        messageId: msg.id,
        totalMessages: this.messages[linkId]?.length || 0,
      });

      const settings = await operation.wait(() => this.loadChatSettings(linkId));
      if (settings?.mode === 'ephemeral_session' || this.messageLoadState[linkId] !== 'ready') return;

      // Persist to storage - clone array to avoid proxy ref issues
      const plainArr = JSON.parse(JSON.stringify(this.messages[linkId]));

      try {
        await this.persistMessages(linkId, operation);
      } catch (err) {
        operation.assertCurrent();
        // Handle storage quota exceeded gracefully
        const errMsg = String(err).toLowerCase();
        if (errMsg.includes('quota') || errMsg.includes('exceeded')) {
          console.error('[Vault] Storage quota exceeded — message not persisted yet', {
            linkId,
            messageCount: plainArr.length,
          });

          // Reclaim the DISCARDABLE cache first — the server re-serves an attachment
          // whenever it still has it, so this costs the user nothing. Message history
          // CANNOT be undone, so it is only offered as an explicit, user-confirmed
          // fallback when the cache alone did not free enough room.
          const { attachments } = await operation.wait(() => this.reclaimStorageSpace());

          let persisted = false;
          let clearedChats = 0;
          try {
            await this.persistMessages(linkId, operation);
            persisted = true;
            console.log('[Vault] Storage recovered by dropping cached attachments', {
              attachments,
            });
          } catch {
            // Still no room. Ask before touching history.
            operation.assertCurrent();
            clearedChats = (await operation.wait(() => this.clearOldestChats(linkId))) ?? 0;
            if (clearedChats > 0) {
              try {
                await this.persistMessages(linkId, operation);
                persisted = true;
                console.log('[Vault] Storage recovered after clearing old chats', {
                  clearedChats,
                });
              } catch (retryErr) {
                console.error('[Vault] Storage still full after reclaiming space', retryErr);
              }
            }
          }

          // The message stays in memory either way, so it is still visible this session.
          const notifyStore = (await import('stores/notifications')).useNotificationsStore();
          operation.assertCurrent();
          if (!persisted) {
            notifyStore.addNotification({
              id: 'quota_' + Date.now(),
              type: 'OTHER',
              title: 'Device storage full',
              message:
                'Mourn could not save this chat to the device. Free up space to keep your history.',
              data: {},
              isRead: false,
              createdAt: new Date().toISOString(),
            });
          } else if (attachments > 0 || clearedChats > 0) {
            notifyStore.addNotification({
              id: 'quota_' + Date.now(),
              type: 'OTHER',
              title: 'Storage recovered',
              message:
                attachments > 0
                  ? `Cleared ${attachments} cached attachment${attachments === 1 ? '' : 's'} to make room.`
                  : `Cleared ${clearedChats} old chat${clearedChats === 1 ? '' : 's'} to make room.`,
              data: {},
              isRead: false,
              createdAt: new Date().toISOString(),
            });
          }
        } else {
          // Other storage errors (permission, corrupt, etc)
          console.error('[Vault] Failed to persist message', { linkId, err });
        }
      }

      if (import.meta.env.DEV) {
        console.debug(`[Vault] Appended message to ${linkId}. Total: ${plainArr.length}`);
      }
    },

    async clearChat(linkId: string) {
      this.messages[linkId] = [];
      await set(`vault_messages_${linkId}_uid_${this.getStorageUid()}`, []);
    },

    /** Whether the Discord-style in-app arrival banner is switched on (settings -> app). */
    async inAppBannerEnabled(): Promise<boolean> {
      try {
        const { useAppSettingsStore } = await import('src/stores/appSettings');
        const settings = useAppSettingsStore();
        settings.hydrate();
        return settings.inAppMessageBanner;
      } catch {
        // Announcing is the safer default: a settings read failure should not
        // silently swallow every arrival.
        return true;
      }
    },

    /**
     * Show the in-app banner for a message that has just landed.
     *
     * Called (fire-and-forget) from the ingest path so it covers every delivery mode.
     * Anything that goes wrong here must not affect delivery, hence the broad catches.
     */
    async announceInAppArrival(linkId: string, message: ClientMessage): Promise<void> {
      try {
        let senderLabel = '';
        let avatarUrl: string | null = null;
        try {
          const { useLinksStore } = await import('stores/links');
          const link = useLinksStore().links.find((l) => l.id === linkId);
          const partner = link
            ? link.sender?.id === message.senderId
              ? link.sender
              : link.receiver
            : undefined;
          senderLabel = partner?.profile?.displayName || partner?.username || '';
          // The reference (Discord) shows the sender's real picture, not a placeholder.
          avatarUrl = partner?.profile?.profilePicture || null;
        } catch {
          /* fall back to a neutral title / placeholder avatar below */
        }

        // Same rule the tray copy uses: the envelope carries the text, and a blob
        // announcement is summarised rather than shown raw.
        let body = 'New message';
        try {
          const parsed = JSON.parse(message.plaintext) as { text?: unknown };
          if (typeof parsed?.text === 'string' && parsed.text.trim()) {
            body = parsed.text.startsWith('📎') ? 'Sent an attachment' : parsed.text;
          }
        } catch {
          /* keep the neutral body */
        }

        showArrivalBanner({
          // Keyed on the message id so a duplicate delivery replaces its own banner
          // rather than stacking a second one.
          id: `msg-${linkId}-${message.id}`,
          title: senderLabel || 'New message',
          body,
          linkId,
          avatarUrl,
        });
      } catch (err) {
        console.warn('[Vault] Failed to show the in-app arrival banner', err);
      }
    },

    /**
     * Last-resort, DESTRUCTIVE storage recovery: delete the history of up to five
     * other conversations (oldest first, never the open one).
     *
     * This is unrecoverable data loss, so it only runs after the user explicitly
     * confirms it. Declining (or no other conversation to give up) returns 0 and
     * deletes nothing — the caller then reports "storage full" instead.
     */
    async clearOldestChats(excludeLinkId: string): Promise<number> {
      const uid = this.getStorageUid();
      if (!uid || uid === 'unknown') return 0;

      try {
        // The real key shape is `vault_messages_${linkId}_uid_${uid}` — see
        // utils/storageRecovery for why that is unit-tested.
        const allKeys = await keys();
        const chatKeys = chatMessageStorageKeys(allKeys, uid, excludeLinkId);

        if (chatKeys.length === 0) return 0;

        // Oldest first, using the last activity we know for the link.
        const lastActivityFor = (key: string) =>
          this.linkLastActivity?.[linkIdFromMessageKey(key, uid)] ?? 0;
        const ordered = [...chatKeys].sort((a, b) => lastActivityFor(a) - lastActivityFor(b));
        const toClear = ordered.slice(0, 5);

        if (!(await this.confirmHistoryEviction(toClear.length))) {
          console.warn('[Vault] History eviction declined by the user');
          return 0;
        }

        let cleared = 0;
        for (const key of toClear) {
          try {
            await del(key);
            cleared += 1;
            console.log('[Vault] Cleared a chat to free storage', { key });
          } catch (err) {
            console.warn('[Vault] Failed to clear chat', { key, err });
          }
        }
        return cleared;
      } catch (err) {
        console.warn('[Vault] Failed to clear old chats', err);
        return 0;
      }
    },

    /**
     * Ask the user before deleting whole conversations. A cancelled or dismissed
     * dialog (and any failure to show one) is a "no": destructive work never runs
     * on the strength of a dialog that did not answer.
     */
    confirmHistoryEviction(chatCount: number): Promise<boolean> {
      return new Promise((resolve) => {
        try {
          Dialog.create({
            title: 'Device storage is full',
            message:
              `Mourn cannot save this conversation. To make room it can delete the history ` +
              `of ${chatCount === 1 ? '1 other chat' : `${chatCount} other chats`} on this device. ` +
              'That cannot be undone.',
            cancel: { label: 'Keep my history', flat: true, color: 'grey-7', noCaps: true },
            ok: { label: 'Delete old chats', color: 'negative', noCaps: true },
            persistent: true,
          })
            .onOk(() => resolve(true))
            // Dismissal (ESC/backdrop) resolves as a refusal too: destructive
            // work never runs on the strength of a dialog that did not answer.
            .onCancel(() => resolve(false))
            .onDismiss(() => resolve(false));
        } catch (err) {
          console.warn('[Vault] Could not ask about freeing storage', err);
          resolve(false);
        }
      });
    },

    /**
     * Free storage, cheapest loss first: the attachment preview cache, and NOTHING else.
     *
     * Deliberately does not touch message history. History is unrecoverable, so the
     * caller re-attempts its write after this and only if that still fails may it call
     * `clearOldestChats` as a last resort.
     *
     * This separation is the fix for a real, destructive mistake: the first version
     * cleared cached attachments AND the oldest chat histories in one call, so a real
     * device test deleted two conversations even though dropping six cached previews
     * had already freed every byte that was needed.
     */
    async reclaimStorageSpace(): Promise<{ attachments: number; chats: number }> {
      const { evictAttachmentCache } = useBlobAttachmentCache();
      let attachments = 0;
      try {
        attachments = await evictAttachmentCache();
      } catch (err) {
        console.warn('[Vault] Failed to evict the attachment cache', err);
      }
      return { attachments, chats: 0 };
    },

    trackDeletedMessage(linkId: string, messageId: string) {
      if (!messageId) return;
      const current = this.deletedMessageIds[linkId] || [];
      if (current.includes(messageId)) return;
      const next = [...current, messageId];
      // Keep a bounded tombstone list to avoid unbounded growth.
      this.deletedMessageIds[linkId] = next.slice(-500);
      this.deletedMessageIds = { ...this.deletedMessageIds };
    },

    wasMessageDeleted(linkId: string, messageId: string): boolean {
      return (this.deletedMessageIds[linkId] || []).includes(messageId);
    },

    /**
     * Delete one or more messages for everyone in a link.
     *

     * - Batches all IDs into a single encrypted control message and a single
     *   comma-separated deleteTargetMessageId field so the server writes one
     *   tombstone batch per send instead of N individual WS frames.
     * - Deletes locally first for instant UI feedback.
     *
     * Returns the number of messages deleted.
     */
    async deleteMessagesForEveryone(
      linkId: string,
      partnerUserId: string,
      partnerDevices: LinkUserDevice[],
      messageIds: string[],
    ): Promise<number> {
      const operation = captureAccountOperation();
      if (!operation.uid) throw new Error('Authentication required');
      const eligible = messageIds.filter((id) => this.messages[linkId]?.some((message) => message.id === id && message.senderId === operation.uid));

      if (eligible.length === 0) return 0;

      // Delete from local store immediately
      for (const id of eligible) {
        await operation.wait(() => this.deleteMessageById(linkId, id, operation));
      }

      if (partnerDevices.length === 0) throw new Error('Deleted locally only: no recipient devices were available');

      // Send in batches of 50 to keep individual frames manageable
      const BATCH_SIZE = 50;
      for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
        const batch = eligible.slice(i, i + BATCH_SIZE);
        // Encrypted control message carries the full list for the ratchet chain
        const controlMsg = JSON.stringify({ v: 1, type: 'delete_batch', targets: batch });
        // deleteTargetMessageId carries the comma-joined list for the server tombstone path
        const deleteTargetMessageId = batch.join(',');
        try {
          await this.sendMessage(linkId, partnerUserId, partnerDevices, controlMsg, {
            persistLocal: false,
            deleteTargetMessageId,
          });
        } catch (err) {
          operation.assertCurrent();
          throw new Error('Deleted locally, but remote deletion was not confirmed', { cause: err });
        }
        operation.assertCurrent();
      }

      return eligible.length;
    },

    async deleteMessageById(linkId: string, messageId: string, operation = captureAccountOperation()) {
      operation.assertCurrent();
      this.trackDeletedMessage(linkId, messageId);

      const msgs = this.messages[linkId];
      if (!msgs) return false;
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx === -1) return false;

      msgs.splice(idx, 1);
      // Trigger Pinia reactivity by reassigning the parent object
      this.messages = { ...this.messages };

      // Purge cached bytes along with the message record.
      const uid = operation.uid;
      if (!uid) throw new Error('Authentication required');
      await operation.wait(() => purgeAttachmentMessage(uid, linkId, messageId));
      const plainArr = JSON.parse(JSON.stringify(this.messages[linkId]));
      await this.persistMessages(linkId, operation);

      console.debug(
        `[Vault] Deleted message ${messageId} from link ${linkId}. Remaining: ${plainArr.length}`,
      );
      return true;
    },

    /**
     * Intercept control messages (delete, reaction) sent via the E2EE channel.
     * Returns true if the plaintext was a control message (should not be stored as visible).
     */
    handleControlMessage(linkId: string, plaintext: string, authenticatedSenderId?: string | null): boolean {
      const mayDelete = (messageId: string) => {
        const target = this.messages[linkId]?.find((message) => message.id === messageId);
        if (!target || !authenticatedSenderId) return false;
        // Legacy records without an owner are not authority to erase a message.
        return target.senderId === authenticatedSenderId;
      };
      // SECURITY: Reject empty plaintext (likely NACK or failed control frames)
      if (!plaintext || plaintext.trim() === '') {
        console.warn(
          '[Vault] Rejecting empty plaintext - likely NACK or malformed control message',
          { linkId },
        );
        return true;
      }

      if (plaintext.charAt(0) !== '{') return false;
      try {
        const parsed = JSON.parse(plaintext);
        if (!parsed || typeof parsed.v !== 'number') {
          if (parsed && parsed.type === 'protocol_error') {
            console.error(
              '[Vault] Received protocol_error signal for messageId:',
              parsed.messageId,
            );
            void this.handleProtocolErrorSignal(linkId, parsed.messageId);
            return true;
          }
          return false;
        }

        if (parsed.type === 'delete' && typeof parsed.targetId === 'string') {
          console.debug('[Vault] Received delete control message', {
            linkId,
            targetId: parsed.targetId,
          });
          if (mayDelete(parsed.targetId)) {
            void this.deleteMessageById(linkId, parsed.targetId).catch(() => {
              console.warn('[Vault] Could not persist a message deletion');
            });
          }
          return true;
        }

        if (parsed.type === 'delete_batch' && Array.isArray(parsed.targets)) {
          const targets = (parsed.targets as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .slice(0, 200);
          console.debug('[Vault] Received delete_batch control message', {
            linkId,
            count: targets.length,
          });
          for (const targetId of targets) {
            if (mayDelete(targetId)) void this.deleteMessageById(linkId, targetId).catch(() => {
              console.warn('[Vault] Could not persist a message deletion');
            });
          }
          return true;
        }

        if (
          parsed.type === 'reaction' &&
          typeof parsed.targetId === 'string' &&
          typeof parsed.emoji === 'string'
        ) {
          console.debug('[Vault] Received reaction control message', {
            linkId,
            targetId: parsed.targetId,
            emoji: parsed.emoji,
          });
          if (!authenticatedSenderId || parsed.emoji.length > 32 || !this.messages[linkId]?.some((message) => message.id === parsed.targetId)) return true;
          void this.toggleReaction(
            linkId,
            parsed.targetId,
            parsed.emoji,
            authenticatedSenderId,
            parsed.remove === true,
          ).catch(() => { console.warn('[Vault] Could not persist a reaction'); });
          return true;
        }

        if (typeof parsed.text === 'string') return false;

        console.warn('[Vault] Unknown control message type:', parsed.type);
        return true;
      } catch {
        return false;
      }
    },

    extractClientMessageId(plaintext: string): string | null {
      if (!plaintext || plaintext.charAt(0) !== '{') return null;
      try {
        const parsed = JSON.parse(plaintext);
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.v !== 'number' || typeof parsed.text !== 'string') return null;
        if (typeof parsed.clientMessageId !== 'string') return null;
        const id = parsed.clientMessageId.trim();
        return id.length > 0 ? id : null;
      } catch {
        return null;
      }
    },

    async toggleReaction(
      linkId: string,
      messageId: string,
      emoji: string,
      sender: string,
      remove = false,
    ) {
      const msgs = this.messages[linkId];
      if (!msgs) return;
      const msg = msgs.find((m) => m.id === messageId);
      if (!msg) return;

      if (!msg.reactions) msg.reactions = {};

      if (remove) {
        if (msg.reactions[emoji]) {
          msg.reactions[emoji] = msg.reactions[emoji].filter((s) => s !== sender);
          if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
        }
      } else {
        // Keep a single reaction per user by clearing any existing reaction buckets first.
        for (const key of Object.keys(msg.reactions)) {
          const reactions = msg.reactions[key];
          if (!reactions) continue;

          const nextReactions = reactions.filter((s) => s !== sender);
          if (nextReactions.length === 0) {
            delete msg.reactions[key];
          } else {
            msg.reactions[key] = nextReactions;
          }
        }

        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
        if (!msg.reactions[emoji].includes(sender)) {
          msg.reactions[emoji].push(sender);
        }
      }

      this.messages[linkId] = [...(this.messages[linkId] || [])];
      this.messages = { ...this.messages };

      await this.persistMessages(linkId);
    },

    isRateLimited(): boolean {
      return !!(this.rateLimitedUntil && Date.now() < this.rateLimitedUntil);
    },

    async retryMessage(linkId: string, messageId: string) {
      const messages = this.messages[linkId];
      if (!messages) return;

      const msg = messages.find((m) => m.id === messageId);
      if (!msg || !msg.isSender || !msg.plaintext) {
        console.warn('[Vault] Cannot retry message - not found or invalid', { messageId, linkId });
        return;
      }

      msg.status = 'SENDING';
      this.messages = { ...this.messages };

      await this.persistMessages(linkId);
    },

    async deleteLocalMessage(linkId: string, messageId: string) {
      const operation = captureAccountOperation();
      const uid = operation.uid;
      if (!uid) throw new Error('Authentication required');
      const messages = this.messages[linkId];
      if (!messages) return;

      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      messages.splice(idx, 1);
      this.messages = { ...this.messages };

      await operation.wait(() => purgeAttachmentMessage(uid, linkId, messageId));
      await this.persistMessages(linkId, operation);
    },

    async handleProtocolErrorSignal(linkId: string, messageId: string) {
      const messages = this.messages[linkId];
      if (!messages) return;

      const msg = messages.find((m) => m.id === messageId && m.isSender);
      if (msg && msg.status === 'SENDING') {
        msg.status = 'FAILED_PROTOCOL';
        this.messages = { ...this.messages };

        await this.persistMessages(linkId);
      }
    },

    async sendDecryptFailureSignal(
      linkId: string,
      partnerId: string,
      senderDeviceId: string,
      failedMessageId?: string,
    ) {
      if (!this.transport) return;

      try {
        const signal = JSON.stringify({
          type: 'protocol_error',
          errorCode: 'DECRYPT_FAILED',
          failedMessageId: failedMessageId || '',
          timestamp: Date.now(),
        });

        this.transport.sendEncryptedPayloadToUser(
          partnerId,
          [
            {
              targetDeviceId: senderDeviceId,
              ciphertextHex: sodium.to_hex(sodium.from_string(signal)),
              nonceHex: '00'.repeat(24),
              messageIndex: 0,
              senderDHRPubHex: '00'.repeat(64),
              pn: 0,
            },
          ],
          {},
        );

        console.debug('[Vault] Sent protocol_error signal', { linkId, partnerId, senderDeviceId });
      } catch (err) {
        console.debug('[Vault] Failed to send decrypt failure signal', err);
      }
    },

    async sendRecoveryHeartbeat(
      linkId: string,
      partnerUserId: string,
      partnerDevices: LinkUserDevice[],
    ) {
      if (!this.transport || !this.isInitialized) return;
      const operation = captureAccountOperation();
      const transport = this.transport;

      const trackedKey = `heartbeat_${linkId}`;
      const lastHeartbeat = this.lastHeartbeatTimes[trackedKey] || 0;

      if (Date.now() - lastHeartbeat < 5000) {
        return;
      }

      this.lastHeartbeatTimes[trackedKey] = Date.now();

      const validDevices = (partnerDevices || []).filter((d): d is LinkUserDevice =>
        Boolean(d?.id && d?.devicePub),
      );

      if (validDevices.length === 0) return;

      try {
        const frames: Parameters<VaultTransport['sendEncryptedPayloadToUser']>[1] = [];

        for (const device of validDevices) {
          const engineKey = `${linkId}_${device.id}`;
          // A heartbeat is a checkpoint writer too: never export a receive's
          // advanced state before that receive has committed its receipt proof.
          const previous = this.decryptQueueByEngine.get(engineKey) || Promise.resolve();
          const current = previous.catch(() => {}).then(async () => {
            operation.assertCurrent();
            if (this.transport !== transport || !this.isInitialized) throw new Error('Vault heartbeat superseded');
            const engine = this.engines[engineKey];
            if (!engine) return;
            const emptyFrame = await operation.wait(() => engine.encryptFrame(''));
            await this.persistEngineState(engineKey, operation);
            frames.push({
              targetDeviceId: device.id,
              ciphertextHex: sodium.to_hex(emptyFrame.ciphertext),
              nonceHex: sodium.to_hex(emptyFrame.nonce),
              messageIndex: emptyFrame.messageIndex,
              senderDHRPubHex: sodium.to_hex(emptyFrame.senderDHRPub),
              pn: emptyFrame.PN,
            });
          });
          this.decryptQueueByEngine.set(engineKey, current);
          try {
            await current;
          } catch (encryptErr) {
            console.debug('[Vault] Failed to create recovery heartbeat frame', {
              device: device.id,
              encryptErr,
            });
            continue;
          } finally {
            if (this.decryptQueueByEngine.get(engineKey) === current) this.decryptQueueByEngine.delete(engineKey);
          }
        }

        operation.assertCurrent();
        if (frames.length > 0 && this.transport === transport) {
          transport.sendEncryptedPayloadToUser(partnerUserId, frames, {});
          console.debug('[Vault] Sent recovery heartbeat', { linkId, deviceCount: frames.length });
        }
      } catch (err) {
        console.debug('[Vault] Recovery heartbeat failed', err);
      }
    },

    async checkForStalledMessages(linkId: string) {
      const messages = this.messages[linkId];
      if (!messages || messages.length === 0) return false;

      const now = Date.now();
      const stalled = messages.filter(
        (m) => m.isSender && m.status === 'SENDING' && now - m.timestamp > 30000,
      );

      return stalled.length > 0;
    },

    async checkMessageDeliveryStatus(linkId: string, clientMessageIds: string[]) {
      if (clientMessageIds.length === 0) return {};
      if (this.deliveryStatusUnavailable) return {};

      try {
        const response = await api.get('/api/v1/vault/delivery-status', {
          params: {
            linkId,
            messageIds: clientMessageIds.join(','),
          },
        });

        return response.data || {};
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          this.deliveryStatusUnavailable = true;
          console.debug(
            '[Vault] Delivery status endpoint unavailable; disabling delivery polling for this session',
          );
          return {};
        }
        console.warn('[Vault] Failed to check delivery status', err);
        return {};
      }
    },

    async updateMessageStatusFromDelivery(
      linkId: string,
      deliveryStatusMap: Record<string, 'SENT' | 'DELIVERED' | 'FAILED_PROTOCOL'>,
    ) {
      const messages = this.messages[linkId];
      if (!messages) return;

      for (const msg of messages) {
        const status = deliveryStatusMap[msg.id];
        if (status && msg.isSender && msg.status === 'SENDING') {
          msg.status = status as MessageStatus;
        }
      }

      this.messages = { ...this.messages };

      await this.persistMessages(linkId);
    },

    async syncUnreadBadge() {
      // Badges are a native-shell feature (desktop taskbar / mobile launcher);
      // the website has no badge and must not try.
      if (!isNativeBuild || typeof window === 'undefined') {
        return;
      }

      try {
        const { updateUnreadBadge } = await import('src/services/desktopNotifications');
        await updateUnreadBadge(this.unreadCount);
      } catch (err) {
        console.warn('[Vault] Failed to sync unread badge:', err);
      }
    },
  },
});
