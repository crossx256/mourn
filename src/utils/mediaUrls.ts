/** Strip trailing punctuation often captured by URL regexes in chat text. */
export function normalizeMediaUrl(raw: string): string {
  return raw.replace(/[),.;!?]+$/g, '');
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif)(?:\?|$)/i;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v)(?:\?|$)/i;

export function isImageMediaUrl(url: string): boolean {
  const normalized = normalizeMediaUrl(url);
  if (IMAGE_EXT_RE.test(normalized)) return true;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host.includes('tenor.com') || host.includes('giphy.com') || host.includes('klipy.com');
  } catch {
    return false;
  }
}

export function isVideoMediaUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(normalizeMediaUrl(url));
}
