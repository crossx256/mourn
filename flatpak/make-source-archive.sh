#!/usr/bin/env bash
# Creates a reviewed commit archive locally. Never uploads or invents a source URL.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ "$#" -ne 2 ]; then
  echo 'Usage: flatpak/make-source-archive.sh COMMIT EXISTING_DIR/source.tar.gz' >&2
  exit 2
fi
exec python3 scripts/source_audit.py "$1" --archive "$2"
