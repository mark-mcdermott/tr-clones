#!/usr/bin/env bash
# Builds the engine to WebAssembly for every machine here.
# Output: build/wasm/boombapbot-engine-<machine>.wasm
#
# It needs the Emscripten the core pins. Run pnpm setup:emsdk once, or set
# EMSDK_DIR to an emsdk that already has that version.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="${EMSDK_DIR:-$ROOT/core/.tools/emsdk}"
WANTED="$(tr -d '[:space:]' < "$ROOT/core/.emscripten-version")"

if ! command -v emcmake >/dev/null 2>&1; then
  if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
    echo "Emscripten is not installed. Run pnpm setup:emsdk first, or set EMSDK_DIR." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  EMSDK_QUIET=1 source "$EMSDK_DIR/emsdk_env.sh"
fi

FOUND="$(emcc --version | head -1 | sed -E 's/.*\) ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
if [ "$FOUND" != "$WANTED" ]; then
  echo "Emscripten $FOUND is active but the core pins $WANTED." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/machines.sh"
emcmake cmake -S "$ROOT/core/engine" -B "$ROOT/build/wasm" -G Ninja -DCMAKE_BUILD_TYPE=Release "-DBOOMBAPBOT_MACHINE_DIRS=$MACHINE_DIRS"
cmake --build "$ROOT/build/wasm"
ls -l "$ROOT"/build/wasm/boombapbot-engine-*.wasm
