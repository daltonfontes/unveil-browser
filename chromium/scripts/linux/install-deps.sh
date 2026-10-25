#!/usr/bin/env bash
# Installs what fetch.sh and build.sh need, on Debian or Ubuntu (sudo). The
# browser's own libraries come from Chromium's sysroot, so this is only the
# build tools.
#
#   chromium/scripts/linux/install-deps.sh
set -euo pipefail

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  bison clang-format curl flex git golang-go gperf lsb-release ninja-build \
  pkg-config python3 python3-httplib2 python3-jinja2 python3-pyparsing \
  python3-setuptools python3-six rsync xz-utils zstd

command -v node >/dev/null || { echo "Install Node.js 22 or later first (https://nodejs.org)."; exit 1; }
# A Node from nodejs.org or setup-node installs global packages without sudo.
if [ -w "$(npm prefix -g)" ]; then npm install -g esbuild; else sudo -E npm install -g esbuild; fi
