# Builds the release: the shell, apply.ps1, the shell and initial_preferences
# staged into the checkout, out\Release\args.gn from chromium\build\release.gn,
# then chrome and its installer (several hours the first time; resumable),
# then package-release.ps1.
#
#   chromium\scripts\build-release.ps1 [-NoPackage] [autoninja arguments...]
#
# UNVEIL_OFFICIAL=1 adds is_official_build = true (ThinLTO: smaller and
# faster, but the link needs ~64 GB of RAM).
param([switch]$NoPackage)
. (Join-Path $PSScriptRoot 'env.ps1')

Step 'shell'
Push-Location $UnveilRoot
try {
  if (-not (Test-Path 'node_modules')) { Invoke-Checked npm.cmd ci }
  Invoke-Checked npm.cmd run shell:build
} finally { Pop-Location }

Step 'apply'
& (Join-Path $PSScriptRoot 'apply.ps1')

Step 'stage the shell and initial_preferences in the checkout'
$staged = Join-Path $ChromiumSrc 'unveil'
if (Test-Path $staged) { Remove-Item -Recurse -Force $staged }
New-Item -ItemType Directory -Force $staged | Out-Null
Copy-Item -Recurse (Join-Path $UnveilChromium 'shell/dist') (Join-Path $staged 'shell')
Copy-Item (Join-Path $UnveilChromium 'build/initial_preferences') $staged

$out = Join-Path $ChromiumSrc 'out/Release'
New-Item -ItemType Directory -Force $out | Out-Null
$argsGn = Get-Content (Join-Path $UnveilChromium 'build/release.gn') -Raw
if ($env:UNVEIL_OFFICIAL -eq '1') { $argsGn += "`nis_official_build = true`n" }
Set-Content -Path (Join-Path $out 'args.gn') -Value $argsGn -NoNewline

Push-Location $ChromiumSrc
try {
  Step 'gn gen out\Release'
  Invoke-Checked gn.bat gen out\Release
  Step 'autoninja -C out\Release chrome mini_installer'
  Invoke-Checked autoninja.bat -C out\Release chrome mini_installer @args
} finally { Pop-Location }

if (-not $NoPackage) { & (Join-Path $PSScriptRoot 'package-release.ps1') }
