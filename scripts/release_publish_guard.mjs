// Fetch the current remote tag before invoking this guard. Never trust an
// annotated tag object's ID: provenance records the peeled commit, not the tag.
import fs from 'node:fs';
import path from 'node:path';
import { command, regularFile, releaseIdentity, sha256 } from './release_safety.mjs';

const identity = releaseIdentity(process.env.RELEASE_TAG);
const commit = command('git', ['rev-parse', '--verify', `refs/tags/${identity.tag}^{commit}`]);
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid peeled release commit');
const context = { ...identity, commit, repository: process.env.GITHUB_REPOSITORY };
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository || '')) throw new Error('GITHUB_REPOSITORY required');
const draft = 'artifacts/draft-release';
const platforms = ['combined', 'windows-x86_64', 'linux-x86_64'];
const expected = platforms.map(platform => `release-index-${platform}.json`).sort();
const actual = fs.readdirSync(draft).filter(name => name.startsWith('release-index-')).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Missing or unexpected assembled provenance');
const indexes = new Map();
for (const platform of platforms) {
  const name = `release-index-${platform}.json`;
  const index = JSON.parse(fs.readFileSync(regularFile(path.join(draft, name)), 'utf8'));
  if (!index || typeof index !== 'object') throw new Error(`Invalid provenance: ${name}`);
  for (const [key, value] of Object.entries(context)) {
    if (index[key] !== value) throw new Error(`${name} has conflicting ${key}; release tag may have moved`);
  }
  if (index.platform !== platform || !Array.isArray(index.assets) || index.assets.length === 0) throw new Error(`Invalid provenance schema: ${name}`);
  const names = new Set();
  for (const asset of index.assets) {
    if (!asset || typeof asset.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+\-]*$/.test(asset.name)
        || asset.name === name || names.has(asset.name.toLowerCase()) || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) {
      throw new Error(`Invalid provenance asset: ${name}`);
    }
    names.add(asset.name.toLowerCase());
    if (sha256(path.join(draft, asset.name)) !== asset.sha256) throw new Error(`Provenance digest mismatch: ${asset.name}`);
  }
  indexes.set(platform, index);
}
// The combined index must bind every shard index and all its assets. Android is
// appended later and remains covered by the final SHA256SUMS publishing gate.
const combined = new Set(indexes.get('combined').assets.map(asset => asset.name));
for (const platform of platforms.slice(1)) {
  for (const name of [`release-index-${platform}.json`, ...indexes.get(platform).assets.map(asset => asset.name)]) {
    if (!combined.has(name)) throw new Error(`Combined provenance omits ${name}`);
  }
}
console.log(`Verified publishing tag ${identity.tag} at ${commit} against all assembled provenance`);
