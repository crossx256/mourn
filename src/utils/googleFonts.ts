const GOOGLE_FONTS_STYLESHEET_ID = 'mourndash-google-font';

const GOOGLE_FONTS_STYLESHEET_BASE = 'https://fonts.googleapis.com/css2?family=';

const TRUSTED_GOOGLE_FONTS_URLS = [
  'https://fonts.googleapis.com/',
  'https://fonts.google.com/specimen/',
] as const;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isGoogleFontsInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!isHttpUrl(trimmed)) return true;
  return TRUSTED_GOOGLE_FONTS_URLS.some((prefix) => trimmed.startsWith(prefix));
}

export function extractGoogleFontFamily(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!isHttpUrl(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (url.hostname === 'fonts.googleapis.com') {
      const family = url.searchParams.get('family');
      if (!family) return null;
      const familyName = family.split(':')[0] ?? family;
      return familyName.replace(/\+/g, ' ');
    }

    if (url.hostname === 'fonts.google.com') {
      const specimenMatch = url.pathname.match(/\/specimen\/([^/]+)/i);
      if (!specimenMatch?.[1]) return null;
      return decodeURIComponent(specimenMatch[1]).replace(/\+/g, ' ');
    }

    return null;
  } catch {
    return null;
  }
}

export function buildGoogleFontsStylesheetHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!isHttpUrl(trimmed)) {
    const encoded = encodeURIComponent(trimmed).replace(/%20/g, '+');
    return `${GOOGLE_FONTS_STYLESHEET_BASE}${encoded}:wght@300;400;500;600;700&display=swap`;
  }

  try {
    const url = new URL(trimmed);

    if (url.hostname === 'fonts.googleapis.com') {
      return trimmed;
    }

    if (url.hostname === 'fonts.google.com') {
      const family = extractGoogleFontFamily(trimmed);
      if (!family) return null;
      const encoded = encodeURIComponent(family).replace(/%20/g, '+');
      return `${GOOGLE_FONTS_STYLESHEET_BASE}${encoded}:wght@300;400;500;600;700&display=swap`;
    }

    return null;
  } catch {
    return null;
  }
}

export function syncGoogleFontsStylesheet(
  value: string | null | undefined,
): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(GOOGLE_FONTS_STYLESHEET_ID) as HTMLLinkElement | null;
  const trimmed = (value || '').trim();

  if (!trimmed) {
    existing?.remove();
    return null;
  }

  const href = buildGoogleFontsStylesheetHref(trimmed);
  if (!href) {
    existing?.remove();
    return null;
  }

  if (existing && existing.getAttribute('href') === href) {
    return existing;
  }

  const link = existing || document.createElement('link');
  link.id = GOOGLE_FONTS_STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.mourndash = 'font';

  if (!existing) {
    document.head.appendChild(link);
  }

  return link;
}

export function removeGoogleFontsStylesheet(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(GOOGLE_FONTS_STYLESHEET_ID)?.remove();
}

// =====================================================================
// UPLOADED FONT (@font-face) support — custom .ttf/.otf/.woff/.woff2
// fonts a user uploads from their own computer (hosted by the CDN Catbox).
// We inject a scoped @font-face with a fixed family name, then reference
// that family. The URL is already sanitized server-side; here we still
// strip dangerous characters defensively before it reaches a stylesheet.
// =====================================================================
const MOURN_FONT_FACE_ID = 'mourndash-custom-font-face';
export const UPLOADED_FONT_FAMILY = 'MournProfileFont';

function sanitizeFontUrl(raw: string): string {
  return String(raw || '')
    .replace(/['"\\\n\r]/g, '')
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
}

export function applyUploadedFont(fontUrl: string | null | undefined): 'uploaded' | 'clear' {
  if (typeof document === 'undefined') return 'clear';
  const existing = document.getElementById(MOURN_FONT_FACE_ID) as HTMLStyleElement | null;
  const trimmed = (fontUrl || '').trim();
  if (!trimmed) {
    existing?.remove();
    return 'clear';
  }
  const safeUrl = sanitizeFontUrl(trimmed);
  const css =
    `@font-face{font-family:'${UPLOADED_FONT_FAMILY}';` +
    `src:url('${safeUrl}') format('truetype');` +
    `font-display:swap;}`;
  if (existing) {
    existing.textContent = css;
  } else {
    const style = document.createElement('style');
    style.id = MOURN_FONT_FACE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
  return 'uploaded';
}

// Resolve the display font-family given an uploaded font URL and/or a Google
// font setting. Uploaded font takes priority so users can override Google.
export function resolveProfileFontFamily(
  customFontUrl: string | null | undefined,
  customFont: string | null | undefined,
): string {
  const uploaded = (customFontUrl || '').trim();
  if (uploaded) return `'${UPLOADED_FONT_FAMILY}', sans-serif`;
  const resolved = customFont ? extractGoogleFontFamily(customFont) : '';
  if (resolved) return `${resolved}, sans-serif`;
  return '"Courier New", monospace';
}
