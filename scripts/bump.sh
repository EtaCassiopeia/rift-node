#!/usr/bin/env bash
#
# The rift-node-specific edit half of the dependency-bump loop, invoked by the reusable
# EtaCassiopeia/rift-java/.github/workflows/dep-bump.yml.
#
#   scripts/bump.sh --current        print the currently pinned engine version (bare, no leading v)
#   scripts/bump.sh <new-version>    rewrite DEFAULT_ENGINE_VERSION to v<new-version> and self-verify
#
# Bumps ONLY DEFAULT_ENGINE_VERSION (the spawn transport's default engine pin, "the latest engine
# release this SDK is tested against"). The other two engine-version knobs move on separate, human
# decisions and must NOT be bumped mechanically:
#   - DEFAULT_CDYLIB_VERSION (packages/rift-core/src/natives/resolve.ts) — the embedded/native cdylib
#     pin; rises only when compatible natives are published for a newer engine.
#   - minEngineVersion (packages/*/package.json) — the compatibility floor.

set -euo pipefail

FILE="packages/rift-core/src/spawn/resolve.ts"

current() {
  # Value inside DEFAULT_ENGINE_VERSION = 'vX.Y.Z'; portable sed (GNU + BSD).
  sed -n "s|.*DEFAULT_ENGINE_VERSION = 'v\([0-9][0-9.]*\)'.*|\1|p" "${FILE}" | head -n1
}

if [ "${1:-}" = "--current" ]; then
  current
  exit 0
fi

NEW="${1:?usage: bump.sh --current | bump.sh <new-version>}"
CURRENT="$(current)"
if [ -z "${CURRENT}" ]; then
  echo "Could not read DEFAULT_ENGINE_VERSION from ${FILE}." >&2
  exit 1
fi

# -i.bak is portable across GNU (CI) and BSD (local) sed; drop the backup afterwards.
sed -i.bak "s|DEFAULT_ENGINE_VERSION = 'v${CURRENT}'|DEFAULT_ENGINE_VERSION = 'v${NEW}'|" "${FILE}"
rm -f "${FILE}.bak"

if grep -q "DEFAULT_ENGINE_VERSION = 'v${CURRENT}'" "${FILE}" \
   || ! grep -q "DEFAULT_ENGINE_VERSION = 'v${NEW}'" "${FILE}"; then
  echo "Failed to bump DEFAULT_ENGINE_VERSION ${CURRENT} -> ${NEW} in ${FILE}." >&2
  exit 1
fi

echo "Bumped DEFAULT_ENGINE_VERSION: v${CURRENT} -> v${NEW}"
