# Starts the dev build (out\Dev) with its own profile, loading the shell from
# chromium\shell\dist (patch 0002's --unveil-shell-dir), so shell changes need
# only `npm run shell:build` (or shell:watch) and a browser restart: no C++
# build. Extra arguments go to Chromium.
#
#   chromium\scripts\run.ps1 [Chromium switches...]
. (Join-Path $PSScriptRoot 'env.ps1')

$chrome = Join-Path $ChromiumSrc 'out/Dev/chrome.exe'
$shell = Join-Path $UnveilChromium 'shell/dist'
if (-not (Test-Path (Join-Path $shell 'manifest.json'))) {
  throw "No shell build in $shell. Run: npm ci; npm run shell:build"
}
& $chrome "--user-data-dir=$UnveilProfile" "--unveil-shell-dir=$shell" @args
