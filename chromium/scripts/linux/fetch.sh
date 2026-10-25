#!/usr/bin/env bash
# Gets the Chromium source for the version Unveil targets
# (chromium/build/CHROMIUM_VERSION) and the tools to build it: Chromium's own
# clang and Rust, the Debian sysroot it builds against, and gn. About 15 GB.
# Safe to run again: finished steps are skipped.
#
#   chromium/scripts/linux/fetch.sh
#
# Needs: python3, node (any recent one; the build gets its own), curl, xz, ninja, gperf, go, clang-format, esbuild and
# tsc (npm -g install esbuild typescript). install-deps.sh installs them on
# Debian and Ubuntu.
. "$(dirname "$0")/env.sh"

tarball="$UNVEIL_BUILD/chromium-$CHROMIUM_VERSION-lite.tar.xz"
mkdir -p "$UNVEIL_BUILD"

if [ ! -f "$CHROMIUM_SRC/.unveil-unpacked" ]; then
  if [ ! -f "$tarball" ]; then
    step "download Chromium $CHROMIUM_VERSION"
    curl -fL --retry 5 -o "$tarball.part" \
      "https://commondatastorage.googleapis.com/chromium-browser-official/chromium-$CHROMIUM_VERSION-lite.tar.xz"
    mv "$tarball.part" "$tarball"
  fi
  step "unpack -> $CHROMIUM_SRC"
  rm -rf "$CHROMIUM_SRC" "$UNVEIL_BUILD/chromium-$CHROMIUM_VERSION"
  tar -xJf "$tarball" -C "$UNVEIL_BUILD"
  mv "$UNVEIL_BUILD/chromium-$CHROMIUM_VERSION" "$CHROMIUM_SRC"
  touch "$CHROMIUM_SRC/.unveil-unpacked"
  # Not needed any more, and the CI runners are short on disk.
  [ -n "${UNVEIL_KEEP_TARBALL:-}" ] || rm -f "$tarball"
fi

cd "$CHROMIUM_SRC"

if [ ! -f .unveil-toolchain ]; then
  step "clang, Rust and the sysroot"
  python3 tools/clang/scripts/update.py
  python3 tools/rust/update_rust.py
  python3 build/linux/sysroot_scripts/install-sysroot.py --arch=amd64
  touch .unveil-toolchain
fi

# Tools a git checkout gets from CIPD, which the tarball leaves out: the ones
# on this machine stand in, at the paths the build looks for them.
step "host tools"
link() {
  mkdir -p "$(dirname "$2")"
  ln -sfn "$1" "$2"
}
# The build checks for the exact Node version Chromium pins.
node_version="$(sed -n 's/^NODE_VERSION="\(.*\)"/\1/p' third_party/node/update_node_binaries)"
node_dir=third_party/node/linux/node-linux-x64
if [ "$("$node_dir/bin/node" --version 2>/dev/null)" != "$node_version" ]; then
  rm -rf "$node_dir"
  mkdir -p "$node_dir"
  curl -fL --retry 5 "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz" |
    tar -xJ --strip-components=1 -C "$node_dir"
fi
link "$(command -v gperf)" third_party/gperf/cipd/bin/gperf
link "$(command -v go)" third_party/dawn/tools/golang/linux-amd64/bin/go
link "$(command -v clang-format)" buildtools/linux64-format/clang-format
link "$(command -v tsc)" third_party/typescript/linux-amd64/src/lib/tsc
esbuild_pkg="$(npm root -g)/esbuild"
if [ -d "$esbuild_pkg" ]; then
  rm -rf third_party/devtools-frontend/src/node_modules/esbuild
  link "$esbuild_pkg" third_party/devtools-frontend/src/node_modules/esbuild
fi

if [ ! -x out/gn ]; then
  step "gn"
  # With Chromium's clang: gn needs C++23 (std::expected), which an older
  # system compiler may not have.
  llvm="$CHROMIUM_SRC/third_party/llvm-build/Release+Asserts/bin"
  CC="$llvm/clang" CXX="$llvm/clang++" AR="$llvm/llvm-ar" \
    python3 tools/gn/bootstrap/bootstrap.py -o out/gn --skip-generate-buildfiles
fi

echo
echo "Chromium $CHROMIUM_VERSION is in $CHROMIUM_SRC. Next: chromium/scripts/linux/build.sh"
