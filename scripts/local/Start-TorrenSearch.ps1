param(
    [switch]$Lan,
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8787 })
)

$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent (Split-Path -Parent $ScriptRoot)
$DataDir = Join-Path $Root '.data\torrensearch'
$HostName = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
$Url = "http://127.0.0.1:$Port"

Set-Location $Root
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

Write-Host "Starting TorrenSearch at $Url"
if ($Lan) {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -ExpandProperty IPAddress

    foreach ($address in $addresses) {
        Write-Host "Phone/LAN URL: http://$address`:$Port"
    }

    Write-Host "LAN mode binds to all network adapters. Use only on trusted networks."
}
Write-Host "Press Ctrl+C to stop."
Start-Process $Url
$env:HOST = $HostName
$env:PORT = [string]$Port
$env:DATA_DIR = $DataDir
node "$Root\server.js"
