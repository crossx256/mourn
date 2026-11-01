import { afterEach, describe, expect, it } from 'vitest';
import { registerApprovedDomains } from '../src/utils/socialLinks';
import {
  MAX_LINKS,
  MAX_UNRECOGNIZED_LINKS,
  applyCap,
  detectIcon,
  linkHost,
  linkStyleFromProfile,
  makeHeaderLink,
  makeProfileLink,
  moveLink,
  moveLinkToTop,
  newLinkId,
  parseBulkLinks,
  removeLink,
  resolveIconDisplay,
  suggestTitle,
  unrecognizedConflict,
  unrecognizedLinks,
  updateLink,
  visibleLinks,
} from '../src/utils/profileLinks';
import type { ProfileLink } from '../src/types/profile';

const link = (url: string): ProfileLink => {
  const row = makeProfileLink(url);
  if (!row) throw new Error(`fixture url not parseable: ${url}`);
  return row;
};

/** Hostnames in order — a readable way to assert ordering. */
const hosts = (rows: ProfileLink[]): string[] => rows.map((row) => linkHost(row.url ?? ''));

describe('link ids', () => {
  it('are l_ + 8 hex and unique across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) ids.add(newLinkId());
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^l_[0-9a-f]{8}$/);
  });
});

describe('icon and title detection', () => {
  it('maps recognised hosts to their platform icon', () => {
    expect(detectIcon('https://www.youtube.com/@me')).toEqual({
      kind: 'platform',
      value: 'youtube',
    });
    expect(detectIcon('https://youtu.be/abc')).toEqual({ kind: 'platform', value: 'youtube' });
    expect(detectIcon('https://x.com/me')).toEqual({ kind: 'platform', value: 'twitter' });
    expect(detectIcon('https://bsky.app/profile/me')).toEqual({
      kind: 'platform',
      value: 'bluesky',
    });
  });

  it('falls back to a plain link for unknown or deceptive hosts', () => {
    const fallback = { kind: 'icon', value: 'mdi-link' };
    expect(detectIcon('https://example.com/me')).toEqual(fallback);
    expect(detectIcon('https://youtube.com.evil.test/x')).toEqual(fallback);
    expect(detectIcon('https://notgithub.com/x')).toEqual(fallback);
    expect(detectIcon('not a url')).toEqual(fallback);
  });

  it('suggests the platform label, else the last path segment, else the host', () => {
    expect(suggestTitle('https://youtube.com/@me')).toBe('youtube');
    expect(suggestTitle('https://www.instagram.com/me/')).toBe('instagram');
    expect(suggestTitle('https://example.com/my-best-work')).toBe('my best work');
    expect(suggestTitle('https://sub.example.com/shop_items')).toBe('shop items');
    expect(suggestTitle('https://example.com')).toBe('example.com');
    expect(suggestTitle('nonsense')).toBe('');
  });
});

describe('building rows', () => {
  it('builds a row from a full URL only', () => {
    const row = link('https://github.com/someone');
    expect(row).toMatchObject({
      kind: 'link',
      url: 'https://github.com/someone',
      title: 'github',
      icon: { kind: 'platform', value: 'github' },
      style: 'inherit',
      visible: true,
      featured: false,
      thumb: null,
      accent: null,
    });
    expect(row.id).toMatch(/^l_[0-9a-f]{8}$/);
  });

  it('rejects handles, missing schemes and dangerous schemes', () => {
    expect(makeProfileLink('@someone')).toBeNull();
    expect(makeProfileLink('github.com/someone')).toBeNull();
    expect(makeProfileLink('javascript:alert(1)')).toBeNull();
    expect(makeProfileLink('data:text/html,hi')).toBeNull();
    expect(makeProfileLink('ftp://github.com/a')).toBeNull();
    expect(makeProfileLink(`https://example.com/${'x'.repeat(500)}`)).toBeNull();
  });

  it('applies overrides without letting them rewrite the id', () => {
    const row = makeProfileLink('https://example.com/a', { title: 'custom', style: 'card' });
    expect(row?.title).toBe('custom');
    expect(row?.style).toBe('card');
    expect(row?.id).toMatch(/^l_[0-9a-f]{8}$/);
  });

  it('makes header rows with no url', () => {
    const header = makeHeaderLink('find me elsewhere');
    expect(header).toMatchObject({ kind: 'header', url: null, title: 'find me elsewhere' });
  });
});

