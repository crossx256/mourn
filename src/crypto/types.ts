export interface DeviceKeys {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Mourn custom Double-Ratchet-style encrypted frame (not Signal-compatible).
 *
 * senderDHRPub — sender's current DHR public key (DHs.pub).
 *   Changes only when the sender performs a DHR step (upon receiving a new DHR pub from partner).
 * messageIndex — sender's Ns (position in current sending chain).
 * PN           — number of messages in the sender's PREVIOUS sending chain.
 *   Receiver uses PN to cache skipped keys in the old chain before doing a DHR step.
 *
 * There is NO per-message ephemeral keypair — chain key advancement provides per-message
 * uniqueness within a DHR epoch.
 */
export interface EncryptedMessage {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  messageIndex: number;
  senderDHRPub: Uint8Array;
  PN: number;
}

export interface DecryptedMessage {
  plaintext: string;
  senderDeviceId: string;
}

export interface InternalMessagePacket {
  id: string;
  linkId?: string;
  suiteId?: string;
  senderDeviceId: string;
  ciphertextHex: string;
  nonceHex: string;
  createdAt: number | string;
  expiresAt?: number;
  messageIndex: number;
  /** Hex-encoded sender DHR pub (DHs.pub). Required for ratchet decryption. */
  senderDHRPubHex: string;
  /** Number of messages in sender's previous sending chain. Required for skipped-key caching. */
  pn: number;
  /**
   * True when this frame is a self-sync copy of a message the authenticated
   * user SENT from one of their own devices (server sets this for frames whose
   * target device belongs to the same account as the sender). Such a frame is
   * stored locally as an outgoing (`isSender: true`) message and must never
   * raise unread state or a notification.
   */
  outgoing?: boolean;
}

export interface LinkSecurityState {
  storedIdentityKey?: string;
  isCompromised: boolean;
}

/** Per-engine replay evidence window; no time-based expiry. */
export const MAX_RATCHET_RECEIPTS = 256;

/**
 * Mourn ratchet state (v4); contains secret key material.
 *
 * Uses Double-Ratchet-style state variables with custom pre-init chains and KDFs:
 *   RK   — root key, evolves on each DHR step.
 *   DHs  — my current sending ratchet keypair (pub advertised in headers; priv used for DH).
 *   DHr  — remote party's current ratchet public key (null until first message received).
 *   CKs  — sending chain key (null until sender-init performs first KDF_RK).
 *   CKr  — receiving chain key (null until first DHR step on receive).
 *   Ns   — sending message number (increments per send).
 *   Nr   — receiving message number (increments per receive).
 *   PN   — messages in previous sending chain (saved on DHR step).
 *   MKSKIPPED — cached message keys for out-of-order delivery.
 *
 * Private keys (DHs.priv) ARE serialized. Before the responder's first DH
 * transition this includes its long-term device key. Encrypt all exported state at rest.
 */
export interface RatchetState {
  /** Must be exactly 4. Incompatible imports fail without replacing state. */
  version: number;
  RK_hex: string;
  DHs_pubHex: string;
  DHs_privHex: string;
  DHr_pubHex: string | null;
  CKs_hex: string | null;
  CKr_hex: string | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: Array<{ id: string; keyHex: string }>;

  /**
   * BLAKE2b-256 digests of exact authenticated relay packets, encrypted atomically
   * with the ratchet checkpoint AFTER history persistence. Oldest-first, newest
   * MAX_RATCHET_RECEIPTS receives retained, even after ACK attempts (socket send
   * is not relay confirmation). Outbound checkpoints do not evict them. No TTL:
   * delayed redelivery remains provable until 256 newer receives on this engine.
   * Beyond that bound, missing evidence is NOT authority to re-ACK a consumed key.
   * CipherEngine does not retain this metadata; the storage integration must.
   */
  receivedPacketHashes?: string[];

  /** Device pub binding - pins SK to original device pubs for cryptographic verification. */
  devicePubBinding?: {
    myDevicePubHex: string; // My device pub at initialization
    theirDevicePubHex: string; // Partner's device pub at initialization
    bindingTime: number; // When binding was established (timestamp)
  };
}
