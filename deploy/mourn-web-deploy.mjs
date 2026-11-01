#!/usr/bin/env node
/**
 * Pull-based deployer for the MOURN web bundle (Quasar SSR, ./dist/ssr).
 *
 * WHY THIS EXISTS
 *   Production is a Windows box that GitHub Actions cannot reach, so the box pulls:
 *
 *     1. .github/workflows/web-release.yml builds dist/ssr on a v* tag and attaches
 *          mourn-web-ssr-<version>.tar.gz
 *          mourn-web-ssr-<version>.tar.gz.sha256
 *        to that GitHub release.
 *     2. This script asks GitHub for the newest published release. If it is not the
 *        one already live: download -> verify SHA-256 -> unpack -> link the pinned
 *        runtime deps -> repoint `current` -> `pm2 restart` -> HTTP health check ->
 *        roll back and restart the previous release if the new one does not serve.
 *
 *   Node on purpose: the box already runs Node for the backend and the SSR server,
 *   so there is no extra runtime, and every step below is exercised in CI/dev rather
 *   than written blind for PowerShell.
 *
 * DIRECTORY LAYOUT IT OWNS (C:\mourn\mourn-web by default)
 *   current\              junction/symlink -> releases\<live tag>; pm2 runs current\index.js
 *   releases\<tag>\       one immutable bundle per release
 *   deps\<packageHash>\   shared node_modules installed with `npm ci` from the bundle lockfile
 *   downloads\<tag>\      downloaded tarball + checksum
 *   deployed.json         tag / commit / sha256 / deployedAt / previous release
 *   deploy.log            append-only log
 *
 * USAGE
 *   node mourn-web-deploy.mjs                 # deploy the newest release if it is new
 *   node mourn-web-deploy.mjs --watch         # keep doing that every 60 s (pm2 process)
 *   node mourn-web-deploy.mjs --status        # what is live, pm2, port, releases on disk
 *   node mourn-web-deploy.mjs --force         # redeploy even if the tag already looks live
 *   node mourn-web-deploy.mjs --tag v1.4.7 --force   # roll back / deploy an older release
 *
 * EXIT CODES
 *   0 nothing to do / deployed / status printed
 *   1 any failure (nothing is swapped unless the health check passed or was rolled back)
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
const UPDATER_NAME = 'mourn-web-updater';

// ----------------------------------------------------------------------- args ---
function parseArgs(argv) {
  const opts = {
    installRoot: process.env.MOURN_WEB_ROOT || (IS_WINDOWS ? 'C:\\mourn\\mourn-web' : '/srv/mourn-web'),
    repo: process.env.MOURN_GH_REPO || 'crossx256/mourn',
    token: process.env.MOURN_GH_TOKEN || '',
    apiBase: process.env.MOURN_GH_API || 'https://api.github.com',
    port: Number(process.env.MOURN_WEB_PORT || 3001),
    keep: Number(process.env.MOURN_WEB_KEEP || 3),
    pm2Name: process.env.MOURN_WEB_PM2_NAME || '',
    tokenFile: process.env.MOURN_GH_TOKEN_FILE || '',
    backupDir: process.env.MOURN_WEB_BACKUP_DIR || '',
    tag: '',
    expectRelease: String(process.env.MOURN_WEB_EXPECT_RELEASE || ''),
    interval: Number(process.env.MOURN_WEB_INTERVAL || 60),
    force: false,
    status: false,
    watch: false,
    once: false,
    help: false,
  };

  const takesValue = new Set([
    '--install-root', '--repo', '--token', '--token-file', '--backup-dir',
    '--api-base', '--port', '--keep', '--pm2-name', '--tag', '--interval',
    '--expect-release',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    let value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (takesValue.has(key) && value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new Error(`${key} needs a value`);
    }
    switch (key) {
      case '--install-root': opts.installRoot = value; break;
      case '--repo': opts.repo = value; break;
      case '--token': opts.token = value; break;
      case '--token-file': opts.tokenFile = value; break;
      case '--backup-dir': opts.backupDir = value; break;
      case '--api-base': opts.apiBase = value.replace(/\/+$/, ''); break;
      case '--port': opts.port = Number(value); break;
      case '--keep': opts.keep = Number(value); break;
      case '--pm2-name': opts.pm2Name = value; break;
      case '--tag': opts.tag = value; break;
      case '--interval': opts.interval = Number(value); break;
      case '--expect-release': opts.expectRelease = value; break;
      case '--force': opts.force = true; break;
      case '--status': opts.status = true; break;
      case '--watch': opts.watch = true; break;
      case '--once': opts.once = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const HELP = `mourn-web-deploy - pull the newest MOURN web (SSR) bundle and restart pm2

  --install-root <dir>  deploy root (default C:\\mourn\\mourn-web, or $MOURN_WEB_ROOT)
  --repo <owner/name>   GitHub repo holding the release assets (default crossx256/mourn)
  --token <pat>         GitHub token, Contents: Read (default $MOURN_GH_TOKEN)
  --token-file <file>   file holding the token (default <install-root>/gh-token.txt)
  --backup-dir <dir>    where the pre-deploy copy of the live bundle goes
                        (default <install-root>\\dist\\ssr backup, refreshed every deploy)
  --tag <tag>           deploy this release instead of the newest one (rollback path)
  --pm2-name <name>     pm2 process name to restart (default: auto-detect)
  --port <port>         SSR port for the health check (default 3001)
  --keep <n>            how many old releases/bundle dependency trees to keep (default 3)
  --interval <seconds>  --watch polling interval (default 60)
  --expect-release <tag:commit>  require this release identity from the health gate
                        (default $MOURN_WEB_EXPECT_RELEASE; deploys set it themselves)
  --force               deploy even when the tag already looks live
  --status              print live state and exit (never contacts GitHub)
  --watch               poll forever (run this under pm2)
  --once                single check, then exit (what --watch does per tick)
`;

// ---------------------------------------------------------------------- paths ---
const opts = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`mourn-web-deploy: ${error.message}`);
    process.exit(1);
  }
})();

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const ROOT = path.resolve(opts.installRoot);
const RELEASES = path.join(ROOT, 'releases');
const DEPS = path.join(ROOT, 'deps');
const DOWNLOADS = path.join(ROOT, 'downloads');
const CURRENT = path.join(ROOT, 'current');
const STATE_FILE = path.join(ROOT, 'deployed.json');
const LOG_FILE = path.join(ROOT, 'deploy.log');
const LOCK_FILE = path.join(ROOT, 'deploy.lock');
const STAGING = path.join(ROOT, 'staging');
// Copy of the bundle that is live RIGHT BEFORE each deploy, refreshed on every run.
// The immutable releases/<tag> dirs already make rollback possible; this is the
// human-readable safety net krul asked for (and it survives `--keep` pruning).
const BACKUP = path.resolve(opts.backupDir || path.join(ROOT, 'dist', 'ssr backup'));

// Token resolution: --token, then MOURN_GH_TOKEN, then <install-root>/gh-token.txt.
// The file option exists because a pm2 process (or a scheduled task) does not always
// inherit an environment variable you set in an RDP session, and the token must never
// end up in the task/process command line. The file can be ACL-locked to the account
// that owns pm2.
function resolveToken() {
  const fromOptions = String(opts.token || '').trim();
  if (fromOptions) return fromOptions;
  const fromEnv = String(process.env.MOURN_GH_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const tokenFile = opts.tokenFile || process.env.MOURN_GH_TOKEN_FILE || path.join(ROOT, 'gh-token.txt');
  try {
    const value = fs.readFileSync(tokenFile, 'utf8').trim();
    if (value) return value;
  } catch {
    /* no token file - reported when a GitHub call is attempted */
  }
  return '';
}

