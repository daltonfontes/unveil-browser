# Installs the Windows SDK version the Chromium source asks for
# (SDK_VERSION in build/vs_toolchain.py), with its Debugging Tools (Chromium
# ships their dbghelp.dll), if this machine doesn't have it. CI runners come
# with Visual Studio but often with another SDK. Needs administrator rights.
#
#   chromium\scripts\win\ensure-sdk.ps1
. (Join-Path $PSScriptRoot '../env.ps1')

$wanted = (Select-String -Path (Join-Path $ChromiumSrc 'build/vs_toolchain.py') -Pattern "^SDK_VERSION = '([0-9.]+)'").Matches[0].Groups[1].Value
$kits = "${env:ProgramFiles(x86)}\Windows Kits\10"
$have = {
  (Test-Path "$kits\Include\$wanted\um\windows.h") -and (Test-Path "$kits\Debuggers\x64\dbghelp.dll")
}
if (& $have) {
  Write-Host "Windows SDK $wanted is installed."
  return
}

Step "Windows SDK $wanted"
$build = $wanted.Split('.')[2]
# winget's package for that SDK, with every feature (/features +): the
# Debugging Tools aren't in the default set.
$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
if ($winget) {
  & $winget.Source install --id "Microsoft.WindowsSDK.10.0.$build" --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity --override '/features + /quiet /norestart /ceip off'
}
if (-not (& $have)) {
  # Else Visual Studio's own component for it.
  $installer = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vs_installer.exe"
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $vs = & $vswhere -latest -property installationPath
  if ((Test-Path $installer) -and $vs) {
    $proc = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList @(
      'modify', '--installPath', "`"$vs`"", '--add', "Microsoft.VisualStudio.Component.Windows11SDK.$build",
      '--quiet', '--norestart', '--nocache')
    Write-Host "vs_installer exited with $($proc.ExitCode)"
  }
}
if (-not (& $have)) {
  throw "Couldn't install Windows SDK $wanted with its Debugging Tools: install it from https://developer.microsoft.com/windows/downloads/windows-sdk/"
}
Write-Host "Windows SDK $wanted is installed."
