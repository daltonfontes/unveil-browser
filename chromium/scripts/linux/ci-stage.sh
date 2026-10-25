#!/usr/bin/env bash
# One stage of the CI build (.github/workflows/build.yml). A GitHub runner
# stops a job after 6 hours and the build takes longer, so each stage builds
# for up to UNVEIL_BUILD_TIMEOUT seconds and the next one carries on from the
# saved build tree. Writes status=running or status=done to $GITHUB_OUTPUT;
# when done, it also packages the build into dist/.
. "$(dirname "$0")/env.sh"

"$UNVEIL_CHROMIUM/scripts/linux/fetch.sh"

set +e
"$UNVEIL_CHROMIUM/scripts/linux/build.sh"
rc=$?
set -e

if [ "$rc" -eq 124 ]; then
  echo "The build ran out of this stage's time; the next stage carries on."
  echo "status=running" >> "$GITHUB_OUTPUT"
  exit 0
fi
[ "$rc" -eq 0 ] || exit "$rc"

"$UNVEIL_CHROMIUM/scripts/linux/package.sh"
echo "status=done" >> "$GITHUB_OUTPUT"