opts.token = resolveToken();

// ---------------------------------------------------------------------- utils ---
function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(message, level = 'INFO') {
  const line = `${stamp()} [${level}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}${os.EOL}`);
  } catch {
    /* logging must never break a deploy */
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// A .cmd shim (npm.cmd / pm2.cmd) cannot be spawned directly and must not go through
// `shell: true` either: Node concatenates the args there without escaping them
// (DEP0190), which both loses paths with spaces and warns on every run. Instead the
// whole line is handed to cmd.exe with windowsVerbatimArguments and the classic
// /d /s /c "<line>" wrapping, which is the only form cmd parses correctly.
function quoteWin(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function runShellLine(line, options = {}) {
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    windowsHide: true,
    windowsVerbatimArguments: true,
    ...options,
  });
}

function run(command, args = [], options = {}) {
  const base = { stdio: 'inherit', windowsHide: true, ...options };
  const result =
    IS_WINDOWS && /\.(cmd|bat)$/i.test(command)
      ? runShellLine([command, ...args].map(quoteWin).join(' '), base)
      : spawnSync(command, args, { ...base, shell: false });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return result.status === null ? 1 : result.status;
}

// cmd.exe builtins (rmdir / mklink) take paths that may contain spaces. One command
// string, quoted paths, no shell:true concatenation in the way.
function runCmdLine(line) {
  const result = IS_WINDOWS
    ? runShellLine(line, { encoding: 'utf8' })
    : spawnSync('/bin/sh', ['-c', line], { encoding: 'utf8' });
  if (result.error) throw new Error(`could not run "${line}": ${result.error.message}`);
  return result.status === null ? 1 : result.status;
}

