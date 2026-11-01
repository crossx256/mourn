import { describe, expect, it, vi } from 'vitest';
import * as apply from '../src/theme/apply';
import * as codes from '../src/theme/codes';
import { defaults, validatePrefs } from '../src/theme/preferences';

const payload = () => ({
  v: 1 as const,
  name: '夜 — theme',
  preset: 'crimson' as const,
  accent: null,
  density: 'comfortable' as const,
  fx: defaults().fx,
  frosted: true,
  font: 'mono' as const,
});
const wire = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('saved theme snapshots', () => {
  it('validates optional effect, frosted and font snapshots while preserving legacy saves', () => {
    const prefs = defaults();
    const legacy = { id: 'saved', name: 'look', preset: prefs.preset, accent: null };
    expect(validatePrefs({ ...prefs, saved: [legacy] })).toBe(true);
    const saved = {
      ...legacy,
      fx: { ...prefs.fx, pattern: 'rain' },
      frosted: true,
      font: 'opendyslexic',
    };
    expect(validatePrefs({ ...prefs, saved: [saved] })).toBe(true);
    for (const patch of [
      { fx: { ...saved.fx, extra: true } },
      { fx: { ...saved.fx, intensity: 2 } },
      { fx: { ...saved.fx, size: NaN } },
      { fx: { ...saved.fx, color: '#12345g' } },
      { fx: { ...saved.fx, pattern: 'url(evil)' } },
      { frosted: 'yes' },
      { font: 'remote' },
      { extra: true },
    ])
      expect(validatePrefs({ ...prefs, saved: [{ ...saved, ...patch }] })).toBe(false);
  });
});

describe('theme codes', () => {
  it('round trips UTF-8 closed snapshots without device/account fields', () => {
    expect(codes.decodeThemeCode(codes.encodeThemeCode(payload()))).toEqual(payload());
    expect(codes.encodeThemeCode(payload())).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('rejects unknown, missing, malicious and invalid fields atomically', () => {
    const bad = [
      null,
      [],
      {},
      { ...payload(), extra: true },
      { ...payload(), v: 2 },
      { ...payload(), preset: '__proto__' },
      { ...payload(), preset: ['crimson'] },
      { ...payload(), accent: 'url(https://evil.test)' },
      { ...payload(), density: 'huge' },
      { ...payload(), font: 'remote' },
      { ...payload(), frosted: 'yes' },
      { ...payload(), name: '<img onerror=alert(1)>' },
      { ...payload(), name: 'a\u0085b' },
      { ...payload(), name: 'x'.repeat(61) },
      { ...payload(), name: ' ' },
      { ...payload(), fx: { ...payload().fx, url: 'evil' } },
      { ...payload(), fx: { ...payload().fx, pattern: 'unknown' } },
      { ...payload(), fx: { ...payload().fx, color: '#12345g' } },
      { ...payload(), fx: { ...payload().fx, size: '1' } },
      { ...payload(), fx: { ...payload().fx, intensity: null } },
      { ...payload(), __proto__: { polluted: true } },
    ];
    for (const value of bad.slice(0, -1)) {
      expect(codes.decodeThemeCode(wire(value)), JSON.stringify(value)).toBeNull();
      expect(() => codes.encodeThemeCode(value as codes.ThemeCode)).toThrow();
    }
    expect(codes.decodeThemeCode(wire(payload()).concat('='))).toBeNull();
    expect(codes.decodeThemeCode('a'.repeat(1537))).toBeNull();
    expect(codes.decodeThemeCode(Buffer.from([0xff]).toString('base64url'))).toBeNull();
    expect(codes.decodeThemeCode(wire(payload()).slice(0, -1) + '!')).toBeNull();
  });
  it('checks resolved text and onAccent contrast, not a second copy of the palette', () => {
    const colors = apply.resolveTheme(defaults());
    for (const patch of [{ text: colors.bg }, { onAccent: colors.accent }]) {
      const spy = vi.spyOn(apply, 'resolveTheme').mockReturnValue({ ...colors, ...patch });
      try {
        expect(codes.decodeThemeCode(wire(payload()))).toBeNull();
      } finally {
        spy.mockRestore();
      }
    }
  });
  it('rejects CSS names, truncated JSON, noncanonical base64 and oversized decoded data', () => {
    for (const name of ['body { color: red }', 'url(https://evil.test)', 'x\u202ey'])
      expect(codes.decodeThemeCode(wire({ ...payload(), name }))).toBeNull();
    for (const code of [
      'A',
      Buffer.from('{').toString('base64url'),
      wire(payload()) + 'A',
      Buffer.from(JSON.stringify(payload()) + ' '.repeat(1536)).toString('base64url'),
    ])
      expect(codes.decodeThemeCode(code)).toBeNull();
  });
  it('clamps only finite numeric intensity and size without changing the input', () => {
    const input = { ...payload(), fx: { ...payload().fx, intensity: -4, size: 8 } };
    const expected = { ...payload(), fx: { ...payload().fx, intensity: 0, size: 2 } };
    expect(codes.decodeThemeCode(wire(input))).toEqual(expected);
    expect(codes.decodeThemeCode(codes.encodeThemeCode(input))).toEqual(expected);
    expect(input.fx).toMatchObject({ intensity: -4, size: 8 });
    for (const n of [NaN, Infinity, -Infinity]) {
      expect(() =>
        codes.encodeThemeCode({ ...payload(), fx: { ...payload().fx, size: n } }),
      ).toThrow();
    }
  });
  it('rejects contrast failures instead of silently fixing an imported accent', () => {
    expect(codes.decodeThemeCode(wire({ ...payload(), accent: '#8000ff' }))).toBeNull();
    expect(() => codes.encodeThemeCode({ ...payload(), accent: '#8000ff' })).toThrow();
    expect(codes.decodeThemeCode(wire({ ...payload(), accent: '#0080ff' }))?.accent).toBe(
      '#0080ff',
    );
  });
});
