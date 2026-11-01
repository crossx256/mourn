/**
 * Offline links codec — serialize the Link[] conversation list to/from bytes
 * for the encrypted offline vault, so the messaging page's conversation list
 * is readable offline (the message plaintext itself stays in the existing
 * vault messages IndexedDB store; only the link metadata is cached here).
 */
import type { Link } from 'src/types/links';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Serialize the links snapshot into UTF-8 bytes for the offline vault. */
export function encodeLinksPayload(links: Link[]): Uint8Array {
  return encoder.encode(JSON.stringify(links));
}

/** Deserialize offline-vault bytes back into a links list. Throws on malformed JSON. */
export function decodeLinksPayload(bytes: Uint8Array): Link[] {
  return JSON.parse(decoder.decode(bytes)) as Link[];
}
