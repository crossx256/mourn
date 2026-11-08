import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifests = fs.readdirSync(path.join(root, 'flatpak')).filter(name => name.endsWith('.yml'));
assert.equal(manifests.length, 1, 'review exactly one application manifest');
const template = fs.readFileSync(path.join(root, 'flatpak', manifests[0]), 'utf8');
const applicationId = template.match(/^app-id: ([A-Za-z0-9_.-]+)$/m)?.[1];
assert.ok(applicationId, 'require an explicit application identity');

test('Flatpak runs the optimized GLib regression and ships its upstream notice', () => {
  const regression = 'cargo test --frozen --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --test glib_variant_iter';
  assert.ok(template.includes(regression), 'test the GLib backport in the actual offline build');
  assert.ok(template.indexOf(regression) > template.indexOf('quasar.js build -m spa'));
  assert.ok(template.indexOf(regression) < template.indexOf('cargo build --frozen'));
  assert.ok(template.includes(`install -Dm644 src-tauri/vendor/glib/LICENSE /app/share/licenses/${applicationId}/glib/LICENSE`));
});

test('native Linux releases retain the optimized GLib safety gate', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const step = workflow.match(/      - name: Verify optimized Linux GLib regression\n([\s\S]*?)(?=\n      -)/);
  assert.ok(step, 'do not rely on debug-mode tests for this optimizer-triggered defect');
  assert.ok(step[1].includes("if: runner.os == 'Linux'"));
  assert.ok(step[1].includes('cargo test --locked --release --target'));
  assert.ok(step[1].includes('--test glib_variant_iter'));
  assert.ok(workflow.indexOf(step[0]) > workflow.indexOf('run: bun run tauri:build-signed'));
  assert.ok(workflow.indexOf(step[0]) < workflow.indexOf('node scripts/generate_updater_manifest.js'));
});

test('the reviewed GLib tree is byte-pinned and protected from checkout conversion', async () => {
  const metadata = fs.readFileSync(path.join(root, 'src-tauri/vendor/glib.provenance.json'));
  const provenance = JSON.parse(metadata);
  const generator = fs.readFileSync(path.join(root, 'flatpak/prepare-sources.py'), 'utf8');
  const pinned = generator.match(/REVIEWED_GLIB_PROVENANCE_SHA256 = '([a-f0-9]{64})'/)[1];
  assert.equal(createHash('sha256').update(metadata).digest('hex'), pinned);
  const actual = {};
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name + '/');
      else {
        assert.ok(entry.isFile());
        actual[name] = createHash('sha256').update(fs.readFileSync(path.join(directory, entry.name))).digest('hex');
      }
    }
  }
  walk(path.join(root, 'src-tauri/vendor/glib'));
  assert.deepEqual(actual, provenance.files);
  const { execFileSync } = await import('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-vendor-bytes-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory, stdio: 'pipe' });
    fs.copyFileSync(path.join(root, '.gitattributes'), path.join(directory, '.gitattributes'));
    const result = execFileSync('git', ['check-attr', 'text', '--', 'src-tauri/vendor/glib/src/variant_iter.rs'], { cwd: directory, encoding: 'utf8' });
    assert.match(result, /: text: unset\r?\n$/, 'preserve the exact reviewed upstream bytes on Windows too');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
