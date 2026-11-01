/**
 * Pure helpers for the v2 profile links ("Linktree-class") list.
 *
 * No Vue, no store, no network: everything here is deterministic and unit-tested in
 * tests/profileLinks.test.ts. The server re-validates all of it (mourn.bio/utils/sanitize.js
 * → sanitizeProfileLinks); these functions exist so the editor never sends rubbish.
 */
import type { LinkStyleConfig, ProfileLink, ProfileLinkIcon } from 'src/types/profile';
import { DEFAULT_LINK_STYLE } from 'src/types/profile';
import {
  PLATFORM_ICONS,
  isRecognizedHost,
  parseSocialUrl,
  recognizeSocialDomain,
} from 'src/utils/socialLinks';
import { platformLabel } from 'src/constants/linkIcons';

/** Mirror of the server caps in mourn.bio/utils/sanitize.js (sanitizeProfileLinks). */
export const MAX_LINKS = { standard: 25, donator: 100 } as const;
export const LINK_TITLE_MAX = 60;
export const LINK_SUBTITLE_MAX = 80;
/**
 * A profile may point at ONE link whose host is not a recognised platform — the same rule
 * the classic icon row has always had with its single `custom` slot. Recognised platforms
 * are unlimited. Mirror of MAX_UNRECOGNIZED_LINKS in mourn.bio/utils/sanitize.js, which is
 * authoritative (the editor refuses locally so the refusal is explained before a round-trip).
 */
export const MAX_UNRECOGNIZED_LINKS = 1;

const FALLBACK_ICON: ProfileLinkIcon = { kind: 'icon', value: 'mdi-link' };

/** `l_` + 8 hex, the same shape the server accepts (and generates when missing). */
export function newLinkId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `l_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Domain-driven icon: the platform glyph when the host is recognised, else a plain link. */
export function detectIcon(url: string): ProfileLinkIcon {
  const parsed = parseSocialUrl(url);
  if (!parsed) return { ...FALLBACK_ICON };
  const platform = recognizeSocialDomain(parsed);
  if (platform && PLATFORM_ICONS[platform]) return { kind: 'platform', value: platform };
  return { ...FALLBACK_ICON };
}

/**
 * Default title for a pasted URL: the platform name when recognised, else the last
 * meaningful path segment, else the bare host.
 */
export function suggestTitle(url: string): string {
  const parsed = parseSocialUrl(url);
  if (!parsed) return '';
  const platform = recognizeSocialDomain(parsed);
  if (platform) return platformLabel(platform);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && last.length <= LINK_TITLE_MAX) {
    const cleaned = decodeURIComponent(last)
      .replace(/[-_+]+/g, ' ')
      .trim();
    if (cleaned) return cleaned.slice(0, LINK_TITLE_MAX);
  }
  return linkHost(url);
}

/**
 * Build a link row from a full URL. Returns null for anything the parser rejects —
 * a bare handle is NOT a link (the server would drop it too).
 */
export function makeProfileLink(
  url: string,
  overrides: Partial<ProfileLink> = {},
): ProfileLink | null {
  const parsed = parseSocialUrl(url);
  if (!parsed) return null;
  const href = parsed.href;
  return {
    id: newLinkId(),
    kind: 'link',
    title: suggestTitle(href),
    subtitle: null,
    url: href,
    icon: detectIcon(href),
    thumb: null,
    style: 'inherit',
    accent: null,
    featured: false,
    visible: true,
    ...overrides,
  };
}

export function makeHeaderLink(title: string): ProfileLink {
  return {
    id: newLinkId(),
    kind: 'header',
    title: title.slice(0, LINK_TITLE_MAX),
    subtitle: null,
    url: null,
    icon: { ...FALLBACK_ICON },
    thumb: null,
    style: 'inherit',
    accent: null,
    featured: false,
    visible: true,
  };
}

export interface BulkParseResult {
  rows: ProfileLink[];
  /** Human-readable reasons for lines that were not added, in input order. */
  skipped: string[];
}

export interface BulkParseOptions {
  /** Rows already in the editor, used for duplicate detection and the cap. */
  existing?: ProfileLink[];
  /** Cap for this account (MAX_LINKS.standard / MAX_LINKS.donator). */
  max?: number;
  /** How many links outside the recognised platforms the whole list may contain. */
  maxUnrecognized?: number;
}

/**
 * Parse pasted text into link rows. One link per line, either a bare URL or
 * `title | url`. Blank lines and `#` comments are ignored; duplicates (against the
 * existing list and within the paste) and unparseable lines are reported, never
 * dropped silently.
 */
