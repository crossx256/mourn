import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageAtomic } from '../scripts/release_safety.mjs';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflow = fs.readFileSync(path.join(repository, '.github/workflows/release.yml'), 'utf8');
const publish = workflow.slice(workflow.indexOf('\n  publish:'));
const guard = publish.match(/- name: Refuse to publish from a non-default branch or a tag that moved\n(?:        env:\n(?:          .*\n)+)?        run: \|\n([\s\S]*?)(?=      - )/)[1].replace(/^          /gm, '');
const identity = { tag: 'v1.5.4', version: '1.5.4', repository: 'crossx256/mourn', prerelease: false };

function fixture(t, annotated = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin');
  const cwd = path.join(root, 'publish');
  fs.mkdirSync(origin); fs.mkdirSync(cwd);
  function git(dir, args, input) {
    const result = spawnSync('git', args, { cwd: dir, input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(origin, ['init', '-q', '--object-format=sha1']);
  const tree = git(origin, ['hash-object', '-w', '-t', 'tree', '--stdin'], '');
  const actor = 'crossx256 <272340710+crossx256@users.noreply.github.com> 1 +0000';
  const commit = message => git(origin, ['hash-object', '-w', '-t', 'commit', '--stdin'], `tree ${tree}\nauthor ${actor}\ncommitter ${actor}\n\n${message}\n`);
  const selected = commit('selected fixture');
  const other = commit('other fixture');
  const setTag = target => {
    const object = annotated ? git(origin, ['hash-object', '-w', '-t', 'tag', '--stdin'], `object ${target}\ntype commit\ntag ${identity.tag}\ntagger ${actor}\n\nfixture tag\n`) : target;
    git(origin, ['update-ref', `refs/tags/${identity.tag}`, object]);
  };
  setTag(selected);
  git(cwd, ['init', '-q']);
  git(cwd, ['remote', 'add', 'origin', origin]);
  fs.mkdirSync(path.join(cwd, 'scripts'));
  for (const name of ['release_publish_guard.mjs', 'release_safety.mjs', 'minisign_verify.mjs']) {
    const source = path.join(repository, 'scripts', name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(cwd, 'scripts', name));
  }
  const draft = path.join(cwd, 'artifacts/draft-release');
  const files = [];
  for (const platform of ['windows-x86_64', 'linux-x86_64']) {
    const asset = path.join(root, `${platform}.txt`);
    fs.writeFileSync(asset, 'local provenance fixture');
    const shard = path.join(root, platform);
    stageAtomic(shard, [asset], { ...identity, commit: selected }, platform);
    files.push(...fs.readdirSync(shard).map(name => path.join(shard, name)));
  }
  stageAtomic(draft, files, { ...identity, commit: selected }, 'combined');
  const run = (overrides = {}) => {
    const env = { ...process.env, RELEASE_TAG: identity.tag, GITHUB_REPOSITORY: identity.repository,
      GITHUB_REF: 'refs/heads/reviewed-default', GITHUB_SERVER_URL: root, ...overrides };
    delete env.GITHUB_EVENT_REPOSITORY_DEFAULT_BRANCH;
    // Resolve only the explicit workflow context binding, never a guessed branch.
    if (/RELEASE_DEFAULT_BRANCH: \$\{\{ github.event.repository.default_branch \}\}/.test(publish)) env.RELEASE_DEFAULT_BRANCH = 'reviewed-default';
    return spawnSync('bash', ['-c', guard], { cwd, env, encoding: 'utf8', timeout: 15000 });
  };
  return { root, cwd, draft, selected, other, setTag, run };
}

test('publish guard executes with a real annotated tag and the explicit event default branch', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(f.selected));
});

test('publish guard permits lightweight tags peeled to the assembled commit', t => {
  const result = fixture(t, false).run();
  assert.equal(result.status, 0, result.stderr);
});

test('publish guard refuses dispatch from a different branch or tag ref', t => {
  for (const ref of ['refs/heads/main', 'refs/tags/v1.5.4']) {
    const result = fixture(t).run({ GITHUB_REF: ref });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /default branch/);
  }
});

