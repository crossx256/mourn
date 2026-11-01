#!/usr/bin/env bash
# No embedded trust-on-first-use hash. Supply LINUXDEPLOY_SHA256 from an
# independent review; optionally supply a local LINUXDEPLOY_APPIMAGE as input.
# The default URL is only a transport location, never an authenticity claim.
set -euo pipefail

if [[ ! "${LINUXDEPLOY_SHA256:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo 'pin_linuxdeploy: independently reviewed LINUXDEPLOY_SHA256 is required; nothing downloaded or executed' >&2
  exit 2
fi
EXPECTED_SHA256="${LINUXDEPLOY_SHA256,,}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
case "$(uname -m)" in
  x86_64|amd64) LD_ARCH=x86_64 ;;
  aarch64|arm64) LD_ARCH=aarch64 ;;
  armv7l|armhf) LD_ARCH=armhf ;;
  i686|i386) LD_ARCH=i386 ;;
  *) echo 'pin_linuxdeploy: unsupported architecture' >&2; exit 2 ;;
esac
TOOL_NAME="linuxdeploy-${LD_ARCH}.AppImage"
TOOLS_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
STABLE_ROOT="$TOOLS_DIR/linuxdeploy-stable"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mourn-linuxdeploy.XXXXXXXX")"
STAGE=''
cleanup() {
  rm -rf -- "$WORK"
  if [ -n "$STAGE" ]; then rm -rf -- "$STAGE"; fi
}
trap cleanup EXIT
RAW="$WORK/$TOOL_NAME"

if [ -n "${LINUXDEPLOY_APPIMAGE:-}" ]; then
  if [ ! -f "$LINUXDEPLOY_APPIMAGE" ] || [ -L "$LINUXDEPLOY_APPIMAGE" ]; then
    echo 'pin_linuxdeploy: local input must be a regular non-symlink file' >&2
    exit 2
  fi
  cp -- "$LINUXDEPLOY_APPIMAGE" "$RAW"
else
  URL="https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/$TOOL_NAME"
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 --connect-timeout 20 --max-time 600 -o "$RAW" "$URL"
fi
if ! printf '%s  %s\n' "$EXPECTED_SHA256" "$RAW" | sha256sum --check --status; then
  echo 'pin_linuxdeploy: SHA-256 mismatch; input will not be executed' >&2
  exit 3
fi
if [ "$(od -An -tx1 -N4 "$RAW" | tr -d ' \n')" != '7f454c46' ]; then
  echo 'pin_linuxdeploy: verified input is not ELF' >&2
  exit 3
fi
chmod 700 "$RAW"
# Never execute or reuse a previously extracted cache tree, even if a marker
# claims it is current. Only this invocation's digest-verified input is run.
( cd -- "$WORK" && "./$TOOL_NAME" --appimage-extract >/dev/null )
APP_RUN="$(readlink -f "$WORK/squashfs-root/AppRun")"
case "$APP_RUN" in
  "$WORK/squashfs-root/"*) ;;
  *) echo 'pin_linuxdeploy: AppRun escapes fresh extraction' >&2; exit 3 ;;
esac
[ -x "$APP_RUN" ] || { echo 'pin_linuxdeploy: extraction has no executable AppRun' >&2; exit 3; }

# Bind every regular extracted file, not only the AppRun entry point. This is
# cache integrity after a fresh verified extraction, not a substitute for the
# independently reviewed original-input digest (nor hostile same-user defense).
find "$WORK/squashfs-root" -type l -print0 > "$WORK/extracted-links"
while IFS= read -r -d '' link; do
  target="$(readlink -f -- "$link")"
  case "$target" in
    "$WORK/squashfs-root/"*) [ -e "$target" ] || exit 3 ;;
    *) echo 'pin_linuxdeploy: extraction symlink escapes fresh tree' >&2; exit 3 ;;
  esac
done < "$WORK/extracted-links"
( cd -- "$WORK/squashfs-root"; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum ) > "$WORK/extracted.sha256"
mkdir -p -- "$TOOLS_DIR"
STAGE="$(mktemp -d "$TOOLS_DIR/.linuxdeploy-stage.XXXXXXXX")"
mv -- "$WORK/extracted.sha256" "$STAGE/extracted.sha256"
mv -- "$WORK/squashfs-root" "$STAGE/squashfs-root"
install -m755 "$RAW" "$STAGE/$TOOL_NAME"
printf '%s\n' "$EXPECTED_SHA256" > "$STAGE/source.sha256"
rm -rf -- "$STABLE_ROOT"
mv -- "$STAGE" "$STABLE_ROOT"
STAGE=''
# Tauri may mutate ELF bytes 8..10. Always replace its cache from the verified
# original; never use that mutated cache as the next invocation's input.
rm -f -- "$TOOLS_DIR/$TOOL_NAME"
install -m755 "$RAW" "$TOOLS_DIR/$TOOL_NAME"
for plugin in linuxdeploy-plugin-gtk.sh linuxdeploy-plugin-gstreamer.sh; do
  src="$SCRIPT_DIR/bundler-tools/$plugin"
  if [ "$plugin" = linuxdeploy-plugin-gstreamer.sh ]; then
    # Install the independently authored adapter under linuxdeploy's public name.
    src="$SCRIPT_DIR/bundler-tools/mourn-gstreamer-bundle.sh"
  fi
  grep -q 'linuxdeploy-stable/squashfs-root/AppRun' "$src"
  rm -f -- "$TOOLS_DIR/$plugin"
  install -m755 "$src" "$TOOLS_DIR/$plugin"
  cmp -s "$src" "$TOOLS_DIR/$plugin"
done
printf '%s  %s\n' "$EXPECTED_SHA256" "$TOOLS_DIR/$TOOL_NAME" "$EXPECTED_SHA256" "$STABLE_ROOT/$TOOL_NAME" | sha256sum --check --status
echo 'pin_linuxdeploy: digest-verified input and fresh bound extraction installed; no cached tree executed'
