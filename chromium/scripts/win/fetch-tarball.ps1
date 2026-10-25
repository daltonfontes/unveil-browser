# Gets the Chromium source for the version Unveil targets from Chromium's
# official source tarball, as the CI build does, instead of a git checkout
# (fetch.ps1): about 2 GB to download instead of 40 GB, then fetch_deps.py
# adds what a Windows build needs that the tarball leaves out. Safe to run
# again: finished steps are skipped.
#
#   $env:CHROMIUM_SRC = 'C:\ub\src'; chromium\scripts\win\fetch-tarball.ps1
#
# The source lands in CHROMIUM_SRC (default C:\src\chromium\src). Needs
# Python 3, 7-Zip and Visual Studio 2022 (see the README), not depot_tools.
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
  # With 7-Zip: Windows' own tar.exe can't read some file names in it (a
  # test file named with an emoji). The .xz is unpacked into the .tar on the
  # fly, through a pipe in cmd (PowerShell 5 would mangle the bytes), from a
  # .cmd file so that cmd gets its quotes as written.
  $sevenZip = Get-SevenZip
  $unpack = Join-Path $build 'unpack.cmd'
  Set-Content -Path $unpack -Encoding ascii -Value "@`"$sevenZip`" x -so `"$tarball`" | `"$sevenZip`" x -si -ttar -snl -y -bd `"-o$build`" >nul"
  Invoke-Checked cmd.exe /d /c $unpack
  Remove-Item $unpack
  Move-Item $unpacked $ChromiumSrc
  # That test file isn't built; without it, tar.exe can pack and unpack the
  # tree between CI stages (.github/actions/win-stage).
  Get-ChildItem -LiteralPath (Join-Path $ChromiumSrc 'third_party/vulkan-loader/src/tests/framework/icd/export_definitions') -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '[^\x00-\x7f]' } | Remove-Item
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
