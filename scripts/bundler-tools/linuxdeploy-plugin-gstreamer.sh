#!/usr/bin/env bash
# Original compatibility entry point for repository-local callers. The trust
# prerequisite stages mourn-gstreamer-bundle.sh directly under this API name.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec bash "$here/mourn-gstreamer-bundle.sh" "$@"
