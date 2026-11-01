import { get, set } from 'idb-keyval';
import sodium from 'libsodium-wrappers';
import { getOrCreateStorageKey as getMasterKey } from './storageKey';

const KEY_BASE = 'mourn_broadcast_vault_key';
const DATA_BASE = 'mourn_broadcast_vault_data';
const MAX_CACHED_MESSAGES = 500;

export interface CachedBroadcastMessage {
  id: string;
  senderId: string;
  text: string;
  keyVersion: number;
  createdAt: string;
}

interface EncryptedEnvelope {
  v: 1;
  nonce: string;
  ciphertext: string;
}

function keyName(userId: string): string {
  return `${KEY_BASE}_uid_${userId}`;
}

function dataName(userId: string, channelId: string): string {
  return `${DATA_BASE}_uid_${userId}_channel_${channelId}`;
}

async function getOrCreateStorageKey(userId: string, channelId: string): Promise<Uint8Array> {
  await sodium.ready;
  if (!userId) throw new Error('Broadcast storage requires an account');
  const masterKey = await getMasterKey(keyName(userId));
  return sodium.crypto_generichash(
    sodium.crypto_secretbox_KEYBYTES,
    sodium.from_string(`mourn-broadcast-cache-v1:${channelId}`),
    masterKey,
  );
}

function normalizeMessages(value: unknown): CachedBroadcastMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((message): message is CachedBroadcastMessage => {
      if (!message || typeof message !== 'object') return false;
      const candidate = message as Partial<CachedBroadcastMessage>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.senderId === 'string' &&
        typeof candidate.text === 'string' &&
        typeof candidate.keyVersion === 'number' &&
        typeof candidate.createdAt === 'string'
      );
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-MAX_CACHED_MESSAGES);
}

export async function saveBroadcastHistory(
  userId: string,
  channelId: string,
  messages: CachedBroadcastMessage[],
): Promise<void> {
  await sodium.ready;
  const key = await getOrCreateStorageKey(userId, channelId);
  const plaintext = sodium.from_string(JSON.stringify(normalizeMessages(messages)));
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const envelope: EncryptedEnvelope = {
    v: 1,
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
  };
  await set(dataName(userId, channelId), envelope);
}

export async function loadBroadcastHistory(
  userId: string,
  channelId: string,
): Promise<CachedBroadcastMessage[]> {
  await sodium.ready;
  const envelope = await get<EncryptedEnvelope>(dataName(userId, channelId));
  if (!envelope || envelope.v !== 1 || !envelope.nonce || !envelope.ciphertext) return [];

  try {
    const key = await getOrCreateStorageKey(userId, channelId);
    const nonce = sodium.from_base64(envelope.nonce, sodium.base64_variants.ORIGINAL);
    const ciphertext = sodium.from_base64(envelope.ciphertext, sodium.base64_variants.ORIGINAL);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    return normalizeMessages(JSON.parse(sodium.to_string(plaintext)) as unknown);
  } catch (error) {
    console.warn('[BroadcastVault] Ignoring corrupt or unreadable local history', error);
    return [];
  }
}
