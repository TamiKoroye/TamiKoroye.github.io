#!/usr/bin/env bash
# Builds the Elemental Forge Android app (a test build installed by hand, not a Play Store release).
# The game is bundled from the published dev build: the elemental-forge-dev folder on the main branch.
# Usage: tools/build-apk.sh [source git ref, default origin/main] [game folder, default elemental-forge-dev]
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
REF="${1:-origin/main}"; DIR="${2:-elemental-forge-dev}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
GAME="$HERE/app/src/main/assets/game"
git -C "$REPO" fetch -q origin main || true
rm -rf "$GAME"; mkdir -p "$GAME"
git -C "$REPO" archive "$REF" "$DIR" | tar -x -C "$GAME" --strip-components=1
BUILD=$(grep -o "dev [^']*" "$GAME/js/build.js" || echo unknown)
echo "bundling: $BUILD"
node "$HERE/tools/icons.mjs" "$GAME/icon.svg" "$HERE/app/src/main/res"
cd "$HERE" && gradle -q --no-daemon assembleRelease
mkdir -p "$HERE/dist"; OUT="$HERE/dist/elemental-forge-$(echo "$BUILD" | awk '{print $3}').apk"
cp app/build/outputs/apk/release/app-release.apk "$OUT"; echo "wrote $OUT"
