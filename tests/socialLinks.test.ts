import { afterEach, describe, expect, it } from 'vitest';
import {
  addSocialLink,
  isApprovedHost,
  isRecognizedHost,
  normalizeSocialUrl,
  parseSocialUrl,
  PLATFORM_ICONS,
  recognizeSocialDomain,
  registerApprovedDomains,
  SOCIAL_DOMAINS,
  socialIconDisplay,
  socialLinkEntries,
} from '../src/utils/socialLinks';

describe('social URL parsing and domain recognition', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://github.com/a',
    '//github.com/a',
    'github.com/a',
    'https://',
    'https://user:pass@github.com/a',
    'https://github.com\\@evil.test',
    'https://git\nhub.com/a',
    'https://github.com/\u0000',
    'https://example.com/' + 'x'.repeat(500),
  ])('rejects unsafe or ambiguous input %s', (input) => {
    expect(parseSocialUrl(input)).toBeNull();
  });
  it('normalizes web URLs', () => {
    expect(parseSocialUrl('  HTTPS://GitHub.COM/user  ')?.href).toBe('https://github.com/user');
  });
  it('recognizes every advertised domain and its subdomains', () => {
    for (const [platform, domains] of Object.entries(SOCIAL_DOMAINS)) {
      for (const domain of domains) {
        expect(recognizeSocialDomain(new URL(`https://${domain}/a`))).toBe(platform);
        expect(recognizeSocialDomain(new URL(`https://www.${domain}/a`))).toBe(platform);
      }
    }
  });
  it.each(['github.com.evil.test', 'notgithub.com', 'github-com.test', 'gіthub.com', '127.0.0.1'])(
    'does not recognize deceptive host %s',
    (host) => {
      expect(recognizeSocialDomain(new URL(`https://${host}/github.com`))).toBeNull();
    },
  );
  it('does not infer recognition from a stored platform key or query', () => {
    expect(
      socialLinkEntries({ twitter: 'https://evil.test/?url=https://x.com' })[0]?.recognized,
    ).toBe(false);
  });
  it('preserves legacy handles and numeric profile IDs safely', () => {
    expect(normalizeSocialUrl('youtube', '@channel')?.href).toBe('https://youtube.com/@channel');
    expect(normalizeSocialUrl('roblox', '123')?.href).toBe(
      'https://www.roblox.com/users/123/profile',
    );
    expect(normalizeSocialUrl('discord', '123')?.href).toBe('https://discord.com/users/123');
    expect(normalizeSocialUrl('custom', 'example.com')).toBeNull();
    expect(normalizeSocialUrl('twitter', 'javascript:alert(1)')).toBeNull();
    expect(normalizeSocialUrl('constructor', 'abc')).toBeNull();
  });
});

describe('social link editing', () => {
  it('adds recognized and custom URLs without mutating existing state', () => {
    const initial = { github: 'https://github.com/a' };
    const next = addSocialLink(initial, 'https://example.com/me');
    expect(next).toEqual({ ...initial, custom: 'https://example.com/me' });
    expect(initial).not.toHaveProperty('custom');
    expect(addSocialLink(next, 'https://x.com/me')).toHaveProperty('twitter', 'https://x.com/me');
  });
  it('rejects duplicate URLs and occupied slots rather than overwriting', () => {
    expect(() =>
      addSocialLink({ github: 'https://github.com/me' }, 'HTTPS://GITHUB.COM/me'),
    ).toThrow('already added');
    expect(() => addSocialLink({ github: 'https://github.com/a' }, 'https://github.com/b')).toThrow(
      'remove the existing link',
    );
    expect(() => addSocialLink({ custom: 'https://example.com/' }, 'https://other.test/')).toThrow(
      'one unrecognized',
    );
    expect(() => addSocialLink({}, 'javascript:alert(1)')).toThrow('valid');
  });
  it('includes custom links and marks invalid legacy entries for removal', () => {
    const entries = socialLinkEntries({ custom: 'https://example.com/', discord: 'legacy#1234' });
    expect(entries[0]).toMatchObject({
      key: 'custom',
      recognized: false,
      url: 'https://example.com/',
    });
    expect(entries[1]).toMatchObject({ key: 'discord', url: null });
  });
});

describe('admin-approved domains', () => {
  afterEach(() => registerApprovedDomains([]));

  it('recognises an approved domain and its subdomains', () => {
    registerApprovedDomains(['my-site.example.com']);

    expect(isApprovedHost('https://www.my-site.example.com/me')).toBe(true);
    expect(isApprovedHost('https://sub.my-site.example.com/me')).toBe(true);
    expect(isApprovedHost('https://other.example.com/me')).toBe(false);
    expect(isApprovedHost('not a url')).toBe(false);

    expect(isRecognizedHost('https://my-site.example.com/me')).toBe(true);
    // the built-in table still works
    expect(isRecognizedHost('https://github.com/me')).toBe(true);
    expect(isRecognizedHost('https://random.example.net/me')).toBe(false);
  });

  it('stops the classic row warning for an approved custom link', () => {
    registerApprovedDomains(['my-site.example.com']);
    const [entry] = socialLinkEntries({ custom: 'https://my-site.example.com/me' });
    // no platform key: it stays in the custom slot…
    expect(entry.platform).toBeNull();
    // …but it is recognised, so no visitor warning
    expect(entry.recognized).toBe(true);

    registerApprovedDomains([]);
    const [again] = socialLinkEntries({ custom: 'https://my-site.example.com/me' });
    expect(again.recognized).toBe(false);
  });
});

describe('classic row custom icons', () => {
  const IMAGE = 'https://files.catbox.moe/icon-1.webp';

  it('carries a per-platform override into the entry', () => {
    const entries = socialLinkEntries(
      { instagram: 'https://instagram.com/me', custom: 'https://my.site/me' },
      {
        instagram: { kind: 'image', value: IMAGE },
        custom: { kind: 'emoji', value: '👾' },
      },
    );

    expect(entries[0].iconOverride).toEqual({ kind: 'image', value: IMAGE });
    expect(entries[1].iconOverride).toEqual({ kind: 'emoji', value: '👾' });
    expect(socialIconDisplay(entries[0].iconOverride, entries[0].icon)).toEqual({
      kind: 'image',
      src: IMAGE,
    });
    expect(socialIconDisplay(entries[1].iconOverride)).toEqual({ kind: 'emoji', text: '👾' });
  });

  it('falls back to the platform glyph when there is no override', () => {
    const [entry] = socialLinkEntries({ instagram: 'https://instagram.com/me' }, {});
    expect(entry.iconOverride).toBeNull();
    expect(socialIconDisplay(entry.iconOverride, entry.icon)).toEqual({
      kind: 'icon',
      icon: entry.icon,
    });
    expect(entry.icon).toBe(PLATFORM_ICONS.instagram);
  });

  it("resolves a platform-key override to that platform's glyph", () => {
    expect(socialIconDisplay({ kind: 'platform', value: 'discord' }, 'mdi-link')).toEqual({
      kind: 'icon',
      icon: PLATFORM_ICONS.discord,
    });
  });

  it('keeps an uploaded image only when the URL is present', () => {
    expect(socialIconDisplay({ kind: 'image', value: '' }, 'mdi-link')).toEqual({
      kind: 'icon',
      icon: 'mdi-link',
    });
  });
});
