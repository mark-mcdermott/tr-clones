#!/usr/bin/env bash
# Builds the native engine for every machine here, with its tests and render
# tool, then runs CTest. Output: build/native
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/machines.sh"
cmake -S "$ROOT/core/engine" -B "$ROOT/build/native" -G Ninja -DCMAKE_BUILD_TYPE=Release "-DBOOMBAPBOT_MACHINE_DIRS=$MACHINE_DIRS"
cmake --build "$ROOT/build/native"
ctest --test-dir "$ROOT/build/native" --output-on-failure
