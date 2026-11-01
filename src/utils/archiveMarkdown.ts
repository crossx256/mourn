import { Marked, Renderer, type Token, type Tokens } from 'marked';

/**
 * Renderer for server-authored archive bodies (ArchiveShowPage).
 *
 * Archive content is editorial markdown that a moderator writes, but it still
 * lands in `v-html`, so it must never carry executable URLs or inline media. The
 * previous hand-rolled String.replace pipeline let `[...](javascript:…)`,
 * `![...](data:…)` and raw `<img src>` through, and ate `$1`/`$&` out of visible
 * text — which also contradicted the promise that reading an archive never loads
 * a remote image.
 *
 * Three independent layers, in order:
 *   1. raw HTML in the source is never parsed as HTML (only its text survives);
 *   2. link hrefs are checked against an explicit scheme allowlist, images become
 *      explicit links, and every emitted anchor gets rel="noopener noreferrer";
 *   3. DOMPurify runs an allowlist pass when a DOM is available (the app), and the
 *      already-safe markup is returned unchanged where it is not (SSR/tests).
 */

/** Schemes a link may use. Everything else (javascript:, vbscript:, data:, file:) is refused. */
export const SAFE_LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const;
/** Only markdown features the archive CSS styles. */
export const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'hr',
] as const;
export const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'class'] as const;

/**
 * True when `href` is safe to place in an anchor. Browsers ignore leading C0
 * controls and tabs/newlines inside the scheme, so they are stripped before the
 * check: `java\tscript:` must be refused just like `javascript:`.
 */
export function isSafeLinkHref(href: string): boolean {
  // eslint-disable-next-line no-control-regex
  const normalised = href.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (!normalised) return false;
  // Relative URLs and fragments cannot carry an external scheme.
  if (/^[#/?]/.test(normalised)) return true;
  const scheme = normalised.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
  if (!scheme) return true; // e.g. "example.invalid/path" — no scheme, resolves relatively
  return (SAFE_LINK_SCHEMES as readonly string[]).includes(`${scheme}:`);
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = (value: string) => escapeHtml(value).replace(/`/g, '&#96;');

function safeHref(href: string): string | null {
  if (!isSafeLinkHref(href)) return null;
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

/**
 * Archive markup is styled by ArchiveShowPage's scoped CSS, which targets
 * `.archive-*` classes. Emit those classes here so the page never needs global
 * `:deep` selectors and heading/quote/list/code styling survives the sanitiser.
 */
const renderer = new Renderer();
renderer.heading = function ({ tokens, depth }) {
  const tag = `h${Math.min(6, Math.max(1, depth))}`;
  return `<${tag} class="archive-h">${this.parser.parseInline(tokens)}</${tag}>`;
};
renderer.paragraph = function (token) {
  return `<p class="archive-p">${this.parser.parseInline(token.tokens)}</p>`;
};
renderer.blockquote = function ({ tokens }) {
  return `<blockquote class="archive-blockquote">${this.parser.parse(tokens)}</blockquote>`;
};
renderer.list = function ({ items, ordered, start }) {
  const tag = ordered ? 'ol' : 'ul';
  const open = ordered && start && start !== 1 ? `<${tag} class="archive-ol" start="${start}">` : `<${tag} class="archive-ul">`;
  const body = items
    .map((item) => `<li class="archive-li">${this.parser.parse(item.tokens)}</li>`)
    .join('\n');
  return `${open}${body}</${tag}>`;
};
renderer.code = function ({ text, lang }) {
  return `<pre class="archive-codeblock"><code${lang ? ` class="language-${escapeAttr(lang)}"` : ''}>${escapeHtml(text)}</code></pre>`;
};
renderer.codespan = function ({ text }) {
  return `<code class="archive-inline-code">${escapeHtml(text)}</code>`;
};
renderer.hr = function () {
  return '<hr class="archive-hr">';
};
renderer.link = function ({ href, title, tokens }) {
  const safe = safeHref(href);
  const label = this.parser.parseInline(tokens);
  if (!safe) return label;
  return `<a href="${escapeAttr(safe)}"${title ? ` title="${escapeAttr(title)}"` : ''} target="_blank" rel="noopener noreferrer" class="archive-link">${label}</a>`;
};

const marked = new Marked({ gfm: true, breaks: true, renderer });

/**
 * Replace (in place) every token tree that could emit unsafe markup. `renderer`
 * is used to keep link/image text rendered while re-writing the dangerous bits.
 */
function hardenTokens(tokens: Token[]): Token[] {
  for (const token of tokens) {
    const holder = token as Token & { tokens?: Token[] };
    switch (token.type) {
      case 'html':
        // Raw HTML is dropped entirely — a text node cannot introduce elements.
        token.type = 'text';
        (token as Tokens.Text).text = '';
        break;
      case 'image': {
        const image = token as Tokens.Image;
        const href = safeHref(image.href);
        token.type = 'html';
        (token as Tokens.HTML).text = href
          ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" class="archive-link">remote image: ${
              escapeHtml(image.text || image.href)
            }</a>`
          : `remote image: ${escapeHtml(image.text || '')}`;
        break;
      }
      case 'link': {
        const link = token as Tokens.Link;
        const href = safeHref(link.href);
        if (!href) {
          // Keep the label, drop the URL: a refused target is still readable.
          (link as unknown as { type: string }).type = 'text';
          (token as unknown as { tokens: Token[] }).tokens = link.tokens ?? [
            { type: 'text', raw: link.text, text: link.text },
          ];
        }
        break;
      }
      default:
        break;
    }
    if (holder.tokens) hardenTokens(holder.tokens);
  }
  return tokens;
}

let purifier: { sanitize: (html: string, config?: unknown) => string } | null | undefined;

/**
 * DOMPurify only exposes sanitize() when a DOM is present. In the app it is; in
 * SSR/tests it is not, and layers 1-2 have already removed everything dangerous.
 */
function domPurifier() {
  if (purifier !== undefined) return purifier;
  try {
    // Loaded lazily so SSR/test runs without a DOM never touch it.
    const dompurify = (globalThis as { DOMPurify?: unknown }).DOMPurify;
    purifier = dompurify && typeof (dompurify as { sanitize?: unknown }).sanitize === 'function'
      ? (dompurify as { sanitize: (html: string, config?: unknown) => string })
      : null;
  } catch {
    purifier = null;
  }
  return purifier;
}

/** Test seam: the page installs window.DOMPurify, so the sanitiser is the real one. */
export function __setDomPurifier(next: { sanitize: (html: string, config?: unknown) => string } | null) {
  purifier = next;
}

export function renderArchiveMarkdown(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return '';
  const tokens = hardenTokens(marked.lexer(markdown));
  let html = marked.parser(tokens);
  const sanitize = domPurifier()?.sanitize;
  if (sanitize) {
    html = sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTR],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['img', 'script', 'style', 'iframe'],
    });
  }
  // Every emitted anchor is external editorial content; make that explicit even
  // if a future renderer change forgets it.
  return html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
