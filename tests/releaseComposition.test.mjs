// The release pipeline must produce one release containing the signed desktop
// installers AND the signed Android APK, with a single approval at the
// `release-signing` environment. These assertions protect that composition:
// dropping the android job, or letting the publish job attach assets the
// checksum manifest does not cover, are both release-integrity failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');

const release = workflow('release');
const android = workflow('android');

test('the release workflow builds desktop and Android in one run', () => {
  assert.match(release, /^  android:$/m, 'release.yml has no android job');
  assert.match(release, /uses: \.\/\.github\/workflows\/android\.yml/);
  assert.match(release, /^    needs: \[build, android\]$/m, 'assemble must wait for both platforms');
});

test('the Android workflow can be called by the release workflow', () => {
  assert.match(android, /^  workflow_call:$/m, 'android.yml is not reusable');
  assert.match(android, /^      tag:$/m);
});

test('the assembled draft includes the APK and one combined checksum manifest', () => {
  assert.match(release, /name: mourn-android-apk/);
  assert.match(release, /run: node scripts\/assemble_android_into_release\.mjs/);
  const apkStep = release.indexOf('assemble_android_into_release.mjs');
  const publishStep = release.indexOf('action-gh-release');
  assert.ok(apkStep > 0 && apkStep < publishStep, 'the APK must be folded in before publishing');
});

test('publishing refuses assets the checksum manifest does not cover', () => {
  const publish = release.slice(release.indexOf('  publish:'));
  assert.match(publish, /SHA256SUMS/, 'publish step does not read the manifest');
  assert.match(publish, /does not match the files being published/);
  assert.match(publish, /fail_on_unmatched_files: true/);
});

test('the APK is never added as a Tauri updater target', () => {
  // Android has no updater; advertising one would make the desktop updater
  // offer an artifact it cannot install.
  const script = readFileSync(
    new URL('../scripts/assemble_android_into_release.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(script, /updater-manifest/, 'the APK must not touch the updater manifest');
  assert.doesNotMatch(script, /platforms\[/, 'the APK must not be registered as an updater target');
});
