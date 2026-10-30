param([string]$Serial = '', [string]$Workspace = $PSScriptRoot, [string]$Adb = '', [string]$Python = '')
$ErrorActionPreference = 'Stop'
if (!$Adb) {
    $candidate = Join-Path $PSScriptRoot '../research/android/toolchain/platform-tools/adb.exe'
    $Adb = if (Test-Path -LiteralPath $candidate) { (Resolve-Path -LiteralPath $candidate).Path } else { (Get-Command adb -ErrorAction Stop).Source }
}
if (!$Python) {
    $candidate = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    $Python = if (Test-Path -LiteralPath $candidate) { $candidate } else { (Get-Command python -ErrorAction Stop).Source }
}
if (!$Serial) {
    $devices = @(& $Adb devices | Select-Object -Skip 1 | ForEach-Object { if ($_ -match '^(\S+)\s+device$') { $Matches[1] } })
    if ($devices.Count -ne 1) { throw '请连接并授权一台安卓设备，或使用 -Serial 指定设备。' }
    $Serial = $devices[0]
}
& $Python (Join-Path $PSScriptRoot 'tools/android-codex-worker.py') --serial $Serial --workspace $Workspace --adb $Adb
exit $LASTEXITCODE