for (const platform of ['combined', 'windows-x86_64', 'linux-x86_64']) {
  for (const corruption of ['missing', 'malformed', 'commit', 'tag', 'version', 'repository', 'prerelease', 'platform', 'assets']) {
    test(`publish guard refuses ${corruption} ${platform} provenance`, t => {
      const f = fixture(t);
      const file = path.join(f.draft, `release-index-${platform}.json`);
      if (corruption === 'missing') fs.rmSync(file);
      else if (corruption === 'malformed') fs.writeFileSync(file, '{');
      else {
        const index = JSON.parse(fs.readFileSync(file, 'utf8'));
        index[corruption] = corruption === 'commit' ? f.other : corruption === 'prerelease' ? true : corruption === 'assets' ? [] : 'wrong';
        fs.writeFileSync(file, JSON.stringify(index));
      }
      const result = f.run();
      assert.notEqual(result.status, 0, result.stdout);
    });
  }
}

test('publish guard checks every platform identity even with self-consistent combined hashes', t => {
  const f = fixture(t);
  const name = 'release-index-linux-x86_64.json';
  const file = path.join(f.draft, name);
  const shard = JSON.parse(fs.readFileSync(file, 'utf8'));
  shard.commit = f.other;
  fs.writeFileSync(file, JSON.stringify(shard));
  const combinedFile = path.join(f.draft, 'release-index-combined.json');
  const combined = JSON.parse(fs.readFileSync(combinedFile, 'utf8'));
  combined.assets.find(asset => asset.name === name).sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(combinedFile, JSON.stringify(combined));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release-index-linux-x86_64.json has conflicting commit/);
});

test('final checksum gate accepts actual Android-extended assembly and rejects changed or uncovered assets', t => {
  const f = fixture(t);
  const android = path.join(f.cwd, 'artifacts/android');
  fs.mkdirSync(android);
  fs.writeFileSync(path.join(android, 'Mourn-mobile-1.5.4.apk'), Buffer.alloc(1_000_000, 1));
  const assembled = spawnSync(process.execPath, [path.join(repository, 'scripts/assemble_android_into_release.mjs')], {
    cwd: f.cwd, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: identity.tag, RELEASE_COMMIT: f.selected, GITHUB_REPOSITORY: identity.repository },
  });
  assert.equal(assembled.status, 0, assembled.stderr);
  const checked = f.run();
  assert.equal(checked.status, 0, checked.stderr);
  const checksum = publish.match(/- name: Require every asset and its manifest\n        run: \|\n([\s\S]*?)(?=      - )/)[1].replace(/^          /gm, '');
  const run = () => spawnSync('bash', ['-c', checksum], { cwd: f.cwd, encoding: 'utf8' });
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  fs.writeFileSync(path.join(f.draft, 'uncovered.txt'), 'uncovered');
  assert.notEqual(run().status, 0);
  fs.rmSync(path.join(f.draft, 'uncovered.txt'));
  fs.appendFileSync(path.join(f.draft, 'Mourn-mobile-1.5.4.apk'), 'tampering');
  assert.notEqual(run().status, 0);
});

test('publish guard rejects a remote tag moved after assembly', t => {
  const f = fixture(t);
  f.setTag(f.other);
  const result = f.run();
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /conflicting commit|moved/i);
});

test('publication guard tests use the dispatch checkout, not files absent from historical release tags', () => {
  const build = workflow.slice(workflow.indexOf('\n  build:'), workflow.indexOf('\n  assemble:'));
  assert.doesNotMatch(build, /node --test tests\/releasePublishGuard\.test\.mjs/);
  assert.match(publish, /run: node --test tests\/releasePublishGuard\.test\.mjs/);
});
