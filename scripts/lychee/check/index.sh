#!/usr/bin/env bash
#
# Run lychee over the built site (or over an explicit list of HTML files passed
# as arguments, used by the diff-scoped check). Prefers the normalized tree
# (`data-proofer-ignore` links stripped — see scripts/lychee/normalize-html),
# falling back to `public/` when it hasn't been built yet.
#
# Always passes an ABSOLUTE root path: lychee matches `exclude_path` against the
# input path as given, and both the IgnoreDirs port and the normalized tree are
# anchored on `/public/...`, so a relative path would silently disable every
# `exclude_path` entry.
#
# Usage: scripts/lychee/check/index.sh [html-file ...]
set -euo pipefail
cd "$(dirname "$0")/../../.."

command -v lychee >/dev/null || {
  echo '[help] lychee not found. Install it: https://github.com/lycheeverse/lychee#installation' >&2
  exit 1
}

PUBLIC="$PWD/public"
test -d "$PUBLIC" || {
  echo "[help] $PUBLIC not found. Build the site first: npm run build" >&2
  exit 1
}

NORMALIZED="$PWD/tmp/normalized/public"
if [ -d "$NORMALIZED" ]; then
  ROOT="$NORMALIZED"
else
  ROOT="$PUBLIC"
  echo "[note] normalized tree not found at $NORMALIZED; checking public/ directly (data-proofer-ignore links will be enqueued). Run 'npm run precheck:links:lychee' to normalize." >&2
fi

if [ "$#" -gt 0 ]; then
  inputs=()
  for f in "$@"; do inputs+=("${f/$PUBLIC/$ROOT}"); done
else
  inputs=("$ROOT")
fi

# Time the run (crude telemetry for the speed comparison); integer seconds is
# plenty for a multi-second check and stays portable (bash `SECONDS` builtin).
SECONDS=0
set +e
lychee --config lychee.toml --root-dir "$ROOT" "${inputs[@]}"
status=$?
set -e
echo "[timing] lychee link check in ${SECONDS}s (exit ${status})" >&2
exit "${status}"
