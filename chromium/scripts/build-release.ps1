# Builds the release: the shell, apply.ps1, the shell and initial_preferences
# staged into the checkout, out\Release\args.gn from chromium\build\release.gn,
# then chrome and its installer (several hours the first time; resumable),
# then package-release.ps1.
#
#   chromium\scripts\build-release.ps1 [-NoPackage] [autoninja arguments...]
#
# UNVEIL_OFFICIAL=1 adds is_official_build = true (ThinLTO: smaller and
# faster, but the link needs ~64 GB of RAM). UNVEIL_BUILD_TIMEOUT=<seconds>
# stops the build after that long (for CI runners with a time limit; the next
# run carries on). Works on a git checkout (fetch.ps1, with depot_tools) and
# on the source tarball (win\fetch-tarball.ps1, with its own gn and ninja).
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

# The tarball brings its own gn and ninja (win\fetch_deps.py); a git checkout
# uses depot_tools' wrappers.
$gn = Join-Path $ChromiumSrc 'buildtools/win/gn.exe'
$ninja = Join-Path $ChromiumSrc 'third_party/ninja/ninja.exe'
$fromTarball = (Test-Path (Join-Path $ChromiumSrc '.unveil-unpacked')) -and (Test-Path $gn) -and (Test-Path $ninja)
$targets = @('chrome', 'mini_installer')

Push-Location $ChromiumSrc
try {
  Step 'gn gen out\Release'
  if ($fromTarball) { Invoke-Checked $gn gen out\Release } else { Invoke-Checked gn.bat gen out\Release }
  Step "ninja -C out\Release $targets"
  if ($env:UNVEIL_BUILD_TIMEOUT) {
    $ninjaArgs = @('-C', 'out\Release') + $targets + $args
    $proc = Start-Process -FilePath ($(if ($fromTarball) { $ninja } else { 'ninja.exe' })) -ArgumentList $ninjaArgs -NoNewWindow -PassThru
    if (-not $proc.WaitForExit([int]$env:UNVEIL_BUILD_TIMEOUT * 1000)) {
      # Ninja reruns whatever was mid-build: it isn't in .ninja_log yet.
      & taskkill.exe /PID $proc.Id /T /F | Out-Null
      throw "The build timed out after $env:UNVEIL_BUILD_TIMEOUT s"
    }
    if ($proc.ExitCode -ne 0) { throw "ninja failed with exit code $($proc.ExitCode)" }
  } elseif ($fromTarball) {
    Invoke-Checked $ninja -C out\Release @targets @args
  } else {
    Invoke-Checked autoninja.bat -C out\Release @targets @args
  }
} finally { Pop-Location }

if (-not $NoPackage) { & (Join-Path $PSScriptRoot 'package-release.ps1') }