export function parseBulkLinks(text: string, options: BulkParseOptions = {}): BulkParseResult {
  const existing = options.existing ?? [];
  const max = options.max ?? MAX_LINKS.standard;
  const maxUnrecognized = options.maxUnrecognized ?? MAX_UNRECOGNIZED_LINKS;
  let unrecognizedUsed = unrecognizedLinks(existing).length;
  const seen = new Set(existing.filter((link) => link.url).map((link) => link.url as string));
  const rows: ProfileLink[] = [];
  const skipped: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (rows.length + existing.length >= max) {
      skipped.push(`over the ${max} link limit: ${line}`);
      continue;
    }

    // "title | url" (pipe is the documented separator), otherwise the whole line is a URL.
    const pipe = line.indexOf('|');
    const titlePart = pipe === -1 ? '' : line.slice(0, pipe).trim();
    const urlPart = (pipe === -1 ? line : line.slice(pipe + 1)).trim();

    const parsed = parseSocialUrl(urlPart);
    if (!parsed) {
      skipped.push(`not a valid http(s) url: ${urlPart.slice(0, 80)}`);
      continue;
    }
    if (seen.has(parsed.href)) {
      skipped.push(`already added: ${parsed.href}`);
      continue;
    }
    seen.add(parsed.href);
    const row = makeProfileLink(parsed.href);
    if (!row) {
      skipped.push(`not a valid http(s) url: ${urlPart.slice(0, 80)}`);
      continue;
    }
    if (!isRecognizedHost(parsed.href)) {
      if (unrecognizedUsed >= maxUnrecognized) {
        skipped.push(
          `only ${maxUnrecognized} link outside the recognised platforms is allowed: ${parsed.href}`,
        );
        continue;
      }
      unrecognizedUsed += 1;
    }
    if (titlePart) row.title = titlePart.slice(0, LINK_TITLE_MAX);
    rows.push(row);
  }

  return { rows, skipped };
}

/** Rows whose target host is not on the recognised platform list. */
export function unrecognizedLinks(links: ProfileLink[]): ProfileLink[] {
  return links.filter(
    (link) => link.kind !== 'header' && !!link.url && !isRecognizedHost(link.url),
  );
}

/** The refusal message used by the editor, or null when the list is within the rule. */
export function unrecognizedConflict(links: ProfileLink[]): string | null {
  const offenders = unrecognizedLinks(links);
  if (offenders.length <= MAX_UNRECOGNIZED_LINKS) return null;
  const [first] = offenders;
  return `only ${MAX_UNRECOGNIZED_LINKS} link outside the recognised platforms is allowed — ${
    first ? linkHost(first.url ?? '') : 'another link'
  } already uses that slot`;
}

/** Move a row by `delta` positions (-1 = up, +1 = down). Out-of-range is a no-op copy. */
export function moveLink(links: ProfileLink[], id: string, delta: number): ProfileLink[] {
  const from = links.findIndex((link) => link.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= links.length) return [...links];
  const next = [...links];
  const [row] = next.splice(from, 1);
  if (!row) return [...links];
  next.splice(to, 0, row);
  return next;
}

export function moveLinkToTop(links: ProfileLink[], id: string): ProfileLink[] {
  const from = links.findIndex((link) => link.id === id);
  if (from <= 0) return [...links];
  const next = [...links];
  const [row] = next.splice(from, 1);
  if (!row) return [...links];
  next.unshift(row);
  return next;
}

