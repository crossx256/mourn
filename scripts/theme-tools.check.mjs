import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audit, literals } from './theme-audit.mjs';
import { growth } from './theme-guard.mjs';
import { sweep, tokenMap } from './theme-sweep.mjs';

test('extract hex, alpha and RGB literals, not comments or partial hex', () => {
  assert.equal(literals('/* #fff */ <!-- #abc --> #123 #1234 #123456 #12345678 rgb(1, 2, 3) rgba(1,2,3,.5) #1234567 #abcdefgh').length, 6);
});

test('guard detects appended Vue literal, same-count substitution and new file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'theme-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    const file = path.join(root, 'src/A.vue');
    await writeFile(file, '<style>p { color:#fff }</style>');
    const baseline = await audit(root, { entries: [] });
    await writeFile(file, '<style>p { color:#fff; background:#ff0000 }</style>');
    assert.ok(growth(await audit(root, { entries: [] }), baseline).length);
    await writeFile(file, '<style>p { color:#abc }</style>');
    assert.ok(growth(await audit(root, { entries: [] }), baseline).length);
    await writeFile(file, '<style>p { color:#fff }</style>');
    assert.deepEqual(growth(await audit(root, { entries: [] }), baseline), []);
    await writeFile(path.join(root, 'src/B.css'), 'p {color:rgb(1,2,3)}');
    assert.ok(growth(await audit(root, { entries: [] }), baseline).length);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('allowlist exclusions and bounded exception cannot hide growth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'theme-test-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/a.css'), 'a{color:#fff;background:#fff}');
    const a = await audit(root, { entries: [{ file: 'src/a.css', literal: '#fff', max: 1 }] });
    assert.equal(a.total, 1);
    assert.equal((await audit(root, { entries: [{ file: 'src/a.css', exclude: true }] })).total, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sweep changes only safe unique declarations; excludes profile and inline/script/comments', () => {
  const tokens = tokenMap("warning: '#ffaa00', bg: '#000000', onAccent: '#000000'");
  const source = '<template><div style="color:#ffaa00" /></template>\n<script>const x = "#ffaa00"</script>\n<style>\ncolor: #ffaa00;\ncolor: #000;\n/* color: #ffaa00; */\nbackground: url(#ffaa00);\n</style>';
  const result = sweep(source, 'src/Test.vue', tokens);
  assert.equal(result.changes.length, 1);
  assert.match(result.source, /color: rgb\(var\(--m-warning-rgb\)\);/);
  assert.equal(sweep(source, 'src/css/profile.scss', tokens).source, source);
  assert.equal(sweep(result.source, 'src/Test.vue', tokens).changes.length, 0);
});
