import { describe, expect, it } from 'vitest';
import { defaults, validatePrefs } from '../src/theme/preferences';
import { ACCENTS, isAllowedAccent } from '../src/theme/ramp';
import { PRESETS, type Preset } from '../src/theme/presets';

describe('custom theme colors', () => {
  it('accepts strict custom RGB hex values from real color pickers', () => {
    expect(isAllowedAccent('#33ccaa')).toBe(true);
    expect(isAllowedAccent('#123456')).toBe(true);
    for (const input of ['#33CCAA', '#abc', '#33ccaa00', 'red', '#33ccaa; color:red', ['#33ccaa'], null])
      expect(isAllowedAccent(input)).toBe(false);
  });
  it('retains readable custom accents across every palette', () => {
    for (const preset of Object.keys(PRESETS) as Preset[]) {
      expect(validatePrefs({ ...defaults(), preset, accent: '#33ccaa' })).toBe(true);
      expect(validatePrefs({ ...defaults(), preset, accent: '#010101' })).toBe(false);
      for (const accent of ACCENTS) expect(validatePrefs({ ...defaults(), preset, accent })).toBe(true);
    }
  });
  it('permits dark effect colors without permitting unreadable text accents', () => {
    expect(validatePrefs({ ...defaults(), fx: { ...defaults().fx, color: '#010101' } })).toBe(true);
    expect(validatePrefs({ ...defaults(), saved: [{ id: 'custom', name: 'Custom', preset: 'ice', accent: '#33ccaa' }] })).toBe(true);
    expect(validatePrefs({ ...defaults(), saved: [{ id: 'dark', name: 'Dark', preset: 'ice', accent: '#010101' }] })).toBe(false);
  });
});
