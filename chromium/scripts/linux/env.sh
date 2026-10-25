# Where things live, for the Linux build. Every script sources this. Override
# with environment variables:
#   UNVEIL_BUILD   the build folder: the Chromium source and downloads
#                  (../unveil-build, beside the repo)
#   CHROMIUM_SRC   the Chromium source ($UNVEIL_BUILD/src)
#
# The Linux build uses Chromium's official source tarball, as Linux distros
# do, rather than a git checkout: about 2 GB to download instead of 40 GB.
set -euo pipefail

UNVEIL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
UNVEIL_CHROMIUM="$UNVEIL_ROOT/chromium"
CHROMIUM_VERSION="$(tr -d '[:space:]' < "$UNVEIL_CHROMIUM/build/CHROMIUM_VERSION")"
UNVEIL_BUILD="${UNVEIL_BUILD:-$(cd "$UNVEIL_ROOT/.." && pwd)/unveil-build}"
CHROMIUM_SRC="${CHROMIUM_SRC:-$UNVEIL_BUILD/src}"
UNVEIL_OUT="$CHROMIUM_SRC/out/Release"
UNVEIL_VERSION="$(node -p "require('$UNVEIL_ROOT/package.json').version")"

step() {
  printf '\n\033[36m== %s\033[0m\n' "$*"
}
