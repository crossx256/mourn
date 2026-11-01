// The Linux signed-build job must hand the reviewed LINUXDEPLOY_SHA256 to the step
// that runs the GStreamer bundling adapter (scripts/bundler-tools/mourn-gstreamer-bundle.sh
// exits 2 without it). A string appearing anywhere in the file is not enough: this
// test parses the workflow, resolves the environment the build step actually sees
// (job env + earlier steps' $GITHUB_ENV exports + the step's own env) and asserts
// the variable is there and is the reviewed digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const lines = source.split('\n');

const indent = (line) => line.length - line.trimStart().length;

// Steps of the `build` job: every list item under its `steps:` key.
function buildJobSteps() {
  const jobStart = lines.findIndex((line) => line === '  build:');
  assert.notEqual(jobStart, -1, 'build job not found');
  const stepsAt = lines.findIndex((line, i) => i > jobStart && /^ {4}steps:\s*$/.test(line));
  assert.notEqual(stepsAt, -1, 'build job has no steps:');
  const steps = [];
  let current = null;
  for (let i = stepsAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && indent(line) <= 4) break; // next key of the job
    if (/^ {6}- /.test(line)) {
      current = [line.slice(8)];
      steps.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return steps;
}

const steps = buildJobSteps();

test('every Quasar workflow installs the aliased Capacitor dependencies before prepare', () => {
  for (const name of ['release', 'verify', 'web-release', 'android']) {
    const workflow = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    const install = workflow.search(/working-directory: src-capacitor\r?\n\s+run: bun install --frozen-lockfile --ignore-scripts/);
    const prepare = workflow.indexOf('node node_modules/@quasar/app-vite/bin/quasar.js prepare');
    assert.ok(install !== -1 && install < prepare,
      `${name}: Quasar aliases Capacitor dependencies in every mode; install the locked shell tree before prepare`);
  }
});

// A step is a list of fields; blocks (env:, run: |) keep their deeper lines.
function fieldsOf(step) {
  const fields = [];
  // Fields of a step sit one indent level under the "- " dash (an indented block
  // sequence keeps the dash on its own column), so take the column of the first
  // indented "key:" line after the dash line.
  const keyIndent = indent(step.find((line, index) => index > 0 && /^\s+[A-Za-z_][\w-]*:/.test(line)) || step[0]);
  let currentField = null;
  for (const line of step) {
    if (!line.trim()) continue;
    if (line === step[0] || indent(line) === keyIndent) {
      const match = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line.trim());
      currentField = match ? { key: match[1], inline: match[2], block: [] } : null;
      if (currentField) fields.push(currentField);
      continue;
    }
    if (currentField) currentField.block.push(line);
  }
  return fields;
}

const field = (step, key) => fieldsOf(step).find((f) => f.key === key);
const command = (step) => {
  const run = field(step, 'run');
  if (!run) return '';
  return run.inline && run.inline !== '|' && run.inline !== '>' ? run.inline : run.block.map((l) => l.trim()).join('\n');
};
const envOf = (step) => {
  const env = {};
  for (const line of (field(step, 'env') || { block: [] }).block) {
    const match = /^\s*([A-Za-z_][\w]*):\s?(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
};
/** Values exported with `echo NAME=value >> $GITHUB_ENV` by steps before `index`. */
const exportedTo = (list, index) => {
  const exported = {};
  for (const step of list.slice(0, index)) {
    for (const match of command(step).matchAll(/^\s*echo\s+"?([A-Z_][\w]*)=(.*?)"?\s*>>\s*"?\$\{?GITHUB_ENV\}?"?\s*$/gm)) {
      exported[match[1]] = match[2];
    }
  }
  return exported;
};

const buildIndex = steps.findIndex((step) => /tauri:build-signed|build_collect_signatures/.test(command(step)));
const prerequisiteIndex = steps.findIndex((step) => /pin_linuxdeploy_for_bundling\.sh/.test(command(step)));
const digestIndex = steps.findIndex((step) => /linuxdeploy\.sha256|inputs\.linuxdeploy_sha256/.test(command(step)));

test('the workflow has the linuxdeploy prerequisite and the signed build, in that order', () => {
  assert.notEqual(prerequisiteIndex, -1, 'no step verifies/pins the reviewed linuxdeploy input');
  assert.notEqual(buildIndex, -1, 'no signed-build step in the build job');
  assert.ok(prerequisiteIndex < buildIndex, 'the linuxdeploy prerequisite must run before the build');
});

test('the digest is resolved before the prerequisite runs, from the input or the pinned file', () => {
  assert.notEqual(digestIndex, -1, 'no step resolves the reviewed linuxdeploy digest');
  assert.ok(digestIndex < prerequisiteIndex, 'the digest must be resolved before pin_linuxdeploy runs');
  const body = command(steps[digestIndex]);
  // An operator-supplied digest wins; otherwise the reviewed value committed in
  // the repository is used. Both paths must end in a full 64-character SHA-256.
  assert.match(body, /inputs\.linuxdeploy_sha256/, 'the dispatch input must be honoured');
  assert.match(body, /scripts\/linuxdeploy\.sha256/, 'the pinned digest file must be the fallback');
  assert.match(body, /\^\[0-9a-fA-F\]\{64\}\$/, 'the resolved value must be validated as a SHA-256');
});

test('the pinned digest file contains exactly one reviewed SHA-256', () => {
  const file = readFileSync(new URL('../scripts/linuxdeploy.sha256', import.meta.url), 'utf8');
  const digests = file.split('\n').map((line) => line.trim()).filter((line) => /^[0-9a-fA-F]{64}$/.test(line));
  assert.equal(digests.length, 1, `expected one pinned digest, found ${digests.length}`);
});

test('the signed-build step actually receives LINUXDEPLOY_SHA256', () => {
  // Everything earlier steps exported with `echo NAME=value >> $GITHUB_ENV`.
  const exported = {};
  for (const step of steps.slice(0, buildIndex)) {
    for (const match of command(step).matchAll(/^\s*echo\s+"?([A-Z_][\w]*)=(.*?)"?\s*>>\s*"?\$\{?GITHUB_ENV\}?"?\s*$/gm)) {
      exported[match[1]] = match[2];
    }
  }
  const own = envOf(steps[buildIndex]);
  const value = own.LINUXDEPLOY_SHA256 ?? exported.LINUXDEPLOY_SHA256;

  assert.ok(value, 'the signed-build step does not receive LINUXDEPLOY_SHA256 (env of that step: ' +
    `${Object.keys(own).join(', ') || 'none'}${Object.keys(exported).length ? `; exported: ${Object.keys(exported).join(', ')}` : ''})`);
  assert.match(String(value), /digest/,
    `the build step must carry the resolved digest, not "${value}"`);
});

test('no step that runs the bundler is left without the digest', () => {
  steps.forEach((step, index) => {
    if (!/tauri:build-signed|build_collect_signatures/.test(command(step))) return;
    const own = envOf(steps[index]);
    const value = own.LINUXDEPLOY_SHA256 ?? exportedTo(steps, index).LINUXDEPLOY_SHA256;
    assert.ok(value, `step ${index + 1} runs the signed build without LINUXDEPLOY_SHA256 in its env or $GITHUB_ENV`);
  });
});
