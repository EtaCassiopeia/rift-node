#!/usr/bin/env bash
#
# Bumps DEFAULT_ENGINE_VERSION — the spawn transport's default engine pin, i.e. "the latest engine
# release this SDK is tested against" — in packages/rift-core/src/spawn/resolve.ts.
#
# Deliberately touches ONLY that constant. The other two engine-version knobs move on separate,
# human decisions and must NOT be bumped mechanically:
#   - DEFAULT_CDYLIB_VERSION (packages/rift-core/src/natives/resolve.ts) — the embedded/native cdylib
#     pin; rises only when compatible natives are published for a newer engine.
#   - minEngineVersion (packages/*/package.json) — the compatibility floor; rises only when the SDK
#     starts depending on newer engine behavior.
#
# Usage: scripts/bump-engine.sh <new-version-without-v>   e.g. scripts/bump-engine.sh 0.14.1
# Fails loudly if the constant was not found or not updated, so a rename/format drift can never ship
# a silently half-bumped (red) PR.

set -euo pipefail

NEW="${1:?usage: bump-engine.sh <new-version-without-v> (e.g. 0.14.1)}"
FILE="packages/rift-core/src/spawn/resolve.ts"

CURRENT="$(grep -oE "DEFAULT_ENGINE_VERSION = 'v[0-9]+\.[0-9]+\.[0-9]+'" "${FILE}" \
  | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -n1)"
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
