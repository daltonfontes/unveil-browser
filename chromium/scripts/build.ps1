# The dev loop: apply.ps1, then a component build of out\Dev (chromium\build\dev.gn).
# Extra arguments go to autoninja.
#
#   chromium\scripts\build.ps1 [autoninja arguments...]
. (Join-Path $PSScriptRoot 'env.ps1')

& (Join-Path $PSScriptRoot 'apply.ps1')

$out = Join-Path $ChromiumSrc 'out/Dev'
New-Item -ItemType Directory -Force $out | Out-Null
$argsGn = Join-Path $out 'args.gn'
$wanted = Get-Content (Join-Path $UnveilChromium 'build/dev.gn') -Raw
if (-not (Test-Path $argsGn) -or (Get-Content $argsGn -Raw) -ne $wanted) {
  Set-Content -Path $argsGn -Value $wanted -NoNewline
}

Push-Location $ChromiumSrc
try {
  Step 'gn gen out\Dev'
  Invoke-Checked gn.bat gen out\Dev
  Step 'autoninja -C out\Dev chrome'
  Invoke-Checked autoninja.bat -C out\Dev chrome @args
} finally { Pop-Location }

Write-Host "`nBuilt. Start it with chromium\scripts\run.ps1"
