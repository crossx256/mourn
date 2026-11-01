// Regression tests for deploy/mourn-web-deploy.mjs.
//
// The deployer runs on the production box (pull-based, pm2). Nothing here downloads
// or installs, and nothing touches a real deployment. Three ways of observing it,
// all offline:
//   1. the real CLI via spawnSync against a temp install root -- argv, env, exit
//      code and the filesystem it writes are the contract;
//   2. `--status` on a port nothing listens on (the health probe's own answer);
//   3. a harness process that imports the script for the pure/near-pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const deployScript = path.join(root, 'deploy/mourn-web-deploy.mjs');

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-deploy-'));
const clean = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// spawnSync would block this process's event loop, so a test-local HTTP server could
// never answer the deployer it is meant to serve. Async spawn keeps the server live.
function deploy(installRoot, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [deployScript, '--install-root', installRoot, ...args], {
      env: { ...process.env, MOURN_GH_TOKEN: '', MOURN_GH_TOKEN_FILE: path.join(installRoot, 'no-token'), ...env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, out: `${stdout}${stderr}` });
    });
  });
}

// A port nothing listens on: the probe answers immediately (ECONNREFUSED).
async function closedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function writeRelease(dir, { pkg = '{"name":"x"}\n', lock = null, index = 'module.exports=1;\n' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), index);
  fs.writeFileSync(path.join(dir, 'package.json'), pkg);
  if (lock !== null) fs.writeFileSync(path.join(dir, 'package-lock.json'), lock);
  return dir;
}

function writeFakeNpm(file) {
  return executableStub(path.dirname(file), path.basename(file),
    "import fs from 'node:fs'; fs.mkdirSync('node_modules', { recursive: true });");
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Run one exported helper in a child process. The deployer is a CLI: importing it
// must not run main, and a fresh process keeps module state from leaking.
function harness(installRoot, options, body) {
  const source = `
    import fs from 'node:fs';
    const deploy = await import(${JSON.stringify(`${pathToFileURL(deployScript).href}?harness`)});
    const options = ${JSON.stringify(options)};
    const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const out = await (async () => { ${body} })();
    process.stdout.write('\\n__HARNESS__' + JSON.stringify(out === undefined ? null : out));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: installRoot,
    env: { ...process.env, MOURN_GH_TOKEN: '', MOURN_WEB_ROOT: installRoot },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const marker = result.stdout.lastIndexOf('__HARNESS__');
  assert.notEqual(marker, -1, `harness printed no result:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.slice(marker + '__HARNESS__'.length));
}

// ------------------------------------------------------------------ health ---
async function statusHealth(port, env = {}) {
  const install = tempRoot();
  try {
    return await deploy(install, ['--status', '--port', String(port)], env);
  } finally {
    clean(install);
  }
}

test('health verdict accepts only an exact 2xx, never a redirect or an error page', async () => {
  const verdicts = harness(tempRoot(), {}, `
    return [301, 401, 404, 500, 503, 200, 204].map((status) => deploy.healthVerdict(status, '', ''));
  `);
  for (const [index, status] of [301, 401, 404, 500, 503].entries()) {
    assert.equal(verdicts[index].ok, false, `HTTP ${status} counted as healthy`);
  }
  assert.equal(verdicts[5].ok, true);
  assert.equal(verdicts[6].ok, true);
});

test('the health probe asks a real server and refuses everything that is not the app', async () => {
  for (const status of [401, 404, 500]) {
    const { server, port } = await listen((req, res) => {
      res.statusCode = status;
      res.end('not the app');
    });
    try {
      assert.match((await statusHealth(port)).out, /NOT answering/, `HTTP ${status} counted as healthy`);
    } finally {
      server.close();
    }
  }
  const { server, port } = await listen((req, res) => {
    res.statusCode = 200;
    res.end('<html>app</html>');
  });
  try {
    assert.match((await statusHealth(port)).out, /answering \(200\)/);
  } finally {
    server.close();
  }
});

test('the health gate refuses a 200 from a process that is not the expected release', async () => {
  const { server, port } = await listen((req, res) => {
    res.statusCode = 200;
    if (req.url === '/__mourn/release') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ tag: 'v3.0.0', commit: 'c0ffee00' }));
      return;
    }
    res.end('<html>app</html>');
  });
  try {
    const wrong = await statusHealth(port, { MOURN_WEB_EXPECT_RELEASE: 'v3.1.0:c0ffee00' });
    assert.match(wrong.out, /NOT answering/, `an old release answering 200 passed the gate:\n${wrong.out}`);
    const right = await statusHealth(port, { MOURN_WEB_EXPECT_RELEASE: 'v3.0.0:c0ffee00' });
    assert.match(right.out, /answering \(200, v3\.0\.0:c0ffee00\)/, right.out);
  } finally {
    server.close();
  }
});

