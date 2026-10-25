# One stage of the CI build (.github/workflows/build.yml). A GitHub runner
# stops a job after 6 hours and the build takes longer, so each stage builds
# for up to UNVEIL_BUILD_TIMEOUT seconds and the next one carries on from the
# saved build tree. Writes status=running or status=done to $GITHUB_OUTPUT;
# when done, it also packages the build into dist\.
. (Join-Path $PSScriptRoot '../env.ps1')

& (Join-Path $PSScriptRoot 'fetch-tarball.ps1')
& (Join-Path $PSScriptRoot 'ensure-sdk.ps1')

$status = 'done'
try {
  & (Join-Path $PSScriptRoot '../build-release.ps1') -NoPackage
} catch {
  if ($_.Exception.Message -notmatch 'timed out') { throw }
  Write-Host "The build ran out of this stage's time; the next stage carries on."
  $status = 'running'
}

if ($status -eq 'done') { & (Join-Path $PSScriptRoot '../package-release.ps1') }
Add-Content -Path $env:GITHUB_OUTPUT -Value "status=$status"
