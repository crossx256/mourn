import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function https(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.hostname === 'localhost' || /^[\d.:]+$/.test(url.hostname) || url.hostname.endsWith('.local')) {
    throw new Error(`${label} must be a public HTTPS URL without credentials, query or fragment`);
  }
  return url.href;
}

// Offline preparation only: the operator must independently verify anonymous public
// retrieval and provenance. A local digest cannot prove a remote URL serves those bytes.
export function submissionManifest(template, config, archive) {
  if (config.publicArchiveVerified !== true) throw new Error('Anonymous public archive verification must be acknowledged');
  const url = https(config.archiveUrl, 'archiveUrl');
  const cap = https(config.capEndpoint, 'capEndpoint');
  for (const key of ['archiveSha256', 'runtimeCommit', 'sdkCommit']) {
    if (!/^[a-f0-9]{64}$/.test(config[key] ?? '')) throw new Error(`Invalid ${key}: expected pinned SHA-256/OSTree commit`);
  }
  if (createHash('sha256').update(archive).digest('hex') !== config.archiveSha256) throw new Error('Archive checksum mismatch');
  for (const key of ['runtimeVersion', 'nodeVersion', 'rustVersion']) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(config[key] ?? '')) throw new Error(`Missing or invalid pinned ${key}`);
  }
  const source = /      - type: dir\n        path: \.\.\n        skip:\n(?:          - [^\n]+\n)+/g;
  if ([...template.matchAll(source)].length !== 1) throw new Error('Expected exactly one local source block');
  let result = template.replace(source, `      - type: archive\n        url: ${JSON.stringify(url)}\n        sha256: ${config.archiveSha256}\n        strip-components: 0\n`);
  const replaceOne = (pattern, replacement) => {
    if ([...result.matchAll(new RegExp(pattern.source, 'gm'))].length !== 1) throw new Error(`Unexpected template: ${pattern}`);
    result = result.replace(pattern, replacement);
  };
  replaceOne(/^runtime-version: .*$/m, `runtime-version: ${JSON.stringify(config.runtimeVersion)}\nruntime-commit: ${config.runtimeCommit}\nsdk-commit: ${config.sdkCommit}`);
  replaceOne(/^  - org.freedesktop.Sdk.Extension.node22$/m, `  - org.freedesktop.Sdk.Extension.node22/${config.nodeVersion}`);
  replaceOne(/^  - org.freedesktop.Sdk.Extension.rust-stable$/m, `  - org.freedesktop.Sdk.Extension.rust-stable/${config.rustVersion}`);
  replaceOne(/^        VITE_CLIENT_THEMES: 'true'$/m, `        VITE_CLIENT_THEMES: 'true'\n        VITE_CAP_API_ENDPOINT: ${JSON.stringify(cap)}`);
  return result.replace(/^# Local development manifest[^\n]*\n# source[^\n]*\n/, '# Public submission candidate; verification gates in README.md still apply.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [configPath, archivePath, outputPath, ...extra] = process.argv.slice(2);
    if (!configPath || !archivePath || !outputPath || extra.length) throw new Error('Usage: node flatpak/submission-manifest.mjs CONFIG.json VERIFIED_ARCHIVE OUTPUT.yml');
    const template = readFileSync(new URL('./bio.mourn.newlife.yml', import.meta.url), 'utf8');
    const output = submissionManifest(template, JSON.parse(readFileSync(configPath, 'utf8')), readFileSync(archivePath));
    writeFileSync(outputPath, output, { flag: 'wx' });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