test('the health gate fails closed when the server has no release identity endpoint', async () => {
  const { server, port } = await listen((req, res) => {
    res.statusCode = 200;
    res.end('<html>some other app</html>');
  });
  try {
    const result = await statusHealth(port, { MOURN_WEB_EXPECT_RELEASE: 'v9.9.9:deadbee' });
    assert.match(result.out, /NOT answering/, result.out);
  } finally {
    server.close();
  }
});

test('release identity is tag:commit from the build metadata', () => {
  const identities = harness(tempRoot(), {}, `
    return [
      deploy.expectedReleaseIdentity('v1.0.0', { tag: 'v1.0.0', commit: 'abc' }),
      deploy.expectedReleaseIdentity('v1.0.0', { commit: 'abc' }),
      deploy.expectedReleaseIdentity('v1.0.0', null),
      deploy.expectedReleaseIdentity('v1.0.0', { tag: 'v1.0.0' }),
    ];
  `);
  assert.deepEqual(identities, ['v1.0.0:abc', 'v1.0.0:abc', '', '']);
});

// -------------------------------------------------------------------- lock ---
test('a live lock held by another process makes the run skip without touching anything', async () => {
  const install = tempRoot();
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
  try {
    fs.mkdirSync(path.join(install, 'releases'), { recursive: true });
    const before = JSON.stringify({ pid: holder.pid, at: Date.now(), token: 'other' });
    fs.writeFileSync(path.join(install, 'deploy.lock'), before);
    const result = await deploy(install, ['--once']);
    assert.match(result.out, /another deploy run is in progress/i, result.out);
    assert.equal(result.status, 0, 'a busy lock is not a failed deploy');
    assert.equal(fs.readFileSync(path.join(install, 'deploy.lock'), 'utf8'), before, 'a non-owner must never touch the lock');
    assert.equal(fs.existsSync(path.join(install, 'downloads')), false, 'a locked-out run must not create deploy state');
  } finally {
    holder.kill();
    clean(install);
  }
});

test('a stale lock whose owner is gone is reclaimed and the run proceeds', async () => {
  const install = tempRoot();
  try {
    fs.mkdirSync(path.join(install, 'releases'), { recursive: true });
    // Above the Linux default pid_max: no such process can be alive.
    fs.writeFileSync(path.join(install, 'deploy.lock'), JSON.stringify({ pid: 4194303, at: 1, token: 'dead' }));
    const result = await deploy(install, ['--once']);
    assert.doesNotMatch(result.out, /another deploy run is in progress/i, result.out);
    assert.match(result.out, /reclaiming a stale deploy lock/i, result.out);
    assert.equal(fs.existsSync(path.join(install, 'deploy.lock')), false, 'the run must release its own lock on exit');
  } finally {
    clean(install);
  }
});

test('a lock that is not valid JSON is never silently ignored', async () => {
  const install = tempRoot();
  try {
    fs.mkdirSync(path.join(install, 'releases'), { recursive: true });
    fs.writeFileSync(path.join(install, 'deploy.lock'), '');
    const result = await deploy(install, ['--once']);
    // An empty lock has no owner we can prove dead, but it also names no live pid;
    // it may be reclaimed - what must never happen is two runs both winning.
    assert.ok(
      /another deploy run is in progress/i.test(result.out) || /reclaiming a stale deploy lock/i.test(result.out),
      result.out,
    );
  } finally {
    clean(install);
  }
});

// -------------------------------------------------------------------- deps ---
test('dependency trees are keyed by package.json AND package-lock.json', () => {
  const install = tempRoot();
  try {
    const npm = writeFakeNpm(path.join(install, 'fake-npm.mjs'));
    const a = writeRelease(path.join(install, 'a'), { lock: '{"lockfileVersion":3,"v":1}\n' });
    const b = writeRelease(path.join(install, 'b'), { lock: '{"lockfileVersion":3,"v":2}\n' });
    const unpinned = writeRelease(path.join(install, 'c'));

    const key = (releaseDir) => harness(install, {}, `
      return deploy.ensureDeps(${JSON.stringify(releaseDir)}, ${JSON.stringify(npm)});
    `);
    const keyA = key(a);
    const keyB = key(b);
    const keyC = key(unpinned);

    assert.notEqual(keyA, keyB, 'a patched lockfile must not reuse the previous dependency tree');
    assert.notEqual(keyA, keyC, 'a payload without a lockfile must not collide with a pinned one');
    assert.equal(key(a), keyA, 'the key must be stable for identical inputs');

    const installed = fs.readdirSync(path.join(install, 'deps'))
      .filter((name) => fs.existsSync(path.join(install, 'deps', name, '.install-ok')));
    assert.equal(installed.length, 3, `expected three distinct trees, got ${installed.join(', ')}`);
    const marker = JSON.parse(fs.readFileSync(path.join(install, 'deps', keyA, '.install-ok'), 'utf8'));
    assert.equal(marker.packageHash, keyA);
    assert.equal(marker.lockHash, crypto.createHash('sha256').update('{"lockfileVersion":3,"v":1}\n').digest('hex'),
      'the install marker must record the lockfile it was built from');
  } finally {
    clean(install);
  }
});