export function updateLink(
  links: ProfileLink[],
  id: string,
  patch: Partial<ProfileLink>,
): ProfileLink[] {
  return links.map((link) => (link.id === id ? { ...link, ...patch, id: link.id } : link));
}

export function removeLink(links: ProfileLink[], id: string): ProfileLink[] {
  return links.filter((link) => link.id !== id);
}

/** Drop `visible: false` rows — used by the public render path only, never the editor. */
export function visibleLinks(links: ProfileLink[] | null): ProfileLink[] {
  return (links ?? []).filter((link) => link.visible !== false);
}

/** Client-side mirror of the server cap, so the editor can warn before a save round-trip. */
export function applyCap(links: ProfileLink[], isDonator: boolean): ProfileLink[] {
  const cap = isDonator ? MAX_LINKS.donator : MAX_LINKS.standard;
  return links.slice(0, cap);
}

/** What the renderer needs to draw one row's icon. */
export interface IconDisplay {
  kind: 'platform' | 'icon' | 'emoji' | 'image';
  /** q-icon name for platform/icon kinds */
  icon?: string;
  /** literal text for emoji */
  text?: string;
  /** image source for uploaded/remote icons */
  src?: string;
}

export function resolveIconDisplay(link: ProfileLink): IconDisplay {
  const icon = link.icon;
  if (!icon || typeof icon.value !== 'string' || !icon.value)
    return { kind: 'icon', icon: 'mdi-link' };
  if (icon.kind === 'platform') {
    const glyph = PLATFORM_ICONS[icon.value];
    return { kind: 'icon', icon: glyph || 'mdi-link' };
  }
  if (icon.kind === 'emoji') return { kind: 'emoji', text: icon.value };
  if (icon.kind === 'image' && icon.value.startsWith('https://'))
    return { kind: 'image', src: icon.value };
  return {
    kind: 'icon',
    icon: icon.value.startsWith('mdi-') || icon.value.includes(' ') ? icon.value : 'mdi-link',
  };
}

/** Pull the render/editor style config out of a profile-shaped object. */
export function linkStyleFromProfile(
  profile: Partial<LinkStyleConfig> & Record<string, unknown>,
): LinkStyleConfig {
  const pick = <T>(key: string, fallback: T): T => {
    const value = (profile as Record<string, unknown>)[key];
    return (value === undefined || value === null ? fallback : value) as T;
  };
  return {
    layout: pick('linksLayout', DEFAULT_LINK_STYLE.layout),
    align: pick('linksAlign', DEFAULT_LINK_STYLE.align),
    width: pick('linksWidth', DEFAULT_LINK_STYLE.width),
    radius: pick('linksRadius', DEFAULT_LINK_STYLE.radius),
    color: pick('linksColor', DEFAULT_LINK_STYLE.color),
    backgroundColor: pick('linksBgColor', DEFAULT_LINK_STYLE.backgroundColor),
    hoverEffect: pick('linksHoverEffect', DEFAULT_LINK_STYLE.hoverEffect),
    showTitles: pick('linksShowTitles', DEFAULT_LINK_STYLE.showTitles),
    showThumbs: pick('linksShowThumbs', DEFAULT_LINK_STYLE.showThumbs),
    openNewTab: pick('linksOpenNewTab', DEFAULT_LINK_STYLE.openNewTab),
    position: pick('linksPosition', DEFAULT_LINK_STYLE.position),
    showClassicIcons: pick('linksShowClassicIcons', DEFAULT_LINK_STYLE.showClassicIcons),
    iconPosition: pick('linksIconPosition', DEFAULT_LINK_STYLE.iconPosition),
    gap: pick('linksGap', DEFAULT_LINK_STYLE.gap),
  };
}

/** Max-width presets for the link column, keyed by `linksWidth`. */
export const LINK_WIDTHS: Record<LinkStyleConfig['width'], string> = {
  narrow: '320px',
  default: '420px',
  wide: '560px',
};
