import FingerprintJS from '@fingerprintjs/fingerprintjs';

export async function collectClientFingerprint(): Promise<string | null> {
  const agent = await FingerprintJS.load();
  const result = await agent.get();
  return result.visitorId;
}

export async function hashClientFingerprint(fingerprint: string | null): Promise<string | null> {
  if (!fingerprint) return null;

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'Web Crypto SubtleCrypto is unavailable; client fingerprint hashing is disabled.',
    );
  }

  const bytes = new TextEncoder().encode(fingerprint);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
