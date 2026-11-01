import { describe, expect, it } from 'vitest';
import { renderArchiveMarkdown } from '../src/utils/archiveMarkdown';

/**
 * H1: ArchiveShowPage renders server-authored markdown through v-html. The old
 * string-pipeline accepted `[x](javascript:…)`, `![x](data:…)` and raw `<img>`
 * from the source, so a compromised or careless archive could run script or make
 * every reader load a remote pixel — directly contradicting the comment that
 * promises "no remote archive images". Visible text containing `$1` / `$&` was
 * also eaten by String.replace.
 *
 * These tests drive the real renderer used by the page.
 */
const render = renderArchiveMarkdown;

describe('archive markdown is sanitised before it reaches v-html', () => {
  it.each([
    ['javascript: link', '[click](javascript:alert(1))'],
    ['mixed-case javascript: link', '[click](JaVaScRiPt:alert(1))'],
    ['tab-obfuscated javascript: link', '[click](java\tscript:alert(1))'],
    ['javascript: autolink', '<javascript:alert(1)>'],
    ['vbscript: link', '[click](vbscript:msgbox(1))'],
    ['data:text/html link', '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ])('neutralises a %s', (_label, markdown) => {
    const html = render(markdown);
    // A refused target may survive as inert text; what must never survive is an
    // attribute or element a browser would act on.
    expect(html).not.toMatch(/<a\b[^>]*(javascript|vbscript|data:text\/html):/i);
    expect(html).not.toMatch(/<a\b[^>]*\shref=/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<\w+\b[^>]*\son[a-z]+\s*=/i);
  });

  it('never emits inline media, including data: image payloads', () => {
    const html = render('![diagram](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/data:image/i);
  });

  it('does not load remote images: a markdown image becomes an explicit link', () => {
    const html = render('![chart](https://cdn.example.invalid/chart.png)');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('href="https://cdn.example.invalid/chart.png"');
    expect(html).toContain('remote image: chart');
  });

  it('drops raw HTML from the archive source, including embedded <img>', () => {
    const html = render(
      'before <img src="https://attacker.invalid/track.gif"> after\n\n<script>alert(1)</script>\n\n<iframe src="https://attacker.invalid/"></iframe>',
    );
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('attacker.invalid/track.gif');
  });

  it('keeps $1, $& and $` literals in visible text intact', () => {
    const html = render('cost is $1 and $& and done');
    expect(html).toContain('$1');
    expect(html).toContain('$&');
  });

  it('preserves the literals inside link text and code spans', () => {
    const html = render('see [replacement $1](https://example.invalid/x) and `$&`');
    expect(html).toContain('replacement $1');
    expect(html).toContain('$&amp;');
  });

  it('leaves a bare javascript: mention as inert text', () => {
    // Typing the scheme in prose is not an attack and must stay readable; the
    // test above covers the case where a browser could act on it.
    const html = render('never run javascript:alert(document.cookie) from a link');
    expect(html).not.toMatch(/<a[^>]+javascript:/i);
    expect(html).toContain('javascript:alert(document.cookie)');
  });

  it('still renders the supported markdown features', () => {
    const html = render(
      ['# Title', '', '- one', '- two', '', '**bold** and *italic*', '', '> quoted', '', '```js', 'const a = 1 < 2;', '```'].join('\n'),
    );
    expect(html).toContain('<h1 class="archive-h">Title</h1>');
    expect(html).toContain('<li class="archive-li">one</li>');
    expect(html).toContain('<ul class="archive-ul">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<blockquote class="archive-blockquote">');
    expect(html).toContain('<pre class="archive-codeblock">');
    expect(html).toContain('const a = 1 &lt; 2;');
  });

  it('escapes HTML metacharacters typed as text', () => {
    const html = render('a < b && c > d');
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
  });

  it('adds rel="noopener noreferrer" to every external link it emits', () => {
    const html = render('[a](https://example.invalid/a)');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('survives malformed input without throwing', () => {
    for (const input of ['', '[', '![', '`', '```js', '<', '[](']) {
      expect(() => render(input)).not.toThrow();
    }
  });
});