test('a dependency tree installed from another lockfile is not reused', () => {
  const install = tempRoot();
  try {
    const npm = writeFakeNpm(path.join(install, 'fake-npm.mjs'));
    const release = writeRelease(path.join(install, 'a'), { lock: '{"v":1}\n' });
    const result = harness(install, {}, `
      const first = deploy.ensureDeps(${JSON.stringify(release)}, ${JSON.stringify(npm)});
      // Simulate a tree left over from a different lockfile under the same key.
      const marker = ${JSON.stringify(path.join(install, 'deps'))} + '/' + first + '/.install-ok';
      fs.writeFileSync(marker, JSON.stringify({ packageHash: first, lockHash: 'stale' }));
      fs.writeFileSync(marker + '.2', 'probe');
      return deploy.ensureDeps(${JSON.stringify(release)}, ${JSON.stringify(npm)});
    `);
    const marker = JSON.parse(fs.readFileSync(path.join(install, 'deps', result, '.install-ok'), 'utf8'));
    assert.equal(marker.lockHash, crypto.createHash('sha256').update('{"v":1}\n').digest('hex'));
  } finally {
    clean(install);
  }
});

// ----------------------------------------------------------------- snapshot ---
test('a same-tag redeploy snapshots the outgoing bundle before the live tree is replaced', () => {
  const install = tempRoot();
  try {
    const target = writeRelease(path.join(install, 'releases', 'v2.0.0'), { index: 'outgoing-working-build\n' });
    const backup = path.join(install, 'dist', 'ssr backup');
    const result = harness(install, { target, backup }, `
      deploy.setCurrent(options.target);
      const outgoing = deploy.currentTarget();
      const snapshot = deploy.snapshotLive(outgoing, 'v2.0.0', 'abc123', options.backup);
      return { snapshot, index: read(options.backup + '/index.js'), info: JSON.parse(read(options.backup + '/BACKUP_INFO.json') || 'null') };
    `);
    assert.equal(result.snapshot.taken, true, JSON.stringify(result.snapshot));
    assert.equal(result.index, 'outgoing-working-build\n');
    assert.equal(result.info.tag, 'v2.0.0');
    assert.equal(result.info.commit, 'abc123');
    assert.equal(result.info.from, target);
  } finally {
    clean(install);
  }
});

test('a snapshot that cannot be taken is reported, never claimed as a rollback point', () => {
  const install = tempRoot();
  try {
    const target = writeRelease(path.join(install, 'releases', 'v2.0.0'));
    // The parent of the backup location is a regular file, so the directory that
    // must hold the snapshot cannot be created: cpSync cannot succeed.
    const backupParent = path.join(install, 'blocked');
    fs.writeFileSync(backupParent, 'not a directory');
    const backup = path.join(backupParent, 'ssr backup');
    const result = harness(install, { target, backup }, `
      return deploy.snapshotLive(options.target, 'v2.0.0', '', options.backup);
    `);
    assert.equal(result.taken, false, JSON.stringify(result));
    assert.match(String(result.reason), /snapshot failed/i);
  } finally {
    clean(install);
  }
});

test('a snapshot of a live tree that has no index.js is refused, not reported as taken', () => {
  const install = tempRoot();
  try {
    const target = path.join(install, 'releases', 'v2.0.0');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), '{}\n');
    const backup = path.join(install, 'dist', 'ssr backup');
    const result = harness(install, { target, backup }, `
      return deploy.snapshotLive(options.target, 'v2.0.0', '', options.backup);
    `);
    assert.equal(result.taken, false, JSON.stringify(result));
  } finally {
    clean(install);
  }
});

// ----------------------------------------------------------------- snapshot ---

test('Windows archive tooling uses the native tar even when PATH has Git tar', () => {
  const install = tempRoot();
  try {
    const systemRoot = path.join(install, 'Windows');
    const nativeTar = path.join(systemRoot, 'System32', 'tar.exe');
    fs.mkdirSync(path.dirname(nativeTar), { recursive: true });
    fs.writeFileSync(nativeTar, 'fixture; must not be executed');
    const result = harness(install, { systemRoot }, `
      return deploy.resolveTar('win32', options.systemRoot);
    `);
    assert.equal(result, nativeTar);
    fs.rmSync(nativeTar);
    const missing = harness(install, { systemRoot }, `
      return deploy.resolveTar('win32', options.systemRoot);
    `);
    assert.equal(missing, '', 'do not fall back to a PATH tar that misreads drive letters as remote hosts');
  } finally {
    clean(install);
  }
});

