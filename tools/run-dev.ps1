# Starts a local Unveil build with its own dev profile, loading the shell from
# shell\dist (patch 0002's --unveil-shell-dir), so shell changes need only
# `npm run build` (or `npm run watch`) in shell\ and a browser restart:
# no C++ rebuild.
#
#   .\tools\run-dev.ps1 [-Chrome path\to\chrome.exe] [extra Chromium switches]
param(
  [string]$Chrome = (Join-Path $PSScriptRoot '..\build\src\out\Default\chrome.exe')
)
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$shell = Join-Path $root 'shell\dist'
$profileDir = Join-Path $root 'build\dev-profile'
if (-not (Test-Path (Join-Path $shell 'manifest.json'))) {
  throw "No shell build in $shell. Run: cd shell; npm ci; npm run build"
}
& $Chrome "--user-data-dir=$profileDir" "--unveil-shell-dir=$shell" @args
