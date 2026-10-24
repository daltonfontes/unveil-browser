# Publishes dist\ as GitHub release v<version> (package.json), with the GitHub
# CLI (gh). Run after build-release.ps1, from a commit that is pushed.
. (Join-Path $PSScriptRoot 'env.ps1')

$version = (Get-Content (Join-Path $UnveilRoot 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $UnveilRoot 'dist'
$files = @(Get-ChildItem $dist -Filter "Unveil-$version-*").FullName + (Join-Path $dist 'SHA256SUMS.txt')
if ($files.Count -lt 3) { throw "No Unveil $version packages in $($dist): run build-release.ps1 first" }

Invoke-Checked gh release create "v$version" @files --title "Unveil $version" --generate-notes `
  --notes "Chromium $ChromiumVersion"
