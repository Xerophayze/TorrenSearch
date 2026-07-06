param(
    [switch]$Lan,
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8787 })
)

$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent (Split-Path -Parent $ScriptRoot)
$ComposeFile = Join-Path $Root 'docker-compose.prowlarr.yml'
$DataRoot = Join-Path $Root '.data'
$TorrenSearchData = Join-Path $DataRoot 'torrensearch'
$ProwlarrConfig = Join-Path $DataRoot 'prowlarr'
$ProwlarrConfigXml = Join-Path $ProwlarrConfig 'config.xml'
$HostName = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
$Url = "http://127.0.0.1:$Port"

function Test-Command($Name) {
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-DockerCompose {
    param([string[]]$Arguments)

    if (Test-Command 'docker') {
        try {
            & docker compose version *> $null
            if ($LASTEXITCODE -eq 0) {
                & docker compose -f $ComposeFile @Arguments
                if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
                return
            }
        } catch {}
    }

    if (Test-Command 'docker-compose') {
        & docker-compose -f $ComposeFile @Arguments
        if ($LASTEXITCODE -ne 0) { throw "docker-compose failed with exit code $LASTEXITCODE" }
        return
    }

    throw "Docker Compose was not found. Install Docker Desktop, or run Start-TorrenSearch-Backend.bat for TorrenSearch only."
}

function Get-ProwlarrApiKey {
    if (!(Test-Path $ProwlarrConfigXml)) { return '' }
    try {
        [xml]$config = Get-Content $ProwlarrConfigXml
        return [string]$config.Config.ApiKey
    } catch {
        return ''
    }
}

function ConvertTo-Hashtable {
    param($Value)

    if ($null -eq $Value) { return $null }

    if ($Value -is [System.Collections.IDictionary]) {
        $result = @{}
        foreach ($key in $Value.Keys) {
            $result[$key] = ConvertTo-Hashtable $Value[$key]
        }
        return $result
    }

    if ($Value -is [pscustomobject]) {
        $result = @{}
        foreach ($property in $Value.PSObject.Properties) {
            $result[$property.Name] = ConvertTo-Hashtable $property.Value
        }
        return $result
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return @($Value | ForEach-Object { ConvertTo-Hashtable $_ })
    }

    return $Value
}

function Write-BackendSettings {
    param([string]$ApiKey)

    if (!$ApiKey) { return }

    New-Item -ItemType Directory -Force -Path $TorrenSearchData | Out-Null
    $settingsPath = Join-Path $TorrenSearchData 'settings.json'
    $settings = if (Test-Path $settingsPath) {
        try { ConvertTo-Hashtable (Get-Content -Raw $settingsPath | ConvertFrom-Json) } catch { @{} }
    } else {
        @{}
    }

    $enabled = if ($settings.enabledProviders -is [hashtable]) { $settings.enabledProviders } else { @{} }
    $enabled['prowlarr'] = $true

    $settings['mode'] = 'backend'
    $settings['proxyTemplate'] = "/proxy?url={url}"
    $settings['prowlarrUrl'] = 'http://127.0.0.1:9696'
    $settings['prowlarrKey'] = $ApiKey
    $settings['enabledProviders'] = $enabled
    if (!$settings.ContainsKey('sort')) { $settings['sort'] = 'seeders' }
    if (!$settings.ContainsKey('sortDirection')) { $settings['sortDirection'] = 'desc' }

    $settings | ConvertTo-Json -Depth 8 | Set-Content -Path $settingsPath -Encoding UTF8
}

Set-Location $Root
New-Item -ItemType Directory -Force -Path $TorrenSearchData, $ProwlarrConfig | Out-Null

if (!(Test-Command 'node')) {
    throw "Node.js was not found in PATH. Install Node.js 20+ or 22+."
}

Write-Host "Starting local Prowlarr with Docker Compose..."
Invoke-DockerCompose @('up', '-d')

$apiKey = ''
for ($i = 0; $i -lt 60; $i++) {
    $apiKey = Get-ProwlarrApiKey
    if ($apiKey) { break }
    Start-Sleep -Seconds 2
}

if ($apiKey) {
    Write-BackendSettings -ApiKey $apiKey
    Write-Host "Prowlarr API key found and saved to TorrenSearch backend settings."
} else {
    Write-Warning "Prowlarr started, but its API key was not available yet. Open http://127.0.0.1:9696 once, then restart this launcher."
}

Write-Host ""
Write-Host "Starting TorrenSearch at $Url"
Write-Host "Prowlarr URL: http://127.0.0.1:9696"
if ($Lan) {
    $addresses = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -ExpandProperty IPAddress

    foreach ($address in $addresses) {
        Write-Host "Phone/LAN URL: http://$address`:$Port"
    }
}
Write-Host "Press Ctrl+C to stop TorrenSearch. Prowlarr keeps running in Docker."

$env:HOST = $HostName
$env:PORT = [string]$Port
$env:DATA_DIR = $TorrenSearchData
$env:PROWLARR_FALLBACK_URLS = 'http://127.0.0.1:9696,http://localhost:9696'

Start-Process $Url
node "$Root\server.js"
