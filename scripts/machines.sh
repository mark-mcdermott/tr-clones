# Sourced by the build scripts: every machine here that has an engine of its
# own, as the list the core's engine build takes.
MACHINE_DIRS="$(find "$ROOT/machines" -maxdepth 3 -path '*/engine/CMakeLists.txt' | sed 's|/engine/CMakeLists.txt$||' | sort | paste -sd ';' -)"
