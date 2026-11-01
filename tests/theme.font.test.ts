import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileString } from 'sass';
import postcss from 'postcss';

const upstream = {
  'OpenDyslexic-Regular.woff2': '4ee220be7e9b551ad100468bd08ba35f6f9fe2f8',
  'OpenDyslexic-Bold.woff2': 'b5fd5e4f4b0977495d39bb3220096aef50120e31',
  'OpenDyslexic-Italic.woff2': '9b78966bb5d2b8dbd89a875e16f4900e53160bb6',
  'OpenDyslexic-Bold-Italic.woff2': '9e8a5f80f170b3de9df4bf5049624b67d81483f1',
  'OFL.txt': 'bb867823f2408fb8d2b3af5cb118b4bc0cd61972',
};
describe('locally bundled OpenDyslexic', () => {
  it('adds opt-in readable spacing without changing the monospace cascade', () => {
    const source = readFileSync(new URL('../src/css/theme-font.scss', import.meta.url), 'utf8');
    const ast = postcss.parse(compileString(source).css);
    let spacingRules = 0;
    ast.walkRules((rule) => {
      const declarations = rule.nodes.filter((node) => node.type === 'decl');
      if (!declarations.some((node) => node.prop === 'letter-spacing')) return;
      spacingRules++;
      expect(rule.selector).toContain('[data-client-theme=on][data-font=opendyslexic]');
      expect(declarations).toEqual(expect.arrayContaining([
        expect.objectContaining({ prop: 'letter-spacing', value: '0.02em' }),
        expect.objectContaining({ prop: 'line-height', value: '1.6' }),
      ]));
    });
    expect(spacingRules).toBeGreaterThan(0);
  });
  it('ships unmodified upstream WOFF2 faces with the verified upstream OFL license', () => {
    for (const [file, sha] of Object.entries(upstream)) {
      const data = readFileSync(new URL(`../public/fonts/opendyslexic/${file}`, import.meta.url));
      expect(createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')).toBe(
        sha,
      );
      if (file.endsWith('.woff2')) expect(data.subarray(0, 4).toString()).toBe('wOF2');
      else {
        expect(data.toString()).toContain('SIL OPEN FONT LICENSE Version 1.1');
        expect(data.toString()).toContain('Abbie Gonzalez');
      }
    }
  });
  it('registers four local faces and opts in only to client text, excluding icon/code glyphs', () => {
    const source = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
    const ast = postcss.parse(
      compileString(source, { loadPaths: ['src/css'], silenceDeprecations: ['import'] }).css,
    );
    const faces: string[] = [];
    ast.walkAtRules('font-face', (rule) => {
      faces.push(rule.toString());
    });
    expect(faces).toHaveLength(4);
    for (const face of faces) {
      expect(face).toContain('/fonts/opendyslexic/');
      expect(face).toContain('font-display: swap');
      expect(face).not.toMatch(/https?:|local\(/);
    }
    let consumers = 0;
    ast.walkRules((rule) => {
      if (
        !rule.nodes.some(
          (n) => n.type === 'decl' && n.prop === 'font-family' && n.value.includes('OpenDyslexic'),
        )
      )
        return;
      consumers++;
      expect(rule.selector).toContain('[data-client-theme=on][data-font=opendyslexic]');
      expect(rule.selector).toContain('.q-icon');
      expect(rule.selector).toContain('code');
    });
    expect(consumers).toBeGreaterThan(0);
  });
});
