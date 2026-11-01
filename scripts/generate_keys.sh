#!/usr/bin/env bash
set -euo pipefail

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}" ]; then
  echo "Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before running this script."
  echo "Example: export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\"supersecret\""
  exit 2
fi

KEY_DIR="${KEY_DIR:-$HOME/.tauri}"
mkdir -p "$KEY_DIR"
OUT_PATH="$KEY_DIR/mourn-updater.key"

echo "Generating signing keypair to $OUT_PATH"
if command -v bunx >/dev/null 2>&1; then
  bunx tauri signer generate --ci --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" --write-keys "$OUT_PATH"
else
  npx tauri signer generate --ci --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" --write-keys "$OUT_PATH"
fi

echo "Public key (keep private key secret). To put into tauri.conf.json, run:"
echo "cat ${OUT_PATH}.pub"
