#!/usr/bin/env bash
# Scan the exact selected commit; redact values and fail closed on archive errors.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec python3 scripts/source_audit.py "${1:-HEAD}"
