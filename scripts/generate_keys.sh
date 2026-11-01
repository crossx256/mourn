#!/usr/bin/env bash
# Generate (or regenerate) the Tauri updater signing keypair.
#
# Usage: bash scripts/generate_keys.sh [--force]
#
# Refuses to overwrite an existing keypair unless --force is given, and always
# backs up the old pair first: the public half baked into every shipped build
# determines which signatures those installs will accept.
set -euo pipefail

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      echo "Usage: bash scripts/generate_keys.sh [--force]"
      echo "  --force   overwrite an existing keypair (the old one is backed up)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: bash scripts/generate_keys.sh [--force]" >&2
      exit 2
      ;;
  esac
done

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD-}" ]; then
  echo "Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before running this script." >&2
  echo 'Example: export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="supersecret"' >&2
  exit 2
fi

KEY_DIR="${KEY_DIR:-$HOME/.tauri}"
mkdir -p "$KEY_DIR"
OUT_PATH="$KEY_DIR/mourn-updater.key"

if [ -e "$OUT_PATH" ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo "Keypair already exists: $OUT_PATH" >&2
    echo "Re-run with --force to regenerate it (the existing keypair is backed up first)." >&2
    exit 2
  fi
  BACKUP="${OUT_PATH}.backup-$(date +%Y%m%d%H%M%S)"
  cp -- "$OUT_PATH" "$BACKUP"
  chmod 600 "$BACKUP"
  if [ -e "${OUT_PATH}.pub" ]; then
    cp -- "${OUT_PATH}.pub" "${BACKUP}.pub"
  fi
  echo "Existing keypair backed up to $BACKUP"
fi

echo "Generating signing keypair to $OUT_PATH"
if command -v bunx >/dev/null 2>&1; then
  bunx tauri signer generate --ci --force --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" --write-keys "$OUT_PATH"
else
  npx tauri signer generate --ci --force --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" --write-keys "$OUT_PATH"
fi

echo
echo "New public key: $OUT_PATH.pub"
echo "Bake it into the app before tagging a release:"
echo "  TAURI_UPDATER_PUBLIC_KEY=\"\$(cat ${OUT_PATH}.pub)\" node scripts/inject_pubkey.js"
echo "Back up BOTH ${OUT_PATH} and ${OUT_PATH}.pub somewhere off this machine."