describe('bulk paste', () => {
  it('parses titles with a pipe separator and bare urls', () => {
    const { rows, skipped } = parseBulkLinks(
      ['my tape | https://youtube.com/@me', 'https://github.com/someone', '', '# comment'].join(
        '\n',
      ),
    );
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.title, r.url])).toEqual([
      ['my tape', 'https://youtube.com/@me'],
      ['github', 'https://github.com/someone'],
    ]);
  });

  it('reports duplicates and invalid lines instead of dropping them silently', () => {
    const existing = [link('https://github.com/already')];
    const { rows, skipped } = parseBulkLinks(
      [
        'https://github.com/already',
        'https://github.com/new',
        'https://github.com/new',
        'nope',
        '@handle',
      ].join('\n'),
      { existing },
    );
    expect(rows.map((r) => r.url)).toEqual(['https://github.com/new']);
    // both duplicates and both unparseable lines are reported, in input order
    expect(skipped).toHaveLength(4);
    expect(skipped[0]).toContain('already added');
    expect(skipped[1]).toContain('already added');
    expect(skipped[2]).toContain('not a valid http(s) url');
    expect(skipped[3]).toContain('not a valid http(s) url');
  });

  it('stops at the cap and says so', () => {
    // recognised hosts, so this exercises the CAP and not the unrecognised-link rule
    const lines = Array.from({ length: 5 }, (_v, i) => `https://github.com/user${i}`);
    const { rows, skipped } = parseBulkLinks(lines.join('\n'), { max: 3 });
    expect(rows).toHaveLength(3);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toContain('over the 3 link limit');
  });

  it('counts existing rows towards the cap', () => {
    const existing = Array.from({ length: 3 }, (_v, i) => link(`https://github.com/user${i}`));
    const { rows, skipped } = parseBulkLinks('https://github.com/new', { existing, max: 3 });
    expect(rows).toHaveLength(0);
    expect(skipped[0]).toContain('over the 3 link limit');
  });
});

describe('reordering and editing', () => {
  const links = [
    link('https://a.example/1'),
    link('https://b.example/2'),
    link('https://c.example/3'),
  ];

  it('moves rows and is a no-op at the boundaries', () => {
    expect(hosts(moveLink(links, links[0]!.id, 1))).toEqual([
      'b.example',
      'a.example',
      'c.example',
    ]);
    expect(hosts(moveLink(links, links[2]!.id, 1))).toEqual([
      'a.example',
      'b.example',
      'c.example',
    ]);
    expect(hosts(moveLink(links, links[0]!.id, -1))).toEqual([
      'a.example',
      'b.example',
      'c.example',
    ]);
    expect(moveLink(links, 'missing', 1)).toEqual(links);
  });

  it('moves a row to the top', () => {
    expect(hosts(moveLinkToTop(links, links[2]!.id))).toEqual([
      'c.example',
      'a.example',
      'b.example',
    ]);
    expect(moveLinkToTop(links, links[0]!.id)).toEqual(links);
  });

  it('never mutates the input array', () => {
    const snapshot = JSON.stringify(links);
    moveLink(links, links[1]!.id, -1);
    moveLinkToTop(links, links[2]!.id);
    updateLink(links, links[0]!.id, { title: 'changed' });
    removeLink(links, links[0]!.id);
    expect(JSON.stringify(links)).toBe(snapshot);
  });

  it('updates and removes by id, keeping the id stable', () => {
    const updated = updateLink(links, links[1]!.id, {
      title: 'new title',
      id: 'hacked',
    } as Partial<ProfileLink>);
    expect(updated[1]?.title).toBe('new title');
    expect(updated[1]?.id).toBe(links[1]!.id);
    expect(hosts(removeLink(links, links[1]!.id))).toEqual(['a.example', 'c.example']);
  });

  it('filters hidden rows only for the public path', () => {
    const withHidden = [...links];
    withHidden[1] = { ...withHidden[1]!, visible: false };
    expect(visibleLinks(withHidden)).toHaveLength(2);
    expect(visibleLinks(null)).toEqual([]);
  });

  it('caps by tier', () => {
    const many = Array.from({ length: 40 }, (_v, i) => link(`https://github.com/user${i}`));
    expect(applyCap(many, false)).toHaveLength(MAX_LINKS.standard);
    expect(applyCap(many, true)).toHaveLength(40);
  });
});

