#!/usr/bin/env bash
# Install the Vox voice extension from a local checkout into Copilot CLI.
# Copies *.mjs into ~/.copilot/extensions/vox where the CLI auto-discovers it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${COPILOT_EXTENSIONS_DIR:-$HOME/.copilot/extensions}"
DEST="$EXT_DIR/vox"

echo "== Vox installer =="

if ! command -v node >/dev/null 2>&1; then
    echo "WARN: node not found on PATH. Vox needs Node.js; install from https://nodejs.org." >&2
fi

mkdir -p "$DEST"
rm -f "$DEST/registry.json"   # drop stale runtime state
cp "$HERE"/*.mjs "$DEST"/
echo "Copied   : *.mjs -> $DEST"
cp "$HERE/chatterbox-sidecar.py" "$DEST"/
echo "Copied   : chatterbox-sidecar.py -> $DEST"
# SAPI is Windows-only. The Node manager remains installed so shared code can
# report it unsupported without breaking Browser Speech or Kokoro.
echo "Skipped  : sapi-host.ps1 (Windows-only)"
cp "$HERE/THIRD-PARTY-NOTICES.md" "$DEST"/
rm -rf "$DEST/LICENSES"
cp -R "$HERE/LICENSES" "$DEST/LICENSES"
echo "Copied   : third-party notices -> $DEST"

echo
echo "== Done =="
echo "Start a Copilot session and run:"
echo "    /vox        # start voice mode (open http://localhost:4321)"
echo "    /vox-stop   # stop for this session"
echo "    /vox-who    # list live Vox sessions"
