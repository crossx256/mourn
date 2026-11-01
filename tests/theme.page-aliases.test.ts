import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileString } from 'sass';
import { parse } from '@vue/compiler-sfc';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('page-local theme accents', () => {
  // Un-themed leaderboard keeps its own historical brand red (#e32626); once a
  // client theme is active (preset or custom accent) theme-chrome.scss re-points
  // the alias AND --m-lbRed-rgb to the accent (see theme.prepaint parity).
  it('LeaderboardPage keeps its legacy default but gives chromatic ink a themed slot', () => {
    const style = parse(read('../src/pages/LeaderboardPage.vue')).descriptor.styles[0]!;
    expect(style.content).toContain('--lb-red: rgb(var(--m-lbRed-rgb, 227 38 38))');
    expect(style.content).not.toContain('--lb-red: #e32626');
    expect(style.content).not.toMatch(/rgba\(227,\s*38,\s*38,/);
    expect(style.content).toContain('var(--lb-ink-rgb, var(--m-lbRed-rgb, 227 38 38))');
    expect(() => compileString(style.content)).not.toThrow();
    const chrome = read('../src/css/theme-chrome.scss');
    expect(chrome).toContain('--lb-ink-rgb: var(--m-accent-rgb)');
    expect(chrome).toContain('--lb-red: rgb(var(--m-accent-rgb))');
  });
  it('keeps the archives page private palette off the accent follower', () => {
    // The audit of VAL-01: ACCENT_FOLLOWERS must stay scoped to the leaderboard.
    // --archive-red is a reading surface, not brand ink, and must keep its literal.
    const style = parse(read('../src/pages/ArchivesPage.vue')).descriptor.styles[0]!;
    expect(style.content).toContain('--archive-red: #e32626');
  });
  it.each([['ArchivesPage', 'archive']])(
    '%s keeps its legacy default but gives chromatic ink a themed slot',
    (page, prefix) => {
      const style = parse(read(`../src/pages/${page}.vue`)).descriptor.styles[0]!;
      expect(style.content).toContain(`--${prefix}-red: #e32626`);
      expect(style.content).not.toMatch(/rgba\(227,\s*38,\s*38,/);
      expect(style.content).toContain(`var(--${prefix}-ink-rgb, 227 38 38)`);
      expect(() => compileString(style.content)).not.toThrow();
      const chrome = read('../src/css/theme-chrome.scss');
      expect(chrome).toContain(`--${prefix}-ink-rgb: var(--m-accent-rgb)`);
      expect(chrome).toContain(`--${prefix}-red: rgb(var(--m-accent-rgb))`);
    },
  );
  it('keeps the un-themed leaderboard red in sync with the token default', () => {
    // The un-themed cascade must equal DEFAULT_THEME.lbRed (pinned by
    // theme.tokens.test.ts). Once a theme is active, theme-chrome.scss and
    // applyTheme/prepaint (ACCENT_FOLLOWERS) move lbRed with the accent.
    const tokens = read('../src/css/theme-tokens.scss');
    const rootDefaults = [...tokens.matchAll(/(?:^|\n):root \{([^}]+)\}/g)]
      .map((rule) => rule[1] ?? '')
      .find((rule) => /--m-lbRed-rgb:/.test(rule));
    expect(rootDefaults).toContain('--m-lbRed-rgb: 255 0 0;');
    const chrome = read('../src/css/theme-chrome.scss');
    const themedSelector = chrome.split('These pages declare local brand aliases')[1]?.split('{')[0];
    expect(themedSelector).toContain("html[data-client-theme='on']");
    const lbRules = chrome.split('body .leaderboard-page')[1]?.split('}')[0] ?? '';
    expect(lbRules).toContain('--lb-red: rgb(var(--m-accent-rgb))');
  });
  it('themes ticket selection tints while retaining a distinct error background', () => {
    const style = parse(read('../src/components/tickets/TicketComposer.vue')).descriptor.styles[0]!.content;
    for (const selector of ['.ticket-type-card--on', '.ticket-locked-target', '.ticket-result--on']) {
      const rule = style.split(`${selector} {`)[1]?.split('}')[0];
      expect(rule).toContain('rgb(var(--m-accent-rgb) /');
    }
    expect(style.split('.ticket-error {')[1]?.split('}')[0]).toContain('rgba(255, 0, 0, 0.12)');
  });
});
