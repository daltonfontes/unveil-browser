# Packages out\Release into dist\:
#   Unveil-<version>-x64-installer.exe   the installer (per user, %LOCALAPPDATA%\Unveil)
#   Unveil-<version>-x64.zip             the same files, to unzip and run
#   SHA256SUMS.txt
# The zip comes from the installer's own archive (chrome.7z), so both carry
# exactly the same files. Needs 7-Zip.
. (Join-Path $PSScriptRoot 'env.ps1')

$version = (Get-Content (Join-Path $UnveilRoot 'package.json') -Raw | ConvertFrom-Json).version
$out = Join-Path $ChromiumSrc 'out/Release'
$dist = Join-Path $UnveilRoot 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

$sevenZip = @((Get-Command 7z.exe -ErrorAction SilentlyContinue).Source, "$env:ProgramFiles\7-Zip\7z.exe") |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $sevenZip) { throw '7-Zip not found: install it from https://www.7-zip.org' }

$installer = Join-Path $dist "Unveil-$version-x64-installer.exe"
Copy-Item (Join-Path $out 'mini_installer.exe') $installer

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "unveil-package-$PID"
try {
  Invoke-Checked $sevenZip x (Join-Path $out 'chrome.7z') "-o$tmp" -y
  # chrome.7z holds Chrome-bin\: chrome.exe, initial_preferences and the
  # version folder, as the installer lays them out.
  $folder = Join-Path $tmp 'Unveil'
  Rename-Item (Join-Path $tmp 'Chrome-bin') $folder
  $zip = Join-Path $dist "Unveil-$version-x64.zip"
  if (Test-Path $zip) { Remove-Item $zip }
  Compress-Archive -Path $folder -DestinationPath $zip
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

Get-ChildItem $dist -Filter "Unveil-$version-*" | ForEach-Object {
  "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
} | Set-Content (Join-Path $dist 'SHA256SUMS.txt')

Write-Host "`nPackaged Unveil $version in $dist"
Get-Content (Join-Path $dist 'SHA256SUMS.txt')
