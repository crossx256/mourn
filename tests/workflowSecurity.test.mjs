// @ts-check
/**
 * Guards the public repository's CI surface.
 *
 * The public repo accepts pull requests from anyone, so two classes of mistake
 * become exploitable:
 *
 *   1. `pull_request_target` (or `workflow_run`) checks out fork-controlled code
 *      while holding repository secrets — the classic pwn vector.
 *   2. A job that runs on fork-reachable events (`pull_request`,
 *      `pull_request_target`, `issue_comment`, `workflow_run`) and *also*
 *      references secrets, which leaks them to a fork author.
 *
 * Both are refused here so they cannot be introduced by accident. Secrets are
 * only allowed on `push` / `workflow_dispatch` / `schedule` jobs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows');

/** Events whose payload/checkout can be influenced by someone who is not a maintainer. */
const FORK_REACHABLE = ['pull_request', 'pull_request_target', 'issue_comment', 'workflow_run'];

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ name: f, text: readFileSync(join(WORKFLOW_DIR, f), 'utf8') }));

test('the required frontend check audits every Bun lock and the Rust lock without exclusions', () => {
  const verify = readFileSync(join(WORKFLOW_DIR, 'verify.yml'), 'utf8');
  assert.match(verify, /^  frontend:\n/m);
  assert.match(verify, /^      - run: bash scripts\/audit-dependencies.sh all$/m);
  const audit = readFileSync('scripts/audit-dependencies.sh', 'utf8');
  assert.match(audit, /for dir in \. src-capacitor src-ssr;/);
  assert.match(audit, /cd "\$dir" && bun audit\)/);
  assert.match(audit, /lock="\$PWD\/src-tauri\/Cargo.lock"/);
  const fetch = audit.indexOf('git clone --quiet --depth 1 https://github.com/RustSec/advisory-db.git "$scratch/db"');
  const scan = audit.indexOf('cargo audit --db "$scratch/db" --no-fetch --file "$lock" --deny unsound --deny yanked');
  assert.ok(fetch >= 0 && scan > fetch, 'RustSec must scan a freshly fetched database');
  assert.doesNotMatch(audit, /--ignore|--audit-level|\|\| true/);
});

test('manual builds also gate their dependency locks before packaging', () => {
  for (const [file, mode, build] of [
    ['release.yml', 'desktop', 'Build and validate signed packages'],
    ['android.yml', 'mobile', 'Build web bundle and sync Capacitor'],
    ['web-release.yml', 'web', 'Build SSR bundle'],
  ]) {
    const workflow = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    const gate = workflow.indexOf(`run: bash scripts/audit-dependencies.sh ${mode}`);
    assert.ok(gate >= 0 && gate < workflow.indexOf(`name: ${build}`), file);
  }
});

test('no workflow uses pull_request_target', () => {
  const bad = workflows.filter((w) => /^\s*pull_request_target\s*:/m.test(w.text)).map((w) => w.name);
  assert.deepEqual(bad, [], `pull_request_target is forbidden (fork code + secrets): ${bad.join(', ')}`);
});

test('secret-bearing jobs never run on fork-reachable events', () => {
  const offenders = [];
  for (const { name, text } of workflows) {
    if (!/secrets\.[A-Z_]/i.test(text)) continue;
    for (const event of FORK_REACHABLE) {
      if (new RegExp(`^\\s*${event}\\s*:`, 'm').test(text)) {
        offenders.push(`${name} -> ${event}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `workflows referencing secrets must not trigger on fork-reachable events: ${offenders.join(', ')}`,
  );
});

test('every workflow declares an explicit permissions block', () => {
  const missing = workflows
    .filter((w) => !/^permissions\s*:/m.test(w.text))
    .map((w) => w.name);
  assert.deepEqual(missing, [], `workflows without an explicit permissions block: ${missing.join(', ')}`);
});

test('no workflow grants write access at the workflow level except release publishing', () => {
  const offenders = [];
  for (const { name, text } of workflows) {
    const workflowLevel = text.match(/^permissions\s*:\n((?:[ ]{2,}.*\n)+)/m);
    if (!workflowLevel) continue;
    if (/contents\s*:\s*write/.test(workflowLevel[1])) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    `workflow-level contents: write is too broad — scope write permissions to the single publishing job: ${offenders.join(', ')}`,
  );
});
