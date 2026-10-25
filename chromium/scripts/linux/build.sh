#!/usr/bin/env bash
# Builds the Linux release in out/Release: the shell, apply.sh, the shell and
# initial_preferences staged into the source, args.gn from
# chromium/build/release.gn plus linux.gn, then chrome (many hours the first
# time; ninja picks up where it stopped). Then package.sh.
#
#   chromium/scripts/linux/build.sh [ninja arguments...]
#
# UNVEIL_BUILD_TIMEOUT=<seconds> stops ninja after that long and exits 124,
# for CI runners with a time limit (the next run carries on).
. "$(dirname "$0")/env.sh"

step "shell"
cd "$UNVEIL_ROOT"
[ -d node_modules ] || npm ci
npm run shell:build

"$UNVEIL_CHROMIUM/scripts/linux/apply.sh"

step "stage the shell and initial_preferences in the source"
cd "$CHROMIUM_SRC"
rm -rf unveil
mkdir -p unveil
cp -r "$UNVEIL_CHROMIUM/shell/dist" unveil/shell
cp "$UNVEIL_CHROMIUM/build/initial_preferences" unveil/

mkdir -p "$UNVEIL_OUT"
args="$(cat "$UNVEIL_CHROMIUM/build/release.gn" "$UNVEIL_CHROMIUM/build/linux.gn")"
if [ ! -f "$UNVEIL_OUT/args.gn" ] || [ "$(cat "$UNVEIL_OUT/args.gn")" != "$args" ]; then
  printf '%s\n' "$args" > "$UNVEIL_OUT/args.gn"
fi

# Chromium's own clang, from fetch.sh.
export PATH="$CHROMIUM_SRC/third_party/llvm-build/Release+Asserts/bin:$PATH"

step "gn gen out/Release"
out/gn gen out/Release

step "ninja -C out/Release chrome"
targets=(chrome chrome_sandbox chrome_crashpad_handler)
if [ -n "${UNVEIL_BUILD_TIMEOUT:-}" ]; then
  # SIGINT lets ninja finish writing its log, so the next run resumes cleanly.
  exec timeout -k 5m -s INT "$UNVEIL_BUILD_TIMEOUT" ninja -C out/Release "${targets[@]}" "$@"
fi
ninja -C out/Release "${targets[@]}" "$@"
echo
echo "Built. Package it with chromium/scripts/linux/package.sh"