// ------------------------------------------------------------ redeploy order ---
// Full `deployOnce` through the real CLI: GitHub API + asset host + health server
// are local doubles, npm/pm2/tar are stubs on PATH. Nothing leaves 127.0.0.1.
function bundleTarball(dir, { tag, commit, index }) {
  const source = path.join(dir, 'bundle-src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'index.js'), index);
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"mourn-web","dependencies":{}}\n');
  fs.writeFileSync(path.join(source, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  fs.writeFileSync(path.join(source, 'BUILD_INFO.json'), JSON.stringify({ tag, commit }));
  const tarball = path.join(dir, `mourn-web-ssr-${tag.replace(/^v/, '')}.tar.gz`);
  const tarTool = harness(dir, {}, 'return deploy.resolveTar();');
  const tar = spawnSync(tarTool, ['-czf', path.basename(tarball), '-C', source, '.'], { cwd: dir, encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  return { tarball, bytes: fs.readFileSync(tarball), name: path.basename(tarball) };
}

function executableStub(dir, name, body) {
  const file = path.join(dir, name.endsWith('.mjs') ? name : `${name}.mjs`);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
  if (process.platform === 'win32') {
    const launcher = path.join(dir, `${name.replace(/\.mjs$/, '')}.cmd`);
    fs.writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${file}" %*\r\n`);
    return launcher;
  }
  fs.chmodSync(file, 0o755);
  // Keep bare npm/pm2 names discoverable through PATH on Unix.
  if (file !== path.join(dir, name)) fs.symlinkSync(file, path.join(dir, name));
  return file;
}

test('a same-tag redeploy keeps the outgoing live bundle as the rollback copy', async () => {
  const install = tempRoot();
  const bin = path.join(install, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  executableStub(bin, 'pm2', 'process.exit(0);');
  executableStub(bin, 'npm', "import fs from 'node:fs'; fs.mkdirSync('node_modules', { recursive: true });");
  const bundle = bundleTarball(install, { tag: 'v1.0.0', commit: 'newcommit', index: "console.log('new')\n" });
  const sha = crypto.createHash('sha256').update(bundle.bytes).digest('hex');

  const api = http.createServer((req, res) => {
    const port = api.address().port;
    if (req.url.startsWith('/repos/crossx256/mourn/releases/tags/')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        tag_name: 'v1.0.0',
        draft: false,
        assets: [
          { name: bundle.name, url: `http://127.0.0.1:${port}/assets/tgz`, size: bundle.bytes.length },
          { name: `${bundle.name}.sha256`, url: `http://127.0.0.1:${port}/assets/sha` },
        ],
      }));
      return;
    }
    if (req.url === '/assets/tgz') { res.end(bundle.bytes); return; }
    if (req.url === '/assets/sha') { res.end(`${sha}  ${bundle.name}\n`); return; }
    res.statusCode = 404;
    res.end();
  });
  const app = http.createServer((req, res) => {
    res.statusCode = 200;
    res.end(req.url === '/__mourn/release' ? JSON.stringify({ tag: 'v1.0.0', commit: 'newcommit' }) : 'ok');
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));

  try {
    const root = path.join(install, 'web');
    const liveRelease = path.join(root, 'releases', 'v1.0.0');
    writeRelease(liveRelease, { index: 'outgoing-working-build\n' });
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(liveRelease, path.join(root, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(root, 'deployed.json'), JSON.stringify({ tag: 'v1.0.0', commit: 'oldcommit' }));

    const result = await deploy(root, ['--tag', 'v1.0.0', '--force', '--port', String(app.address().port)], {
      MOURN_GH_TOKEN: 'test-token',
      MOURN_GH_API: `http://127.0.0.1:${api.address().port}`,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    });
    assert.equal(result.status, 0, result.out);

    // The deployed release really was replaced in place...
    assert.equal(fs.readFileSync(path.join(liveRelease, 'index.js'), 'utf8'), "console.log('new')\n");
    // ...and the rollback copy still holds the bundle that was serving before it.
    const snapshotIndex = path.join(root, 'dist', 'ssr backup', 'index.js');
    assert.ok(fs.existsSync(snapshotIndex), `no rollback copy was taken:\n${result.out}`);
    assert.equal(fs.readFileSync(snapshotIndex, 'utf8'), 'outgoing-working-build\n',
      'the rollback copy contains the new bundle: the live tree was replaced before it was snapshotted');
    const info = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'ssr backup', 'BACKUP_INFO.json'), 'utf8'));
    assert.equal(info.commit, 'oldcommit');
  } finally {
    api.close();
    app.close();
    clean(install);
  }
});
