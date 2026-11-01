#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { decodeTauriPublicKey } from './minisign_verify.mjs';

const confPath = path.resolve(process.cwd(), 'src-tauri', 'tauri.conf.json');
const DEFAULT_ENDPOINT = 'https://mourn.bio/update/{{target}}/{{current_version}}';

function getPubkey() {
  if (process.env.PUBKEY && process.env.PUBKEY.trim().length > 0) return process.env.PUBKEY.trim();
  if (
    process.env.TAURI_UPDATER_PUBLIC_KEY &&
    process.env.TAURI_UPDATER_PUBLIC_KEY.trim().length > 0
  ) {
    return process.env.TAURI_UPDATER_PUBLIC_KEY.trim();
  }
  if (process.env.PUBKEY_FILE) {
    const p = path.resolve(process.cwd(), process.env.PUBKEY_FILE);
    return fs.readFileSync(p, 'utf8').trim();
  }
  console.error('No PUBKEY, TAURI_UPDATER_PUBLIC_KEY, or PUBKEY_FILE provided');
  process.exit(2);
}

function getEndpoint() {
  return (process.env.TAURI_UPDATER_ENDPOINT || DEFAULT_ENDPOINT).trim();
}

const pubkey = getPubkey();
const endpoint = getEndpoint();

if (!endpoint.startsWith('https://')) {
  console.error('Updater endpoint must be HTTPS:', endpoint);
  process.exit(4);
}

const raw = fs.readFileSync(confPath, 'utf8');
let cfg;
try {
  cfg = JSON.parse(raw);
} catch (e) {
  console.error('Failed to parse tauri.conf.json:', e.message);
  process.exit(3);
}

// Key rotation must be a reviewed source change, not a secret-only CI change.
// Assembly independently reads this same committed trust key.
//
// Rotating the key is therefore an explicit, committed decision: set
// MOURN_ALLOW_UPDATER_KEY_ROTATION=1 in addition to the new key. Without it,
// a key that differs from the committed one is refused, so CI can never swap
// the trust anchor silently.
const allowRotation = process.env.MOURN_ALLOW_UPDATER_KEY_ROTATION === '1';
if (!decodeTauriPublicKey(pubkey).packet.equals(decodeTauriPublicKey(cfg.plugins?.updater?.pubkey).packet)) {
  if (!allowRotation) {
    throw new Error(
      'Supplied updater key differs from the reviewed source key. ' +
        'Rotating the trust anchor is a reviewed change: re-run with ' +
        'MOURN_ALLOW_UPDATER_KEY_ROTATION=1 and commit the resulting tauri.conf.json.',
    );
  }
  const oldId = decodeTauriPublicKey(cfg.plugins?.updater?.pubkey).keyId.toString('hex').toUpperCase();
  const newId = decodeTauriPublicKey(pubkey).keyId.toString('hex').toUpperCase();
  console.warn(`Rotating updater trust key: ${oldId} -> ${newId}`);
  console.warn('Existing installs verify against the old key and will need one manual reinstall.');
}

if (!cfg.plugins) cfg.plugins = {};
if (!cfg.plugins.updater) cfg.plugins.updater = {};
cfg.plugins.updater.pubkey = pubkey;
cfg.plugins.updater.endpoints = [endpoint];

fs.writeFileSync(confPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('Injected updater public key and endpoint into', confPath);
