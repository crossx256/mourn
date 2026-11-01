export const ACCENTS = [
  '#ff0000',
  '#ff8000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0080ff',
  '#8000ff',
  '#ff00ff',
] as const;
// Swatches are shortcuts, not the validation boundary: pickers emit strict RGB hex.
export const isAllowedAccent = (x: unknown): x is string =>
  typeof x === 'string' && /^#[0-9a-f]{6}$/.test(x);

export function hasAccentContrast(accent: string, background: string): boolean {
  const luminance = (hex: string) =>
    [1, 3, 5].reduce((sum, offset, index) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
    }, 0);
  const a = luminance(accent), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3;
}
