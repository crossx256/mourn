import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@vue/compiler-sfc';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
describe('client accent coverage', () => {
  it('themes menu dividers, notification sweeps and nav hover glows at their source', () => {
    const css = read('../src/css/mainlayout.scss');
    expect(css).not.toMatch(/rgba?\(255,\s*0,\s*0[,)]/);
    expect(css.split('.mobile-menu-separator {')[1]?.split('}')[0]).toContain('rgb(var(--m-accent-rgb');
  });
  it('themes announcement and landing animation ink, not just their labels', () => {
    for (const path of ['../src/components/NoticeCard.vue', '../src/pages/IndexPage.vue', '../src/components/PageConstruct.vue', '../src/components/UserCountDisplay.vue']) {
      const styles = parse(read(path)).descriptor.styles.map((s) => s.content).join('\n');
      expect(styles).not.toMatch(/rgba?\(255,\s*0,\s*0[,)]/);
      expect(styles).toContain('rgb(var(--m-accent-rgb');
    }
  });
  it('themes shared landing decorations and ranks by palette emphasis, not fixed medal colors', () => {
    const css = read('../src/css/landingPage.scss');
    expect(css).not.toMatch(/rgba?\(255,\s*0,\s*0[,)]/);
    // Superseded design: ranks 1-3 were gold/silver/bronze (#ffd700/#c0c0c0/#cd7f32),
    // which stayed off-palette under every non-crimson preset. They now rank by
    // accent emphasis (full / 0.8 / 0.65 + glow), so a fixed medal literal coming
    // back is a regression, not an improvement.
    expect(css).not.toMatch(/#(ffd700|c0c0c0|cd7f32)\b/i);
    for (const rank of ['1', '2', '3']) {
      const rule = css.split(`.MPleaderboard-rank[data-rank='${rank}'] {`)[1]?.split('}')[0];
      expect(rule, `rank ${rank} rule`).toBeDefined();
      expect(rule).toContain('rgb(var(--m-accent-rgb');
    }
    expect(css.split(".MPleaderboard-rank[data-rank='1'] {")[1]?.split('}')[0]).toContain(
      'font-weight: 700',
    );
    expect(css.split(".MPleaderboard-rank[data-rank='3'] {")[1]?.split('}')[0]).toContain(
      '/ 0.65',
    );
  });
  it('lets every contribution button use the active primary color', () => {
    const template = parse(read('../src/layouts/MainLayout.vue')).descriptor.template!.content;
    const buttons = [...template.matchAll(/<q-btn\b[^>]*label="\[ contribute \]"[^>]*>/g)];
    expect(buttons).toHaveLength(3);
    for (const [button] of buttons) {
      expect(button).toContain('color="primary"');
      expect(button).not.toMatch(/style="[^"]*#ff0000/);
    }
  });
  it('applies chat text sizing to both direct and group message renderers', () => {
    const css = read('../src/css/theme-tokens.scss');
    for (const size of ['sm', 'lg']) {
      const rule = css.split(`[data-chat-size='${size}']`)[1]?.split('}')[0];
      expect(rule).toContain('.vault-msg-text');
      expect(rule).toContain('.group-message-text');
    }
  });
  it('wires scoped chrome surface colors without hiding active backdrops', () => {
    const css = read('../src/css/theme-tokens.scss');
    expect(css).toContain("@import './theme-chrome.scss'");
    const chrome = read('../src/css/theme-chrome.scss');
    expect(chrome).toContain("html[data-client-theme='on']");
    expect(chrome).toContain(":not([data-backdrop-active])");
    for (const selector of ['.header', '.mobile-bottom-nav', '.q-drawer.global-drawer', '::-webkit-scrollbar-thumb'])
      expect(chrome).toContain(selector);
  });
  it('lets the inline brand mark inherit the active client accent', () => {
    const { descriptor } = parse(read('../src/components/icons/MournLogoInline.vue'));
    expect(descriptor.template?.content).not.toMatch(/style=["'][^"']*#[0-9a-f]/i);
    expect(descriptor.styles.map((s) => s.content).join('\n')).toContain('color: var(--primary');
  });
  it('does not use density to add padding inside Quasar floating-label controls', () => {
    const css = read('../src/css/theme-tokens.scss');
    const density = css.split("html[data-client-theme='on']:not([data-density='comfortable'])")[1]?.split("html[data-client-theme='on'][data-chat-size")[0];
    expect(density).toBeDefined();
    expect(density).not.toContain('.q-field__control');
  });
});
