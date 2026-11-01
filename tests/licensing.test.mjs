import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// SHA-256 of the exact bytes fetched from GNU's canonical agpl-3.0.txt.
const canonicalHash = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

test('LICENSE preserves the canonical GNU AGPLv3 bytes', () => {
  const bytes = readFileSync(new URL('../LICENSE', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), canonicalHash);
});

test('package and AppStream metadata agree on version 3 only', () => {
  assert.equal(JSON.parse(read('package.json')).license, 'AGPL-3.0-only');
  assert.match(read('src-tauri/Cargo.toml'), /^license = "AGPL-3\.0-only"$/m);
  const xml = read('flatpak/bio.mourn.desktop.metainfo.xml');
  assert.match(xml, /<project_license>AGPL-3\.0-only<\/project_license>/);
  assert.match(xml, /<developer id="bio\.mourn">\s*<name>Mourn Team<\/name>\s*<\/developer>/);
  assert.match(xml, /<metadata_license>CC0-1\.0<\/metadata_license>/);
});

test('unused GSAP is absent from the distribution dependency graph', () => {
  assert.equal(JSON.parse(read('package.json')).dependencies.gsap, undefined);
  for (const path of ['bun.lock', 'flatpak/node-sources.json', 'flatpak/node-layout.json']) {
    assert.doesNotMatch(read(path), /"gsap"|gsap-3\.15\.0/);
  }
});

test('notices preserve ownership limits and separate trademark rights', () => {
  assert.match(read('NOTICE.md'), /Copyright \(C\) Mourn Team/);
  assert.match(read('NOTICE.md'), /does not claim ownership of third-party work/);
  assert.match(read('TRADEMARKS.md'), /including through Flatpak/);
  assert.match(read('TRADEMARKS.md'), /does not add restrictions/);
  assert.match(read('THIRD_PARTY.md'), /ledger above remains required/);
  for (const contact of ['cross@mourn.bio', 'psycho@mourn.bio']) {
    assert.ok(read('SECURITY.md').includes(contact));
  }
});
