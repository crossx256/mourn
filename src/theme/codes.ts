import { defaults, validatePrefs, type ThemePrefs } from './preferences';
import { luminance, resolveTheme } from './apply';

export type ThemeCode = Pick<
  ThemePrefs,
  'v' | 'preset' | 'accent' | 'density' | 'fx' | 'frosted' | 'font'
> & { name: string };
const KEYS = ['v', 'name', 'preset', 'accent', 'density', 'fx', 'frosted', 'font'];
export const validThemeName = (name: unknown): name is string =>
  typeof name === 'string' &&
  !!name.trim() &&
  name.length <= 60 &&
  !/[<>{};\p{Cc}\p{Cf}]|url\s*\(|(?:javascript|data)\s*:/iu.test(name);

function validateCode(value: unknown): ThemeCode | null {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return null;
  const p = value as ThemeCode;
  if (
    Object.keys(p).length !== KEYS.length ||
    !Object.keys(p).every((key) => KEYS.includes(key)) ||
    !validThemeName(p.name)
  )
    return null;
  if (
    !p.fx ||
    typeof p.fx.intensity !== 'number' ||
    !Number.isFinite(p.fx.intensity) ||
    typeof p.fx.size !== 'number' ||
    !Number.isFinite(p.fx.size)
  )
    return null;
  const snapshot = {
    v: p.v,
    preset: p.preset,
    accent: p.accent,
    density: p.density,
    fx: {
      ...p.fx,
      intensity: Math.max(0, Math.min(1, p.fx.intensity)),
      size: Math.max(0.5, Math.min(2, p.fx.size)),
    },
    frosted: p.frosted,
    font: p.font,
  };
  if (!validatePrefs({ ...defaults(), ...snapshot })) return null;
  const colors = resolveTheme({ ...defaults(), ...snapshot });
  if (
    contrast(colors.accent, colors.bg) < 4.5 ||
    contrast(colors.onAccent, colors.accent) < 4.5 ||
    contrast(colors.text, colors.bg) < 4.5
  )
    return null;
  return { ...snapshot, name: p.name.trim() };
}

function contrast(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function encodeThemeCode(value: ThemeCode): string {
  const valid = validateCode(value);
  if (!valid) throw new Error('Invalid theme code');
  const code = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(valid))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  if (code.length > 1536) throw new Error('Theme code exceeds 1536 bytes');
  return code;
}
export function decodeThemeCode(code: string): ThemeCode | null {
  try {
    if (!code || code.length > 1536 || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
    const bytes = Uint8Array.from(atob(code.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
      c.charCodeAt(0),
    );
    const canonical = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    // 1536 base64url bytes can represent at most 1152 decoded bytes.
    if (bytes.length > 1152 || canonical !== code) return null;
    return validateCode(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}
