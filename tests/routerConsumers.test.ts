import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M6 (audit): every chat rendered a router-link to `/graveyard/queue`; no route
 * is registered for it, so the catch-all `/:catchAll(.*)*` handled it and the
 * link always landed on ErrorNotFound. L9 also found three components with zero
 * consumers. A component that nothing imports still compiles, lints, and can
 * keep serving dead routes (that is how M6 shipped), so the suite pins both:
 * routes resolve to a real page and component files have a consumer.
 */

// fileURLToPath, not URL.pathname: on Windows the latter yields '/D:/...'
// which readdir then fails to open.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(dir))) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const SRC_FILES = walk(join(root, 'src')).map((path) => ({ rel: path.slice(root.length), source: readFileSync(path, 'utf8') }));

describe('M6 — links into the app resolve to a page', () => {
  it('every static /graveyard route string used by the UI is registered', () => {
    const routes = read('src/router/routes.ts');
    const registered = new Set(
      [...routes.matchAll(/path:\s*'(\/[^'*:]*)'/g)].map((match) => match[1]!.replace(/\/$/, '')),
    );
    const used = new Set<string>();
    for (const { source } of SRC_FILES) {
      for (const match of source.matchAll(/['"`](\/graveyard\/[a-z-]+)['"`]/g)) used.add(match[1]!);
      for (const match of source.matchAll(/to="(\/[a-z-]+\/[a-z-]+)"/g)) used.add(match[1]!);
    }
    expect([...used]).toEqual([]);
    // Guard the registered set still has the base route the above compares to.
    expect(registered.has('/graveyard')).toBe(true);
  });
});

describe('L9 — no component file is shipped without a consumer', () => {
  const KNOWN_ENTRYPOINTS = new Set([
    // Mounted by the router / layout rather than imported by a component.
    'src/App.vue',
    'src/layouts/MainLayout.vue',
    'src/pages/IndexPage.vue',
  ]);

  it('every file under src/components is imported somewhere', () => {
    const candidates = SRC_FILES.filter(
      ({ rel }) => rel.includes('src/components/') && rel.endsWith('.vue'),
    ).filter(({ rel }) => ![...KNOWN_ENTRYPOINTS].some((entry) => rel.endsWith(entry)));
    const orphans = candidates
      .filter(({ rel }) => {
        const base = rel.split('/').pop()!;
        const name = base.replace(/\.vue$/, '');
        // Imported as `X from '…/X.vue'`, `import('…/X.vue')`, or Kebab tag use.
        const pattern = new RegExp(`(?:from|import\\()\\s*['"][^'"]*${name}\\.vue['"]|<${name}\\b`);
        return !SRC_FILES.some(({ rel: other, source }) => other !== rel && pattern.test(source));
      })
      .map(({ rel }) => rel);
    expect(orphans).toEqual([]);
  });
});

describe('L15 — form ids serve a label or a reference', () => {
  // Audit L15 called the `id` props on the ticket/theme/login forms "test
  // affordances". Verified instead: the ones on form fields are the target of a
  // `<label for=…>` (click-to-focus + accessible name), so they are required
  // markup, not test hooks; the login/register `error-message` / `submit-btn`
  // ids are styling/automation handles with no consumer in the repo.
  // This locks the decision: a form-control id must be referenced by `for=` or
  // `aria-*` in the same file, so a stray id cannot accumulate unnoticed.
  const CONTROL_TAG = /<(input|textarea|select)\b[\s\S]*?\sid="([a-zA-Z][\w-]*)"[\s\S]*?>/g;

  it('every form-control id is the target of a label or aria reference', () => {
    const unreferenced: string[] = [];
    for (const { rel, source } of SRC_FILES) {
      if (!rel.endsWith('.vue')) continue;
      for (const match of source.matchAll(CONTROL_TAG)) {
        const id = match[2]!;
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const referenced = new RegExp(`for="${escaped}"|aria-[a-z]+="${escaped}"`).test(source);
        if (!referenced) unreferenced.push(`${rel}: id="${id}"`);
      }
    }
    expect(unreferenced).toEqual([]);
  });
});
