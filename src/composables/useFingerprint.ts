// Coarse risk signal for abuse detection.
// This intentionally avoids invasive browser fingerprinting (canvas, WebGL,
// audio, fonts, plugins, exact hardware data). The server stores a keyed HMAC
// of this value, so the raw client signal is not persisted.

function browserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('firefox/')) return 'firefox';
  if (ua.includes('safari/') && !ua.includes('chrome/')) return 'safari';
  if (ua.includes('chrome/') || ua.includes('chromium/')) return 'chrome';
  return 'unknown';
}

export function platformFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'macos';
  if (ua.includes('android')) return 'android';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function screenBucket(): string {
  if (typeof window === 'undefined') return 'unknown';
  const width = window.screen?.width || window.innerWidth || 0;
  if (width >= 1600) return 'xl';
  if (width >= 1024) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'mobile';
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function useFingerprint() {
  const getFingerprint = async (): Promise<string> => {
    if (typeof navigator === 'undefined') return 'server';

    const userAgent = navigator.userAgent || '';
    const language = (navigator.language || 'unknown').split('-')[0] || 'unknown';
    const timezoneOffset = String(new Date().getTimezoneOffset());
    const isTauri = Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);

    const coarseSignal = JSON.stringify({
      browser: browserFamily(userAgent),
      platform: platformFamily(userAgent),
      screen: screenBucket(),
      language,
      timezoneOffset,
      shell: isTauri ? 'tauri' : 'web',
    });

    return sha256Hex(coarseSignal);
  };

  return {
    getFingerprint,
  };
}
