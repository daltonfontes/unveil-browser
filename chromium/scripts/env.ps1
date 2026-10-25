# Where things live. Every script dot-sources this. Override with environment
# variables:
#   CHROMIUM_SRC     the Chromium checkout's src folder   (C:\src\chromium\src)
#   DEPOT_TOOLS      depot_tools                          (C:\src\depot_tools)
#   UNVEIL_PROFILE   the dev profile run.ps1 uses         (%LOCALAPPDATA%\Unveil Dev)
$ErrorActionPreference = 'Stop'

$UnveilRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$UnveilChromium = Join-Path $UnveilRoot 'chromium'
$ChromiumVersion = (Get-Content (Join-Path $UnveilChromium 'build/CHROMIUM_VERSION') -Raw).Trim()
$ChromiumSrc = if ($env:CHROMIUM_SRC) { $env:CHROMIUM_SRC } else { 'C:\src\chromium\src' }
$DepotTools = if ($env:DEPOT_TOOLS) { $env:DEPOT_TOOLS } else { 'C:\src\depot_tools' }
$UnveilProfile = if ($env:UNVEIL_PROFILE) { $env:UNVEIL_PROFILE } else { Join-Path $env:LOCALAPPDATA 'Unveil Dev' }

# depot_tools first on PATH, and the Visual Studio installed here rather than
# Google's internal toolchain package.
if (Test-Path $DepotTools) {
  $env:PATH = "$DepotTools;$env:PATH"
}
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'

function Invoke-Checked {
  # Runs a native command and stops on a non-zero exit code (PowerShell 5
  # doesn't, by itself). A plain function on purpose: with a param() block,
  # PowerShell would take the command's own flags (-o, -C...) for its
  # common parameters (-OutVariable...).
  $Command, $Arguments = $args
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Step([string]$Message) {
  Write-Host "`n== $Message" -ForegroundColor Cyan
}
