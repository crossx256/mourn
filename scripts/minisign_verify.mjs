import crypto from 'node:crypto';

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const decoder = new TextDecoder('utf-8', { fatal: true });

function decodeBase64(value, maxLength) {
  if (typeof value !== 'string') throw new Error('Invalid Minisign base64');
  const text = value.trim();
  if (!text || text.length > maxLength || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('Invalid Minisign base64');
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text) throw new Error('Noncanonical Minisign base64');
  return bytes;
}

function documentLines(value, count, limit) {
  let text;
  try { text = decoder.decode(decodeBase64(value, limit)); }
  catch { throw new Error('Invalid Tauri base64 text envelope'); }
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length !== count || !lines[0].startsWith('untrusted comment: ') || lines.some(line => /[\r\0]/.test(line))) {
    throw new Error('Invalid Minisign text document');
  }
  return lines;
}

export function decodeTauriPublicKey(value) {
  const lines = documentLines(value, 2, 4096);
  const packet = decodeBase64(lines[1], 128);
  if (packet.length !== 42 || !['Ed', 'ED'].includes(packet.toString('latin1', 0, 2))) {
    throw new Error('Invalid Minisign public key');
  }
  return {
    packet,
    keyId: packet.subarray(2, 10),
    key: crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, packet.subarray(10)]), format: 'der', type: 'spki' }),
  };
}

// Tauri wraps the complete Minisign document in base64, not just its key or
// signature line. ED signs BLAKE2b-512(payload); Ed is Minisign's legacy mode.
export function verifyTauriSignature(payload, encodedSignature, encodedPublicKey) {
  const publicKey = decodeTauriPublicKey(encodedPublicKey);
  const lines = documentLines(encodedSignature, 4, 16384);
  const packet = decodeBase64(lines[1], 128);
  const globalSignature = decodeBase64(lines[3], 128);
  const algorithm = packet.toString('latin1', 0, 2);
  if (packet.length !== 74 || !['Ed', 'ED'].includes(algorithm) || globalSignature.length !== 64 || !lines[2].startsWith('trusted comment: ')) {
    throw new Error('Invalid Minisign signature');
  }
  if (!crypto.timingSafeEqual(publicKey.keyId, packet.subarray(2, 10))) throw new Error('Unexpected Minisign key ID');
  const signature = packet.subarray(10);
  const message = algorithm === 'ED' ? crypto.createHash('blake2b512').update(payload).digest() : payload;
  const trustedComment = Buffer.from(lines[2].slice('trusted comment: '.length), 'utf8');
  if (!crypto.verify(null, message, publicKey.key, signature) ||
      !crypto.verify(null, Buffer.concat([signature, trustedComment]), publicKey.key, globalSignature)) {
    throw new Error('Minisign signature verification failed');
  }
  return true;
}
