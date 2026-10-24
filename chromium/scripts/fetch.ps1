# Gets a Chromium checkout at the version Unveil targets
# (chromium/build/CHROMIUM_VERSION), without history: about 40 GB and an hour
# or more. Run it once, and again after changing CHROMIUM_VERSION.
#
#   chromium\scripts\fetch.ps1
. (Join-Path $PSScriptRoot 'env.ps1')

if (-not (Test-Path (Join-Path $DepotTools 'gclient.bat'))) {
  Step "depot_tools -> $DepotTools"
  Invoke-Checked git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git $DepotTools
  $env:PATH = "$DepotTools;$env:PATH"
}

# Long paths and the settings Chromium's Windows build instructions ask for.
Invoke-Checked git config --global core.longpaths true
Invoke-Checked git config --global core.autocrlf false
Invoke-Checked git config --global core.filemode false

$checkout = Split-Path $ChromiumSrc -Parent
if (-not (Test-Path (Join-Path $ChromiumSrc '.git'))) {
  Step "Chromium checkout -> $checkout"
  New-Item -ItemType Directory -Force $checkout | Out-Null
  Push-Location $checkout
  try { Invoke-Checked fetch.bat --nohooks --no-history chromium } finally { Pop-Location }
}

Step "Chromium $ChromiumVersion"
Push-Location $ChromiumSrc
try {
  Invoke-Checked git fetch --depth 1 origin "+refs/tags/${ChromiumVersion}:refs/tags/$ChromiumVersion"
  Invoke-Checked git checkout --force "tags/$ChromiumVersion"
  Invoke-Checked gclient.bat sync -D --force --no-history --with_tags
} finally { Pop-Location }

Write-Host "`nChromium $ChromiumVersion is in $ChromiumSrc. Next: chromium\scripts\build.ps1"
