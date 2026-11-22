#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

audit_bun() {
  for dir in . src-capacitor src-ssr; do
    if [[ $dir == src-ssr && $1 != all && $1 != web ]]; then continue; fi
    printf '\nAuditing %s/bun.lock\n' "$dir"
    test -s "$dir/bun.lock"
    (cd "$dir" && bun audit)
  done
}

case "${1:-all}" in
  all|desktop|mobile|web) mode=${1:-all} ;;
  *) printf 'Usage: %s [all|desktop|mobile|web]\n' "$0" >&2; exit 2 ;;
esac

audit_bun "$mode"
if [[ $mode == all || $mode == desktop ]]; then
  printf '\nAuditing src-tauri/Cargo.lock\n'
  test -s src-tauri/Cargo.lock
  lock="$PWD/src-tauri/Cargo.lock"
  scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mourn-audit.XXXXXXXX")
  trap 'rm -rf -- "$scratch"' EXIT
  # Fetch a fresh snapshot; avoid a full history clone and project-local audit config.
  git clone --quiet --depth 1 https://github.com/RustSec/advisory-db.git "$scratch/db"
  git -C "$scratch/db" rev-parse HEAD
  (cd "$scratch" && cargo audit --db "$scratch/db" --no-fetch --file "$lock" --deny unsound --deny yanked)
fi
