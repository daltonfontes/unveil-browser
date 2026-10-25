# Gets the Chromium source for the version Unveil targets from Chromium's
# official source tarball, as the CI build does, instead of a git checkout
# (fetch.ps1): about 2 GB to download instead of 40 GB, then fetch_deps.py
# adds what a Windows build needs that the tarball leaves out. Safe to run
# again: finished steps are skipped.
#
#   $env:CHROMIUM_SRC = 'C:\ub\src'; chromium\scripts\win\fetch-tarball.ps1
#
# The source lands in CHROMIUM_SRC (default C:\src\chromium\src). Needs
# Python 3 and Visual Studio 2022 (see the README), not depot_tools.
. (Join-Path $PSScriptRoot '../env.ps1')

$build = Split-Path $ChromiumSrc -Parent
New-Item -ItemType Directory -Force $build | Out-Null
$tarball = Join-Path $build "chromium-$ChromiumVersion-lite.tar.xz"

if (-not (Test-Path (Join-Path $ChromiumSrc '.unveil-unpacked'))) {
  if (-not (Test-Path $tarball)) {
    Step "download Chromium $ChromiumVersion"
    Invoke-Checked curl.exe -fL --retry 5 -o "$tarball.part" "https://commondatastorage.googleapis.com/chromium-browser-official/chromium-$ChromiumVersion-lite.tar.xz"
    Move-Item "$tarball.part" $tarball
  }
  Step "unpack -> $ChromiumSrc"
  $unpacked = Join-Path $build "chromium-$ChromiumVersion"
  foreach ($dir in $ChromiumSrc, $unpacked) { if (Test-Path $dir) { Remove-Item -Recurse -Force $dir } }
  # Windows' own tar (bsdtar) reads .xz.
  Invoke-Checked "$env:SystemRoot\System32\tar.exe" -xf $tarball -C $build
  Move-Item $unpacked $ChromiumSrc
  New-Item -ItemType File (Join-Path $ChromiumSrc '.unveil-unpacked') | Out-Null
  # Not needed any more, and CI runners are short on disk.
  if (-not $env:UNVEIL_KEEP_TARBALL) { Remove-Item $tarball }
}

$cipd = Join-Path $build 'cipd.exe'
if (-not (Test-Path $cipd)) {
  Step 'CIPD client'
  Invoke-Checked curl.exe -fL --retry 5 -o $cipd 'https://chrome-infra-packages.appspot.com/client?platform=windows-amd64&version=latest'
}

Step 'Windows dependencies (fetch_deps.py)'
Invoke-Checked python (Join-Path $PSScriptRoot 'fetch_deps.py') $ChromiumSrc --cipd $cipd

Write-Host "`nChromium $ChromiumVersion is in $ChromiumSrc. Next: chromium\scripts\build-release.ps1"
