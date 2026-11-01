param([Parameter(Mandatory=$true)][string]$Runtime, [string]$ListenAddress = '127.0.0.1')
$ErrorActionPreference = 'Stop'
$voiceRoot = (Resolve-Path -LiteralPath $Runtime).Path
$voiceLaunch = Get-Content -LiteralPath (Join-Path $voiceRoot 'launcher.local.json') -Raw | ConvertFrom-Json
& $voiceLaunch.python (Join-Path $PSScriptRoot 'voice-studio-gateway.py') --studio $voiceLaunch.studio --runtime $voiceRoot --host $ListenAddress
exit $LASTEXITCODE
