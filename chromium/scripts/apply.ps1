# Puts Unveil on top of the Chromium checkout: branding files, our patches,
# then Chromium renamed to Unveil in the UI strings (rebrand.mjs).
# Safe to run again: on a git checkout it first undoes a previous run.
. (Join-Path $PSScriptRoot 'env.ps1')

$theme = 'chrome/app/theme'
$strings = @('chrome/app/chromium_strings.grd', 'chrome/app/settings_chromium_strings.grdp', 'chrome/app/resources')
$patches = Get-ChildItem (Join-Path $UnveilChromium 'patches') -Filter *.patch | Sort-Object Name

Push-Location $ChromiumSrc
try {
  # The source tarball (win\fetch-tarball.ps1) isn't a git checkout, so it
  # can't be undone: it is applied once (fetch-tarball.ps1 unpacks a fresh
  # source after a version change).
  $isGit = Test-Path '.git'
  if (-not $isGit -and (Test-Path '.unveil-applied')) {
    Write-Host "Unveil is already applied to $ChromiumSrc"
    return
  }
  if ($isGit) {
    # Undo a previous run: patches last first, then the files we copy over.
    foreach ($patch in ($patches | Sort-Object Name -Descending)) {
      # A patch that isn't applied fails this check, which is expected: keep
      # PowerShell from treating git's stderr as an error.
      $ErrorActionPreference = 'Continue'
      & git apply --reverse --check $patch.FullName 2>$null
      $applied = $LASTEXITCODE -eq 0
      $ErrorActionPreference = 'Stop'
      if ($applied) { Invoke-Checked git apply --reverse $patch.FullName }
    }
    Invoke-Checked git checkout -- "$theme/chromium" "$theme/default_100_percent/chromium" "$theme/default_200_percent/chromium" @strings
  }

  $branding = Join-Path $UnveilChromium 'branding'
  Copy-Item (Join-Path $branding 'BRANDING') "$theme/chromium/BRANDING"
  Copy-Item (Join-Path $branding 'logo/*.png') "$theme/chromium/"
  Copy-Item (Join-Path $branding 'win/chromium.ico') "$theme/chromium/win/"
  Copy-Item (Join-Path $branding 'win/tiles/*.png') "$theme/chromium/win/tiles/"
  foreach ($scale in 'default_100_percent', 'default_200_percent') {
    Copy-Item (Join-Path $branding "$scale/chromium/*.png") "$theme/$scale/chromium/"
  }

  foreach ($patch in $patches) {
    Write-Host "patch: $($patch.Name)"
    Invoke-Checked git apply $patch.FullName
  }

  Invoke-Checked node (Join-Path $PSScriptRoot 'rebrand.mjs') $ChromiumSrc
  if (-not $isGit) { New-Item -ItemType File '.unveil-applied' | Out-Null }
} finally { Pop-Location }

Write-Host "Unveil applied to $ChromiumSrc"
