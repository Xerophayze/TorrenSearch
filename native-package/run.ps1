param(
    [switch]$NoVpn,
    [switch]$Lan
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $Root "app"
$DataRoot = Join-Path $Root "data"
$LogRoot = Join-Path $Root "logs"
$VpnRoot = Join-Path $Root "vpn"
Set-Location $Root

function Write-Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-PortOpen($Port) {
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } catch {
        return $false
    }
}

function Find-QbittorrentExe {
    $candidates = @(
        "$env:ProgramFiles\qBittorrent\qbittorrent.exe",
        "${env:ProgramFiles(x86)}\qBittorrent\qbittorrent.exe",
        "$env:LOCALAPPDATA\Programs\qBittorrent\qbittorrent.exe"
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Start-ServiceIfPresent($Name) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne "Running") {
        Start-Service -Name $Name
    }
}

New-Item -ItemType Directory -Force -Path $DataRoot, $LogRoot, $VpnRoot | Out-Null

if (-not (Test-Path (Join-Path $DataRoot "settings.json"))) {
    Copy-Item -LiteralPath (Join-Path $Root "settings.seed.json") -Destination (Join-Path $DataRoot "settings.json")
}

if (-not $NoVpn) {
    $vpnConfig = Get-ChildItem -LiteralPath $VpnRoot -Filter *.conf -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($vpnConfig) {
        $wgExe = "$env:ProgramFiles\WireGuard\wireguard.exe"
        if (Test-Path $wgExe) {
            Write-Step "Starting WireGuard tunnel from $($vpnConfig.Name)"
            $tunnelName = [IO.Path]::GetFileNameWithoutExtension($vpnConfig.Name)
            $existing = Get-Service -Name "WireGuardTunnel`$$tunnelName" -ErrorAction SilentlyContinue
            if (-not $existing) {
                Start-Process -FilePath $wgExe -ArgumentList "/installtunnelservice `"$($vpnConfig.FullName)`"" -Wait -Verb RunAs
            }
            Start-ServiceIfPresent "WireGuardTunnel`$$tunnelName"
        } else {
            Write-Warning "WireGuard is not installed. Run setup.bat or install WireGuard manually."
        }
    } else {
        Write-Warning "No AirVPN WireGuard .conf file found in vpn\. Continuing without starting VPN."
    }
}

Write-Step "Starting Prowlarr"
Start-ServiceIfPresent "Prowlarr"
if (-not (Test-PortOpen 9696)) {
    $prowlarrExe = Get-ChildItem "$env:ProgramFiles\Prowlarr" -Filter "Prowlarr.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($prowlarrExe) {
        Start-Process -FilePath $prowlarrExe.FullName -WorkingDirectory $prowlarrExe.DirectoryName
    }
}

Write-Step "Starting qBittorrent"
$qbExe = Find-QbittorrentExe
if ($qbExe -and -not (Get-Process qbittorrent -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $qbExe
} elseif (-not $qbExe) {
    Write-Warning "qBittorrent executable was not found. Run setup.bat or install qBittorrent manually."
}

Write-Step "Starting TorrenSearch backend"
if (-not (Test-Command "node")) {
    throw "Node.js was not found. Run setup.bat or install Node.js LTS manually."
}

if (-not (Test-PortOpen 8787)) {
    $hostName = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
    $env:HOST = $hostName
    $env:PORT = "8787"
    $env:DATA_DIR = $DataRoot
    $env:PROWLARR_FALLBACK_URLS = "http://127.0.0.1:9696,http://localhost:9696"
    $process = Start-Process -FilePath "node" `
        -ArgumentList "server.js" `
        -WorkingDirectory $AppRoot `
        -RedirectStandardOutput (Join-Path $LogRoot "torrensearch.out.log") `
        -RedirectStandardError (Join-Path $LogRoot "torrensearch.err.log") `
        -PassThru
    Set-Content -LiteralPath (Join-Path $DataRoot "torrensearch.pid") -Value $process.Id
}

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:8787" | Out-Null

Write-Host ""
Write-Host "TorrenSearch native stack is starting."
Write-Host "TorrenSearch: http://127.0.0.1:8787"
if ($Lan) {
    Write-Host "LAN URLs:"
    Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
        ForEach-Object { Write-Host "  http://$($_.IPAddress):8787" }
    Write-Host "If Windows Firewall asks, allow access on Private networks."
}
Write-Host "Prowlarr:     http://127.0.0.1:9696"
Write-Host "qBittorrent:  http://127.0.0.1:8080"
Write-Host ""
Write-Host "Logs: $LogRoot"
