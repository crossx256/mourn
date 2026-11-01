import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileString } from 'sass';
import postcss, { type Rule } from 'postcss';

const source = () => readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
function rules() {
  const css = compileString(source(), {
    loadPaths: ['src/css'],
    silenceDeprecations: ['import'],
  }).css;
  const result: Rule[] = [];
  postcss.parse(css).walkRules((rule) => {
    result.push(rule);
  });
  return result;
}
const declaration = (rule: Rule, property: string) =>
  rule.nodes.find((n) => n.type === 'decl' && n.prop === property);

describe('opt-in theme surface cascade', () => {
  it('reveals the z0 backdrop only through named client surfaces, never by fading text', () => {
    const cssRules = rules();
    const containers = cssRules.find(
      (r) =>
        r.selector.includes('[data-backdrop-active]') && r.selector.includes('.dashboard-main'),
    );
    expect(containers, 'transparent client containers').toBeDefined();
    expect(containers!.selector).toMatch(/\.q-page[,)]/);
    expect(declaration(containers!, 'background')).toMatchObject({
      value: 'transparent',
      important: true,
    });
    const content = cssRules.find(
      (r) => r.selector.includes('[data-backdrop-active]') && r.selector.endsWith(' .q-layout'),
    );
    expect(declaration(content!, 'z-index')).toMatchObject({ value: '1' });
    for (const rule of cssRules.filter((r) => r.selector.includes('[data-backdrop-active]'))) {
      expect(declaration(rule, 'opacity')).toBeUndefined();
      expect(rule.selector).not.toContain('.profile');
      expect(rule.selector).not.toContain('.auth');
    }
  });
  it('uses body.theme-frosted with explicit opaque unsupported fallback', () => {
    const frost = rules().filter((r) => r.selector.includes('body.theme-frosted'));
    expect(frost.length).toBeGreaterThanOrEqual(3);
    expect(frost.every((r) => r.selector.includes('[data-client-theme=on]'))).toBe(true);
    const unsupported = frost.find(
      (r) => r.parent?.type === 'atrule' && r.parent.params.startsWith('not '),
    );
    expect(unsupported).toBeDefined();
    expect(declaration(unsupported!, 'background')).toMatchObject({
      value: 'rgb(var(--m-surface-rgb))',
      important: true,
    });
    expect(declaration(unsupported!, 'backdrop-filter')).toMatchObject({ value: 'none' });
    const supported = frost.find((r) => declaration(r, 'backdrop-filter') && r !== unsupported);
    expect(declaration(supported!, 'background')).toMatchObject({
      value: 'rgb(var(--m-surface-rgb)/0.88)',
      important: true,
    });
  });
  it('consumes derived slots only on nondefault client composers and normal local bubbles', () => {
    const cssRules = rules();
    for (const slot of ['input', 'send', 'bubble']) {
      for (const part of ['Bg', 'Text']) {
        const consumers = cssRules.filter((r) =>
          r.nodes.some((n) => n.type === 'decl' && n.value.includes(`var(--m-${slot}${part}-rgb)`)),
        );
        expect(consumers.length, `${slot}${part} consumers`).toBeGreaterThan(0);
        for (const r of consumers)
          expect(r.selector).toContain(':is(:not([data-theme=crimson]), [data-theme-accent])');
      }
    }
    const bubble = cssRules.find((r) => r.selector.includes('.vault-msg-bubble--sent'))!;
    expect(bubble.selector).toContain(':not(.vault-msg-bubble--unsafe)');
    expect(bubble.selector).toContain(':not(.vault-msg-bubble--failed)');
    expect(bubble.selector).not.toContain('--recv');
  });
});
