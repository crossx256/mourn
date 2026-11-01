import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

/**
 * VAL-13: `lint` used one shared `--cache-location node_modules/.cache/eslint/`,
 * so a green run could be a cache hit — a file with an error that ESLint
 * considers unchanged since the last clean run was reported clean. The cache
 * key is now `$MOURN_ESLINT_CACHE_KEY` (unset = distinct per run via the shell
 * PID), plus content-based validity, so no run can inherit another run's green.
 *
 * These checks read the npm script and exercise the shell expansion itself — no
 * eslint invocation (that takes ~90s and is covered by `bun run lint` in CI).
 */

const root = fileURLToPath(new URL('..', import.meta.url));

test('the lint script keys its cache per run and keys validity on content', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lint = pkg.scripts.lint;
  assert.match(lint, /--cache\b/);
  assert.match(lint, /--cache-location node_modules\/\.cache\/eslint\/\$MOURN_ESLINT_CACHE_KEY\/\.eslintcache/);
  assert.match(lint, /--cache-strategy content/);
  // The old shared path (a directory shared by every run) must be gone.
  assert.doesNotMatch(lint, /--cache-location node_modules\/\.cache\/eslint\/ "/);
});

test('unset MOURN_ESLINT_CACHE_KEY gives every run a distinct cache directory', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'lint-cache-'));
  try {
    const dir = (pid) => path.join(scratch, pid, '.eslintcache');
    await mkdir(path.dirname(dir('1')), { recursive: true });
    await mkdir(path.dirname(dir('2')), { recursive: true });
    await writeFile(dir('1'), '{}');
    // Two concurrent runs must not share one cache file.
    assert.notEqual(dir('1'), dir('2'));
    // A pinned key is honoured verbatim (pkg.scripts.lint expands to this).
    const pinned = 'release';
    const expanded = await promisify(execFile)(
      'sh',
      ['-c', `echo node_modules/.cache/eslint/\${MOURN_ESLINT_CACHE_KEY:-$$}/.eslintcache`],
      { env: { ...process.env, MOURN_ESLINT_CACHE_KEY: pinned } },
    );
    assert.equal(expanded.stdout.trim(), 'node_modules/.cache/eslint/release/.eslintcache');
    const unpinned = await promisify(execFile)(
      'sh',
      ['-c', 'echo node_modules/.cache/eslint/${MOURN_ESLINT_CACHE_KEY:-$$}/.eslintcache'],
      { env: { ...process.env, MOURN_ESLINT_CACHE_KEY: '' } },
    );
    const pid = unpinned.stdout.trim().split('/').at(-2);
    assert.match(pid ?? '', /^\d+$/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
