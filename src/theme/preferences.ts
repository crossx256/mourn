import { PRESETS, type Preset } from './presets';
import { hasAccentContrast, isAllowedAccent } from './ramp';
import { DEFAULT_THEME } from './tokens';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type BackdropPattern =
  | 'none'
  | 'dots'
  | 'synapse'
  | 'rain'
  | 'constellations'
  | 'perlin-flow'
  | 'petals'
  | 'sparkles'
  | 'embers';
export interface BackdropPrefs {
  pattern: BackdropPattern;
  color: string | null;
  intensity: number;
  size: number;
}
export type ThemeFont = 'mono' | 'opendyslexic';
export interface SavedTheme {
  id: string;
  name: string;
  preset: Preset;
  accent: string | null;
  density?: Density;
  fx?: BackdropPrefs;
  frosted?: boolean;
  font?: ThemeFont;
}
export interface ThemePrefs {
  v: 1;
  preset: Preset;
  accent: string | null;
  density: Density;
  scale: 0.9 | 1 | 1.1 | 1.25;
  extras: {
    chatTextSize: 'sm' | 'md' | 'lg';
    chatDensity: 'compact' | 'comfortable';
    reduceMotion: boolean;
  };
  saved: SavedTheme[];
  updatedAt: string | null;
  fx: BackdropPrefs;
  frosted: boolean;
  font: ThemeFont;
}
export const defaults = (): ThemePrefs => ({
  v: 1,
  preset: 'crimson',
  accent: null,
  density: 'comfortable',
  scale: 1,
  extras: { chatTextSize: 'md', chatDensity: 'comfortable', reduceMotion: false },
  saved: [],
  updatedAt: null,
  fx: { pattern: 'none', color: null, intensity: 0.5, size: 1 },
  frosted: false,
  font: 'mono',
});
export const clone = (p: ThemePrefs): ThemePrefs => JSON.parse(JSON.stringify(p)) as ThemePrefs;
const closed = (x: object, keys: string[]) => Object.keys(x).every((k) => keys.includes(k));
const look = (p: SavedTheme | ThemePrefs) =>
  typeof p.preset === 'string' &&
  Object.hasOwn(PRESETS, p.preset) &&
  (p.accent === null ||
    (isAllowedAccent(p.accent) &&
      hasAccentContrast(p.accent, { ...DEFAULT_THEME, ...PRESETS[p.preset] }.bg)));
const patterns: BackdropPattern[] = [
  'none',
  'dots',
  'synapse',
  'rain',
  'constellations',
  'perlin-flow',
  'petals',
  'sparkles',
  'embers',
];
export function normalizePrefs(x: unknown): ThemePrefs | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const candidate = x as Record<string, unknown>;
  const legacyKeys = ['v', 'preset', 'accent', 'density', 'scale', 'extras', 'saved', 'updatedAt'];
  const extensionKeys = ['fx', 'frosted', 'font'];
  const extendedKeys = [...legacyKeys, ...extensionKeys];
  if (!closed(candidate, extendedKeys)) return null;
  const extensionCount = extensionKeys.filter((key) => Object.hasOwn(candidate, key)).length;
  if (extensionCount !== 0 && extensionCount !== extensionKeys.length) return null;
  const normalized =
    extensionCount === 0
      ? { ...candidate, fx: defaults().fx, frosted: false, font: 'mono' }
      : candidate;
  return validatePrefs(normalized) ? normalized : null;
}
export function validatePrefs(x: unknown): x is ThemePrefs {
  try {
    const p = x as ThemePrefs;
    return (
      !!p &&
      closed(p, [
        'v',
        'preset',
        'accent',
        'density',
        'scale',
        'extras',
        'saved',
        'updatedAt',
        'fx',
        'frosted',
        'font',
      ]) &&
      new TextEncoder().encode(JSON.stringify(p)).length <= 8192 &&
      p.v === 1 &&
      look(p) &&
      ['compact', 'comfortable', 'spacious'].includes(p.density) &&
      [0.9, 1, 1.1, 1.25].includes(p.scale) &&
      closed(p.extras, ['chatTextSize', 'chatDensity', 'reduceMotion']) &&
      ['sm', 'md', 'lg'].includes(p.extras.chatTextSize) &&
      ['compact', 'comfortable'].includes(p.extras.chatDensity) &&
      typeof p.extras.reduceMotion === 'boolean' &&
      !!p.fx &&
      closed(p.fx, ['pattern', 'color', 'intensity', 'size']) &&
      patterns.includes(p.fx.pattern) &&
      (p.fx.color === null || isAllowedAccent(p.fx.color)) &&
      typeof p.fx.intensity === 'number' &&
      Number.isFinite(p.fx.intensity) &&
      p.fx.intensity >= 0 &&
      p.fx.intensity <= 1 &&
      typeof p.fx.size === 'number' &&
      Number.isFinite(p.fx.size) &&
      p.fx.size >= 0.5 &&
      p.fx.size <= 2 &&
      typeof p.frosted === 'boolean' &&
      ['mono', 'opendyslexic'].includes(p.font) &&
      (p.updatedAt === null ||
        (typeof p.updatedAt === 'string' &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.updatedAt) &&
          Number.isFinite(Date.parse(p.updatedAt)))) &&
      Array.isArray(p.saved) &&
      p.saved.length <= 5 &&
      new Set(p.saved.map((s) => s.id)).size === p.saved.length &&
      p.saved.every(
        (s) =>
          closed(s, ['id', 'name', 'preset', 'accent', 'density', 'fx', 'frosted', 'font']) &&
          look(s) &&
          typeof s.id === 'string' &&
          /^[a-zA-Z0-9_-]{1,64}$/.test(s.id) &&
          typeof s.name === 'string' &&
          !!s.name.trim() &&
          s.name.length <= 60 &&
          !Array.from(s.name).some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '<' || c === '>',
          ) &&
          (s.density === undefined || ['compact', 'comfortable', 'spacious'].includes(s.density)) &&
          (!Object.hasOwn(s, 'fx') || validatePrefs({ ...defaults(), fx: s.fx })) &&
          (!Object.hasOwn(s, 'frosted') || typeof s.frosted === 'boolean') &&
          (!Object.hasOwn(s, 'font') || ['mono', 'opendyslexic'].includes(s.font as string)),
      )
    );
  } catch {
    return false;
  }
}