function runCapture(command, args) {
  const result =
    IS_WINDOWS && /\.(cmd|bat)$/i.test(command)
      ? runShellLine([command, ...args].map(quoteWin).join(' '), { encoding: 'utf8' })
      : spawnSync(command, args, { encoding: 'utf8', windowsHide: true, shell: false });
  if (result.error) return { status: 1, stdout: '', stderr: result.error.message };
  return { status: result.status === null ? 1 : result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function resolveCommand(names, fallbacks = []) {
  for (const name of names) {
    // `where` on Windows, `command -v` on POSIX - the latter is a shell builtin, so it
    // has to go through a shell rather than spawnSync(name).
    const probe = IS_WINDOWS
      ? runCapture('where', [name])
      : runCapture('/bin/sh', ['-c', `command -v ${name}`]);
    if (probe.status === 0) {
      const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first) return first;
    }
  }
  for (const candidate of fallbacks) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function rmrf(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    log(`could not remove ${target}: ${error.message}`, 'WARN');
  }
}

// ------------------------------------------------------------------- releases ---
async function ghGet(pathname) {
  if (!opts.token) {
    throw new Error('no GitHub token: set MOURN_GH_TOKEN (or --token). The repo is private, so release assets cannot be fetched anonymously.');
  }
  const response = await fetch(`${opts.apiBase}/repos/${opts.repo}${pathname}`, {
    headers: {
      authorization: `Bearer ${opts.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': UPDATER_NAME,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitHub ${pathname} -> ${response.status} ${response.statusText} ${body.slice(0, 200)}`.trim());
  }
  return response.json();
}

async function fetchRelease(tag) {
  const release = tag ? await ghGet(`/releases/tags/${encodeURIComponent(tag)}`) : await ghGet('/releases/latest');
  if (release.draft) throw new Error(`release ${release.tag_name} is still a draft`);
  return release;
}

function pickAssets(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const bundle = assets.find((asset) => /^mourn-web-ssr-.+\.tar\.gz$/.test(asset.name));
  if (!bundle) {
    throw new Error(
      `release ${release.tag_name} has no mourn-web-ssr-*.tar.gz asset. ` +
        `Re-run the "MOURN Web (SSR) Build & Publish" workflow for that tag.`,
    );
  }
  const checksum = assets.find((asset) => asset.name === `${bundle.name}.sha256`);
  if (!checksum) throw new Error(`release ${release.tag_name} is missing ${bundle.name}.sha256 (integrity gate)`);
  return { bundle, checksum };
}

async function downloadAsset(asset, destination) {
  const response = await fetch(asset.url, {
    headers: {
      authorization: `Bearer ${opts.token}`,
      accept: 'application/octet-stream',
      'user-agent': UPDATER_NAME,
    },
  });
  if (!response.ok) throw new Error(`download ${asset.name} -> ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  return buffer.length;
}

// Health gate identity: "<tag>:<commit>" of the release that must be answering.
// Set from --expect-release or MOURN_WEB_EXPECT_RELEASE; deploys derive it from the
// bundle's own BUILD_INFO.json so a stale process cannot pass for the new one.
function expectedReleaseIdentity(tag, buildInfo) {
  const reportedTag = String((buildInfo && buildInfo.tag) || tag || '');
  const commit = String((buildInfo && buildInfo.commit) || '');
  return reportedTag && commit ? `${reportedTag}:${commit}` : '';
}

function readExpectedSha(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const match = text.match(/[0-9a-f]{64}/i);
  if (!match) throw new Error(`checksum asset ${path.basename(file)} has no SHA-256 in it`);
  return match[0].toLowerCase();
}

// ------------------------------------------------------------ current pointer ---
function currentTarget() {
  let stats;
  try {
    stats = fs.lstatSync(CURRENT);
  } catch {
    return '';
  }
  if (stats.isSymbolicLink()) {
    // Windows junctions are reported as symlinks by Node; their target can come back
    // with a \\?\ prefix that path.resolve would mangle.
    try {
      const raw = fs.readlinkSync(CURRENT).replace(/^\\\\\?\\/, '');
      return path.resolve(path.dirname(CURRENT), raw);
    } catch {
      return '';
    }
  }
  if (stats.isDirectory()) {
    // Fallback for a real directory (or a junction Node refuses to readlink).
    const probe = runCapture('cmd', ['/c', `dir /AL "${path.dirname(CURRENT)}"`]);
    const line = probe.stdout.split(/\r?\n/).find((row) => row.toUpperCase().includes('CURRENT') && row.includes('<'));
    if (line) {
      const target = line.split('<')[1].split('>')[0].trim();
      if (target) return path.resolve(target);
    }
    return CURRENT;
  }
  return '';
}

function setCurrent(target) {
  if (IS_WINDOWS) {
    if (fs.existsSync(CURRENT) || isLink(CURRENT)) {
      const removed = runCmdLine(`rmdir "${CURRENT}"`);
      if (removed !== 0) throw new Error(`could not unlink ${CURRENT} (rmdir exit ${removed})`);
    }
    const created = runCmdLine(`mklink /J "${CURRENT}" "${target}"`);
    if (created !== 0) throw new Error(`could not point ${CURRENT} at ${target} (mklink exit ${created})`);
    return;
  }
  // POSIX: create the new link beside the old one and rename over it (atomic swap).
  const temp = `${CURRENT}.${process.pid}.tmp`;
  try {
    fs.unlinkSync(temp);
  } catch {
    /* nothing to clean */
  }
  fs.symlinkSync(target, temp, 'dir');
  fs.renameSync(temp, CURRENT);
}

function isLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------- deps ---
function depCacheKey(releaseDir) {
  const pkgPath = path.join(releaseDir, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error(`payload has no package.json (${pkgPath})`);
  const lockPath = path.join(releaseDir, 'package-lock.json');
  const lockHash = fs.existsSync(lockPath) ? sha256File(lockPath) : 'unpinned';
  // PLAT-04: package.json alone is not the dependency identity - it carries version
  // RANGES. A regenerated lockfile (security patch, transitive bump) has the same
  // package.json and a different tree, so it must not reuse the old deps/ dir.
  const identity = `${sha256File(pkgPath)}\n${lockHash}\n`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

function ensureDeps(releaseDir, npm) {
  const pkgPath = path.join(releaseDir, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error(`payload has no package.json (${pkgPath})`);
  const lockPath = path.join(releaseDir, 'package-lock.json');
  const lockHash = fs.existsSync(lockPath) ? sha256File(lockPath) : '';

  const depKey = depCacheKey(releaseDir);
  const depRoot = path.join(DEPS, depKey);
  const depModules = path.join(depRoot, 'node_modules');
  // `npm ci` creates node_modules and then fills it, so a run that aborts midway
  // (exit 134 / OOM / antivirus lock) leaves a directory that LOOKS installed. Never
  // trust the directory alone: the marker is written only after npm exits 0, and a
  // tree without it is wiped and reinstalled instead of being linked into a release.
  // The marker is also bound to the exact inputs (PLAT-04): a tree installed from
  // another lockfile is not reused even if the directory name somehow collides.
  const okMarker = path.join(depRoot, '.install-ok');
  const markerState = readJson(okMarker, null);
  const installed =
    Boolean(markerState) &&
    fs.existsSync(depModules) &&
    markerState.packageHash === depKey &&
    (markerState.lockHash || '') === lockHash;

  if (!installed) {
    if (fs.existsSync(depRoot)) {
      log(`discarding an incomplete or differently-pinned dependency tree in deps/${depKey}`);
      rmrf(depRoot);
    }
    ensureDir(depRoot);
    fs.copyFileSync(pkgPath, path.join(depRoot, 'package.json'));
    const hasLock = fs.existsSync(lockPath);
    if (hasLock) fs.copyFileSync(lockPath, path.join(depRoot, 'package-lock.json'));

    log(`installing runtime dependencies into deps/${depKey} (this happens once per package.json + lockfile)`);
    // --legacy-peer-deps matches how the bundle lockfile is generated in CI (ts-mls carries
    // an optional peer on a newer @hpke than the app pins); without it npm aborts on ERESOLVE.
    const args = hasLock
      ? ['ci', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund']
      : ['install', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund'];
    if (!hasLock) log('payload has no package-lock.json; falling back to npm install (tree is not pinned)', 'WARN');
    const status = run(npm, args, { cwd: depRoot });
    if (status !== 0) {
      // Leave nothing behind: a partial tree must never be reused by the next run.
      rmrf(depRoot);
      throw new Error(
        `npm exited with ${status} while installing runtime dependencies (partial tree removed). ` +
          `Exit 134 is the installer aborting - usually the box ran out of memory or a scanner held a file. ` +
          `Every release stays deployable; the live one is untouched.`,
      );
    }
    // A bundle whose dependency list is empty leaves no node_modules behind; create it so
    // the release link below is never dangling (a dangling link would later look
    // unreferenced to the pruner and take the tree with it).
    if (!fs.existsSync(depModules)) fs.mkdirSync(depModules, { recursive: true });
    fs.writeFileSync(
      okMarker,
      `${JSON.stringify({ packageHash: depKey, lockHash, installedAt: new Date().toISOString(), node: process.version }, null, 2)}\n`,
    );
  }

  const releaseModules = path.join(releaseDir, 'node_modules');
  if (fs.existsSync(releaseModules) || isLink(releaseModules)) {
    if (IS_WINDOWS) {
      const removed = runCmdLine(`rmdir "${releaseModules}"`);
      if (removed !== 0) throw new Error(`could not unlink ${releaseModules} (exit ${removed})`);
    } else {
      fs.unlinkSync(releaseModules);
    }
  }
  if (IS_WINDOWS) {
    const status = runCmdLine(`mklink /J "${releaseModules}" "${depModules}"`);
    if (status !== 0) throw new Error(`could not link ${releaseModules} -> ${depModules}`);
  } else {
    fs.symlinkSync(depModules, releaseModules, 'dir');
  }
  return depKey;
}

// ------------------------------------------------------------------------ pm2 ---
function pm2List(pm2) {
  const result = runCapture(pm2, ['jlist']);
  if (result.status !== 0 || !result.stdout) return [];
  const text = result.stdout;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findWebProcess(pm2) {
  const processes = pm2List(pm2);
  const desired = path.resolve(CURRENT, 'index.js');
  const matches = processes.filter((proc) => {
    const name = String(proc.name || '');
    const exec = String(proc.pm2_env?.pm_exec_path || '');
    const cwd = String(proc.pm2_env?.pm_cwd || '');
    if (name === UPDATER_NAME) return false; // never target the updater itself
    if (/mourn-web-deploy\.mjs$/i.test(exec)) return false;
    if (opts.pm2Name) return name === opts.pm2Name;
    if (exec) {
      const resolved = (() => {
        try {
          return path.resolve(exec);
        } catch {
          return exec;
        }
      })();
      if (resolved === desired) return true;
      if (/[\\/]ssr[\\/]index\.js$/i.test(exec)) return true;
      if (/[\\/]current[\\/]index\.js$/i.test(exec)) return true;
      if (/mourn-web/i.test(exec)) return true;
    }
    return /dist[\\/]ssr/i.test(cwd);
  });
  return matches[0] || null;
}

function startOrRestart(pm2) {
  const desired = path.join(CURRENT, 'index.js');
  const proc = findWebProcess(pm2);

  if (proc) {
    const name = String(proc.name);
    const exec = String(proc.pm2_env?.pm_exec_path || '');
    const cwd = String(proc.pm2_env?.pm_cwd || '');
    const pointsHere = (() => {
      try {
        return exec ? path.resolve(exec) === path.resolve(desired) : false;
      } catch {
        return false;
      }
    })();
    if (pointsHere) {
      log(`restarting pm2 process "${name}"`);
      if (run(pm2, ['restart', name, '--update-env']) !== 0) throw new Error('pm2 restart failed');
      run(pm2, ['save']);
      return { name, adoptedFrom: null };
    }
    // One-time migration away from the hand-uploaded folder. Same downtime as the
    // restart we were about to do anyway, and the name is preserved. The old entry is
    // remembered so a failed health check can put the site back on it.
    log(`pm2 process "${name}" runs "${exec}", not the deploy root - recreating it against ${desired}`, 'WARN');
    run(pm2, ['delete', name]);
    if (run(pm2, ['start', desired, '--name', name, '--cwd', CURRENT]) !== 0) throw new Error('pm2 start failed');
    run(pm2, ['save']);
    return { name, adoptedFrom: exec ? { exec, cwd } : null };
  }

  const name = opts.pm2Name || 'mourn-web';
  log(`no web process found in pm2 - starting "${name}" from ${desired}`);
  if (run(pm2, ['start', desired, '--name', name, '--cwd', CURRENT]) !== 0) throw new Error('pm2 start failed');
  run(pm2, ['save']);
  return { name, adoptedFrom: null };
}

// --------------------------------------------------------------------- health ---
// GET <path> on the local SSR port. Resolves once with the status and body prefix.
function httpGet(port, pathname) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 5000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
      });
      response.on('error', () => resolve({ status: 0, body: '' }));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ status: 0, body: '' });
    });
    request.on('error', () => resolve({ status: 0, body: '' }));
  });
}

/**
 * Health decision for one probe. Split out so it is a pure function of the answer.
 *
 * PLAT-06: a redirect, 401 or 404 is NOT proof the new release is serving - the
 * proxy, a stale process, or an error page answer those too. Only an exact 2xx from
 * the intended app counts, and when the expected release identity is known
 * (`tag:commit`) the server must report that same identity from /__mourn/release.
 */
function healthVerdict(status, identityBody, expected) {
  if (status < 200 || status > 299) {
    return { ok: false, status, reason: `HTTP ${status || 'no answer'} (need 2xx)` };
  }
  if (!expected) return { ok: true, status };
  let reported = null;
  try {
    reported = JSON.parse(String(identityBody || ''));
  } catch {
    reported = null;
  }
  if (!reported || typeof reported !== 'object') {
    return { ok: false, status, reason: 'no release identity (is this the deployed app?)' };
  }
  const actual = `${reported.tag || ''}:${reported.commit || ''}`;
  if (actual !== expected) {
    return { ok: false, status, reason: `release identity ${actual} does not match expected ${expected}` };
  }
  return { ok: true, status, release: actual };
}

/**
 * Probe the running release. `expected` (e.g. "v1.4.9:abc1234") is the tag and
 * build commit of the bundle that must be answering; without it only the 2xx check
 * applies (that is only used by --status on a box we have no expectation for).
 */
async function probeOnce(port, expected = '') {
  const root = await httpGet(port, '/');
  if (root.status < 200 || root.status > 299) {
    return healthVerdict(root.status, '', expected);
  }
  if (!expected) return healthVerdict(root.status, '', '');
  const identity = await httpGet(port, '/__mourn/release');
  // The identity endpoint answers 404 on a build that predates it: that is a real
  // answer, and it is not our release, so the verdict below refuses it.
  return healthVerdict(root.status, identity.status === 200 ? identity.body : '', expected);
}

async function waitForHealth(port, attempts = 20, delayMs = 1500, expected = '') {
  let last = { status: 0 };
  for (let i = 0; i < attempts; i++) {
    last = await probeOnce(port, expected);
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last;
}

// ------------------------------------------------------------------ snapshot ---
/**
 * Copy whatever is live right now into BACKUP before the pointer moves. Called on
 * every deploy, successful or not, so BACKUP always holds the bundle that was
 * serving before the most recent attempt. node_modules is not copied (it is a
 * junction into the shared deps store); the same tree is linked into the snapshot
 * and is kept alive by the pruner for as long as the snapshot references it.
 */
function snapshotLive(liveTarget, liveTag, liveCommit, backupRoot = BACKUP) {
  if (!liveTarget || !fs.existsSync(path.join(liveTarget, 'index.js'))) {
    return { taken: false, reason: 'no live bundle on disk yet (first deploy)' };
  }

  try {
    rmrf(backupRoot);
    ensureDir(path.dirname(backupRoot));
    fs.cpSync(liveTarget, backupRoot, {
      recursive: true,
      filter: (source) => path.basename(source) !== 'node_modules' && path.basename(source) !== '.payload.sha256',
    });
    // rmrf()/cpSync can fail on a locked or full volume; prove the copy is a bundle
    // before reporting success. "taken" must mean rollback actually has something.
    if (!fs.existsSync(path.join(backupRoot, 'index.js'))) {
      return { taken: false, reason: `the copy in ${backupRoot} has no index.js` };
    }

    let depsKey = '';
    const liveModules = path.join(liveTarget, 'node_modules');
    try {
      const real = fs.realpathSync(liveModules);
      depsKey = path.basename(path.dirname(real));
      const backupModules = path.join(backupRoot, 'node_modules');
      if (IS_WINDOWS) runCmdLine(`mklink /J "${backupModules}" "${real}"`);
      else fs.symlinkSync(real, backupModules, 'dir');
    } catch {
      depsKey = '';
    }

    fs.writeFileSync(
      path.join(backupRoot, 'BACKUP_INFO.json'),
      `${JSON.stringify(
        {
          note: 'Copy of the bundle that was live before the deploy below. Refreshed on every deploy.',
          tag: liveTag || '',
          commit: liveCommit || '',
          from: liveTarget,
          depsKey,
          takenAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    return { taken: true, path: backupRoot, tag: liveTag || '(unknown)' };
  } catch (error) {
    return { taken: false, reason: `snapshot failed: ${error.message}` };
  }
}

// ----------------------------------------------------------------------- prune ---
function pruneState(protectedPaths) {
  if (!fs.existsSync(RELEASES)) return;
  const entries = fs
    .readdirSync(RELEASES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const full = path.join(RELEASES, entry.name);
      return { name: entry.name, full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const keepExtra = Math.max(0, opts.keep - protectedPaths.length);
  const doomed = entries.filter((entry) => !protectedPaths.includes(entry.full)).slice(keepExtra);
  for (const entry of doomed) {
    log(`pruning old release ${entry.name}`);
    rmrf(entry.full);
  }

  if (!fs.existsSync(DEPS)) return;
  const referenced = new Set();
  let unresolved = 0;
  for (const entry of fs.readdirSync(RELEASES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modules = path.join(RELEASES, entry.name, 'node_modules');
    try {
      referenced.add(path.resolve(fs.realpathSync(modules)));
    } catch (error) {
      // A release we cannot resolve might still own one of these trees, so the safe
      // move is to prune nothing rather than guess and delete a live one.
      unresolved += 1;
      if (process.env.MOURN_DEBUG) log(`release ${entry.name}: node_modules not resolvable (${error.code})`, 'DEBUG');
    }
  }
  if (unresolved > 0) {
    log(`skipping dependency pruning: ${unresolved} release(s) have an unresolvable node_modules link`, 'WARN');
    return;
  }
  // The pre-deploy snapshot references a deps tree too; keep it alive while it is there.
  try {
    referenced.add(path.resolve(fs.realpathSync(path.join(BACKUP, 'node_modules'))));
  } catch {
    /* no snapshot, or it has no deps link */
  }
  if (process.env.MOURN_DEBUG) log(`deps referenced: ${[...referenced].join(' | ') || '(none)'}`, 'DEBUG');
  for (const dep of fs.readdirSync(DEPS, { withFileTypes: true })) {
    if (!dep.isDirectory()) continue;
    const full = path.join(DEPS, dep.name);
    const modules = path.join(full, 'node_modules');
    if (process.env.MOURN_DEBUG) log(`dependency tree deps/${dep.name}: referenced=${referenced.has(path.resolve(modules))}`, 'DEBUG');
    if (!referenced.has(path.resolve(full)) && !referenced.has(path.resolve(modules))) {
      log(`pruning dependency tree deps/${dep.name}`);
      rmrf(full);
    }
  }
}

// ------------------------------------------------------------------------ lock ---
// PLAT-05: the lock must be CREATED exclusively, not read-then-written. Two runs
// that both observed "no lock" would each pass the old check and both deploy.
// fs.openSync(..., 'wx') is O_CREAT|O_EXCL: exactly one run can win; the loser
// gets EEXIST. Ownership is recorded in the file so a release never deletes
// another run's lock, and a lock whose owner process is gone (crash, reboot) is
// reclaimed instead of blocking deploys forever.
function lockHeldByLiveProcess(held) {
  const pid = Number(held && held.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user - still a live owner.
    return error && error.code === 'EPERM';
  }
}

const LOCK_TOKEN = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function acquireLock() {
  ensureDir(path.dirname(LOCK_FILE));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), token: LOCK_TOKEN }));
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const held = readJson(LOCK_FILE, null);
      if (lockHeldByLiveProcess(held)) return false;
      log(`reclaiming a stale deploy lock left by ${held && held.pid ? `pid ${held.pid}` : 'an unknown run'}`, 'WARN');
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {
        /* another run may have reclaimed it first; the retry decides */
      }
    }
  }
  return false;
}

function releaseLock() {
  try {
    const held = readJson(LOCK_FILE, null);
    // Only ever delete the lock this run created.
    if (held && held.token === LOCK_TOKEN) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* nothing to release */
  }
}

// ---------------------------------------------------------------------- status ---
function printStatus() {
  const state = readJson(STATE_FILE, {}) || {};
  const live = currentTarget();
  const pm2 = resolveCommand(['pm2.cmd', 'pm2'], [path.join(process.env.APPDATA || '', 'npm', 'pm2.cmd')]);
  const lines = [
    `install root : ${ROOT}`,
    `live tag     : ${state.tag || '(none)'}`,
    `commit       : ${state.commit || '(unknown)'}`,
    `deployed at  : ${state.deployedAt || '(never)'}`,
    `current ->   : ${live || '(missing)'}`,
  ];
  if (pm2) {
    const proc = findWebProcess(pm2);
    lines.push(
      proc
        ? `pm2 process  : ${proc.name} [${proc.pm2_env?.status}] -> ${proc.pm2_env?.pm_exec_path}`
        : 'pm2 process  : (none found)',
    );
  } else {
    lines.push('pm2 process  : (pm2 not found on PATH)');
  }
  if (fs.existsSync(RELEASES)) {
    lines.push('releases     :');
    for (const entry of fs.readdirSync(RELEASES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      lines.push(`  - ${entry.name}`);
    }
  }
  const snapshot = readJson(path.join(BACKUP, 'BACKUP_INFO.json'), null);
  lines.push(
    snapshot
      ? `backup       : ${snapshot.tag || '(unknown tag)'} taken ${snapshot.takenAt} -> ${BACKUP}`
      : `backup       : (none yet) -> ${BACKUP}`,
  );
  console.log(lines.join('\n'));
  return waitForHealth(opts.port, 2, 500, opts.expectRelease).then((health) => {
    const detail = health.ok
      ? `answering (${health.status}${health.release ? `, ${health.release}` : ''})`
      : `NOT answering${health.reason ? ` - ${health.reason}` : ''}`;
    console.log(`port ${opts.port}     : ${detail}`);
  });
}

// ---------------------------------------------------------------------- deploy ---
async function deployOnce({ tar, npm, pm2 }) {
  const release = await fetchRelease(opts.tag);
  const targetTag = String(release.tag_name || '');
  if (!/^v/.test(targetTag)) throw new Error(`release tag "${targetTag}" does not start with v; refusing to deploy it`);

  const state = readJson(STATE_FILE, {}) || {};
  const liveTag = String(state.tag || '');
  const liveTarget = currentTarget();
  const liveExists = liveTarget ? fs.existsSync(path.join(liveTarget, 'index.js')) : false;

  const liveIdentity = expectedReleaseIdentity(liveTag, readJson(path.join(liveTarget || '', 'BUILD_INFO.json'), null));
  if (!opts.force && liveTag === targetTag && liveExists) {
    const health = await waitForHealth(opts.port, 2, 500, liveIdentity);
    if (health.ok) return { outcome: 'up-to-date', tag: targetTag };
    log(`${targetTag} is already deployed but port ${opts.port} is not answering; repairing`, 'WARN');
  }

  const { bundle, checksum } = pickAssets(release);
  const downloads = path.join(DOWNLOADS, targetTag);
  ensureDir(downloads);
  const tarPath = path.join(downloads, bundle.name);
  const shaPath = path.join(downloads, `${bundle.name}.sha256`);

  log(`deploying ${targetTag} (${bundle.name}, ${(Number(bundle.size || 0) / 1024 / 1024).toFixed(1)} MB)`);
  const bytes = await downloadAsset(bundle, tarPath);
  await downloadAsset(checksum, shaPath);

  const expected = readExpectedSha(shaPath);
  const actual = sha256File(tarPath);
  if (expected !== actual) throw new Error(`checksum mismatch for ${bundle.name}: expected ${expected}, got ${actual}`);
  log(`checksum ok (${actual.slice(0, 12)}...) after ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  const target = path.join(RELEASES, targetTag);
  const marker = path.join(target, '.payload.sha256');
  const alreadyUnpacked = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === actual;

  // ---- back up the outgoing bundle BEFORE anything touches the live tree ----
  // PLAT-03: when the same tag is redeployed with changed bytes, target ===
  // liveTarget, and the unpack below replaces it in place. Snapshotting afterwards
  // (the old order) copied the NEW bytes and destroyed the rollback copy. A repair
  // of a live release is also the one case where losing it costs availability, so
  // the snapshot is mandatory there and the deploy is refused if it cannot be made.
  const previousTarget = liveExists ? liveTarget : '';
  const snapshot = snapshotLive(previousTarget, liveTag, String(state.commit || ''));
  if (!snapshot.taken) {
    if (alreadyUnpacked || !previousTarget) {
      log(`skipped the pre-deploy backup: ${snapshot.reason}`);
    } else if (previousTarget === target) {
      throw new Error(
        `refusing to replace the live release ${targetTag} with a different payload: ` +
          `the pre-deploy snapshot could not be taken (${snapshot.reason}), so there would be nothing to roll back to`,
      );
    } else {
      // A different release dir is about to be created; the live tree is not
      // modified, so the old releases/<liveTag> still serves as the fallback.
      log(`pre-deploy backup not taken (${snapshot.reason}); the live release stays on disk untouched`, 'WARN');
    }
  } else {
    log(`backed up the live bundle (${snapshot.tag}) to ${snapshot.path}`);
  }

  if (alreadyUnpacked) {
    log(`release ${targetTag} already unpacked with this exact payload; reusing`);
  } else {
    ensureDir(STAGING);
    const staging = fs.mkdtempSync(path.join(STAGING, 'release-'));
    try {
      const status = run(tar, ['-xzf', tarPath, '-C', staging]);
      if (status !== 0) throw new Error(`tar exited with ${status} while unpacking ${bundle.name}`);
      if (!fs.existsSync(path.join(staging, 'index.js'))) throw new Error('payload has no index.js; refusing to deploy it');
      rmrf(target);
      fs.renameSync(staging, target);
    } finally {
      rmrf(staging);
    }
    fs.writeFileSync(marker, actual);
  }

  ensureDeps(target, npm);

  // ---- swap the pointer; the outgoing bundle is already snapshotted ----
  setCurrent(target);

  let pm2Name;
  let adoptedFrom = null;
  try {
    const started = startOrRestart(pm2);
    pm2Name = started.name;
    adoptedFrom = started.adoptedFrom;
  } catch (error) {
    if (previousTarget) {
      log(`restart failed (${error.message}); restoring ${path.basename(previousTarget)}`, 'ERROR');
      setCurrent(previousTarget);
      try {
        startOrRestart(pm2);
      } catch {
        /* reported below */
      }
    }
    throw error;
  }

  const buildInfo = readJson(path.join(target, 'BUILD_INFO.json'), {}) || {};
  const identity = expectedReleaseIdentity(targetTag, buildInfo);
  // PLAT-06: the process answering must be THIS release. Without a build identity in
  // the payload only the 2xx requirement applies, and that is said out loud.
  if (!identity) log('payload has no BUILD_INFO.json tag/commit; the health gate can only require a 2xx', 'WARN');
  const health = await waitForHealth(opts.port, 20, 1500, identity || opts.expectRelease);
  if (!health.ok) {
    log(`health check failed on port ${opts.port} after deploying ${targetTag}${health.reason ? ` (${health.reason})` : ''}`, 'ERROR');
    if (previousTarget && fs.existsSync(previousTarget)) {
      log(`rolling back to ${path.basename(previousTarget)}`, 'WARN');
      setCurrent(previousTarget);
      run(pm2, ['restart', pm2Name, '--update-env']);
      const rolledBackIdentity = expectedReleaseIdentity(
        liveTag,
        readJson(path.join(previousTarget, 'BUILD_INFO.json'), null),
      );
      const rolledBack = await waitForHealth(opts.port, 10, 1500, rolledBackIdentity);
      log(
        rolledBack.ok
          ? `rollback is serving (${rolledBack.status}); live release unchanged`
          : `rollback is NOT serving either - check pm2 logs for ${pm2Name}`,
        rolledBack.ok ? 'WARN' : 'ERROR',
      );
    } else if (adoptedFrom && adoptedFrom.exec) {
      // First deploy of all: there is no previous release to fall back to, and the
      // process we adopted was the only thing serving the site. Put it back rather
      // than leaving production down because a new bundle would not boot.
      log(`no previous release to fall back to; restoring the pre-deploy pm2 entry (${adoptedFrom.exec})`, 'WARN');
      run(pm2, ['delete', pm2Name]);
      run(pm2, ['start', adoptedFrom.exec, '--name', pm2Name, '--cwd', adoptedFrom.cwd || path.dirname(adoptedFrom.exec)]);
      run(pm2, ['save']);
      const restored = await waitForHealth(opts.port, 10);
      log(
        restored.ok
          ? 'pre-deploy entry is serving again; the deployed release stays on disk as releases/'
          : `pre-deploy entry is NOT serving either - check pm2 logs for ${pm2Name}`,
        restored.ok ? 'WARN' : 'ERROR',
      );
    }
    throw new Error(`deploy of ${targetTag} failed the health check on port ${opts.port}`);
  }

  fs.writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        tag: targetTag,
        commit: buildInfo.commit || '',
        sha256: actual,
        deployedAt: new Date().toISOString(),
        previousTag: liveTag,
        previousPath: previousTarget,
        pm2Name,
        path: target,
        health: health.status,
      },
      null,
      2,
    )}\n`,
  );

  const protectedPaths = [target];
  if (previousTarget) protectedPaths.push(previousTarget);
  pruneState(protectedPaths);
  log(`deployed ${targetTag}${buildInfo.commit ? ` (commit ${String(buildInfo.commit).slice(0, 8)})` : ''} -> ${target}; serving on ${opts.port} (HTTP ${health.status})`);
  return { outcome: 'deployed', tag: targetTag };
}

// The lock is taken by main() before any tool discovery, download or mutation, so a
// second run cannot even start the prerequisites of a deploy while the first runs.
// tick() just reports why it could not run.
async function tick(context, locked = true) {
  if (!locked) {
    log('another deploy run is in progress; skipping this tick', 'WARN');
    return;
  }
  try {
    if (!context) throw new Error('missing deploy context');
    const result = await deployOnce(context);
    if (result.outcome === 'up-to-date' && opts.watch) return; // stay silent while polling
    if (result.outcome === 'up-to-date') console.log(`already live: ${result.tag}`);
  } catch (error) {
    log(error.message, 'ERROR');
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------------ main ---
async function main() {
  ensureDir(ROOT);

  if (opts.status) {
    await printStatus();
    return;
  }

  if (Number(process.versions.node.split('.')[0]) < 18) {
    throw new Error(`Node 18+ is required for global fetch (this is ${process.version})`);
  }

  if (!opts.watch) {
    // The lock is taken before any tool discovery, download or mutation, so a second
    // run cannot start the prerequisites of a deploy while the first is running.
    const locked = acquireLock();
    try {
      if (!locked) {
        await tick(null, false);
      } else {
        // Only the lock owner creates the directories a deploy owns.
        for (const dir of [RELEASES, DEPS, DOWNLOADS]) ensureDir(dir);
        await tick(resolveToolchain());
      }
    } finally {
      releaseLock();
    }
    process.exitCode = process.exitCode || 0;
    return;
  }

  log(`watching ${opts.repo} every ${opts.interval}s for new web releases (root ${ROOT}, port ${opts.port})`);
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}; stopping updater`);
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  // Also release on an unexpected throw: a lock left behind is only reclaimed once
  // its owner pid is gone, and in watch mode that pid is this process.
  process.on('exit', () => releaseLock());

  // eslint-disable-next-line no-constant-condition
  while (!stopping) {
    if (acquireLock()) {
      try {
        for (const dir of [RELEASES, DEPS, DOWNLOADS]) ensureDir(dir);
        await tick(resolveToolchain());
      } finally {
        releaseLock();
      }
    } else {
      await tick(null, false);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, Math.max(15, opts.interval) * 1000));
  }
}

// Git's GNU tar treats C: in an archive filename as a remote-host prefix.
// Windows ships a native bsdtar that accepts drive-letter paths; prefer it
// explicitly rather than allowing Git Bash's PATH order to choose the tool.
function resolveTar(platform = process.platform, systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  return platform === 'win32'
    ? resolveCommand([], [path.join(systemRoot, 'System32', 'tar.exe')])
    : resolveCommand(['tar']);
}

// Locate the external commands a deploy needs. Only called while holding the lock.
function resolveToolchain() {
  const tar = resolveTar();
  if (!tar) throw new Error('tar not found (Windows 10 1803+ / Server 2019+ ships it in System32)');
  const npm = resolveCommand(
    ['npm.cmd', 'npm'],
    [IS_WINDOWS ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npm.cmd') : ''],
  );
  if (!npm) throw new Error('npm not found on PATH');
  const pm2 = resolveCommand(['pm2.cmd', 'pm2'], [IS_WINDOWS ? path.join(process.env.APPDATA || '', 'npm', 'pm2.cmd') : '']);
  if (!pm2) throw new Error('pm2 not found on PATH');
  return { tar, npm, pm2 };
}

// Run only when executed directly (`node mourn-web-deploy.mjs ...`), never on import.
// Compared through the real path: a `?query` specifier (used by the tests to get a
// fresh module instance) still resolves back to the same file, while the plain
// comparison would also match a test that runs it with its own argv.
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((error) => {
    try {
      ensureDir(ROOT);
      log(error.message, 'ERROR');
    } catch {
      console.error(`mourn-web-deploy: ${error.message}`);
    }
    process.exit(1);
  });
}

// Tests import these (tests/deployScripts.test.mjs); the script itself only uses them above.
export {
  acquireLock,
  currentTarget,
  depCacheKey,
  ensureDeps,
  expectedReleaseIdentity,
  healthVerdict,
  probeOnce,
  releaseLock,
  resolveTar,
  setCurrent,
  snapshotLive,
  waitForHealth,
};