describe('icon display', () => {
  it('resolves platform, icon, emoji and image icons', () => {
    expect(resolveIconDisplay(link('https://youtube.com/@me'))).toEqual({
      kind: 'icon',
      icon: 'fa-brands fa-youtube',
    });
    const custom = {
      ...link('https://example.com/a'),
      icon: { kind: 'icon' as const, value: 'mdi-web' },
    };
    expect(resolveIconDisplay(custom)).toEqual({ kind: 'icon', icon: 'mdi-web' });
    const emoji = {
      ...link('https://example.com/a'),
      icon: { kind: 'emoji' as const, value: '🎧' },
    };
    expect(resolveIconDisplay(emoji)).toEqual({ kind: 'emoji', text: '🎧' });
    const image = {
      ...link('https://example.com/a'),
      icon: { kind: 'image' as const, value: 'https://i.ibb.co/x/i.png' },
    };
    expect(resolveIconDisplay(image)).toEqual({ kind: 'image', src: 'https://i.ibb.co/x/i.png' });
  });

  it('falls back for missing or hostile icon values', () => {
    const broken = { ...link('https://example.com/a'), icon: { kind: 'icon' as const, value: '' } };
    expect(resolveIconDisplay(broken)).toEqual({ kind: 'icon', icon: 'mdi-link' });
    const hostile = {
      ...link('https://example.com/a'),
      icon: { kind: 'icon' as const, value: 'javascript:alert(1)' },
    };
    expect(resolveIconDisplay(hostile)).toEqual({ kind: 'icon', icon: 'mdi-link' });
    const remote = {
      ...link('https://example.com/a'),
      icon: { kind: 'image' as const, value: 'http://tracker.test/i.png' },
    };
    expect(resolveIconDisplay(remote).kind).toBe('icon');
  });
});

describe('style config', () => {
  it('reads the flat profile shape and falls back to defaults', () => {
    expect(linkStyleFromProfile({})).toEqual({
      layout: 'stack',
      align: 'center',
      width: 'default',
      radius: null,
      color: null,
      backgroundColor: null,
      hoverEffect: 'inherit',
      showTitles: true,
      showThumbs: true,
      openNewTab: true,
      position: 'below-bio',
      showClassicIcons: false,
      iconPosition: 'left',
      gap: 10,
    });
    expect(
      linkStyleFromProfile({ linksLayout: 'grid', linksGap: 18, linksShowTitles: false }),
    ).toMatchObject({ layout: 'grid', gap: 18, showTitles: false });
  });
});

describe('one unrecognised link per profile', () => {
  it('counts links whose host is not a recognised platform', () => {
    const rows = [
      link('https://youtube.com/@me'),
      link('https://some-personal-site.example/me'),
      link('https://github.com/me'),
      { ...link('https://ignored.example/'), kind: 'header' as const, url: null },
    ];
    expect(MAX_UNRECOGNIZED_LINKS).toBe(1);
    expect(unrecognizedLinks(rows).map((row) => row.url)).toEqual([
      'https://some-personal-site.example/me',
    ]);
  });

  it('allows exactly one and names the offender when a second appears', () => {
    const ok = [link('https://youtube.com/@me'), link('https://some-personal-site.example/me')];
    expect(unrecognizedConflict(ok)).toBeNull();

    const tooMany = [...ok, link('https://another-site.example/me')];
    const message = unrecognizedConflict(tooMany);
    expect(message).toContain('only 1 link outside the recognised platforms');
    expect(message).toContain('some-personal-site.example');
  });

  it('refuses the second unrecognised line in a bulk paste and says why', () => {
    const { rows, skipped } = parseBulkLinks(
      ['https://first-site.example/one', 'https://second-site.example/two'].join('\n'),
      { existing: [], maxUnrecognized: MAX_UNRECOGNIZED_LINKS },
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('only 1 link outside the recognised platforms');
  });

  it('counts an existing unrecognised link against the paste budget', () => {
    const existing = [link('https://already-here.example/me')];
    const { rows, skipped } = parseBulkLinks('https://newone.example/me', {
      existing,
      maxUnrecognized: MAX_UNRECOGNIZED_LINKS,
    });
    expect(rows).toHaveLength(0);
    expect(skipped[0]).toContain('only 1 link outside the recognised platforms');
  });

  it('does not restrict recognised platforms', () => {
    const many = Array.from({ length: 10 }, (_v, i) => link(`https://github.com/user${i}`));
    expect(unrecognizedConflict(many)).toBeNull();
  });
});

describe('admin-approved domains free up the unverified slot', () => {
  afterEach(() => registerApprovedDomains([]));

  it('stops counting an approved domain as unrecognized', () => {
    const mine = makeProfileLink('https://my-site.example.com/me', { title: 'mine' });
    const other = makeProfileLink('https://elsewhere.example.net/me', { title: 'other' });
    const rows = [mine!, other!];
    expect(unrecognizedLinks(rows)).toHaveLength(2);

    registerApprovedDomains(['my-site.example.com']);
    const left = unrecognizedLinks(rows);
    expect(left).toHaveLength(1);
    expect(left[0].url).toBe('https://elsewhere.example.net/me');

    // …so a second previously-illegal link now fits under the rule
    const withTwo = [...rows, makeProfileLink('https://github.com/x', { title: 'gh' })!];
    expect(unrecognizedLinks(withTwo)).toHaveLength(1);
  });
});
