#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "=== Step 40: SSH skipped (installing separately) ===" -ForegroundColor Yellow

Write-Host ""
Write-Host "=== Step 41: Enable RDP ===" -ForegroundColor Cyan
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name "UserAuthentication" -Value 1
$rdp = (Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections
if ($rdp -eq 0) {
    Write-Host "RDP enabled with NLA." -ForegroundColor Green
} else {
    Write-Host "WARNING: RDP may not be enabled." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 42: Docker Desktop ===" -ForegroundColor Cyan
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    $dv = docker --version
    Write-Host "Docker already installed: $dv" -ForegroundColor Green
} else {
    Write-Host "Installing Docker Desktop via winget..." -ForegroundColor Yellow
    winget install Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    Write-Host "Docker Desktop installed. RESTART your PC, then open Docker Desktop." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 43: Pull Guacamole images ===" -ForegroundColor Cyan
docker info 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    docker pull guacamole/guacd
    docker pull guacamole/guacamole
    Write-Host "Guacamole images pulled." -ForegroundColor Green
} else {
    Write-Host "Docker not running. Pull images later." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 44: VS Build Tools ===" -ForegroundColor Cyan
$vsPath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsPath) {
    $vs = & $vsPath -latest -property displayName 2>$null
    Write-Host "Already installed: $vs" -ForegroundColor Green
} else {
    Write-Host "Installing Visual Studio 2022 Build Tools via winget..." -ForegroundColor Yellow
    winget install Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements
    Write-Host "Build Tools installed. Ensure Desktop development with C++ is checked." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 45: Bun ===" -ForegroundColor Cyan
$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bun) {
    $bv = bun --version
    Write-Host "Bun already installed: $bv" -ForegroundColor Green
} else {
    Write-Host "Installing Bun..." -ForegroundColor Yellow
    irm bun.sh/install.ps1 | iex
    Write-Host "Bun installed." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Step 46: GPU check ===" -ForegroundColor Cyan
$nvsmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvsmi) {
    $gpu = nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null
    Write-Host "GPU: $gpu" -ForegroundColor Green
} else {
    Write-Host "nvidia-smi not found. Update NVIDIA drivers." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$sshSvc = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshSvc) { Write-Host "SSH:    $($sshSvc.Status)" } else { Write-Host "SSH:    Not installed" }
if ($rdp -eq 0) { Write-Host "RDP:    Enabled" } else { Write-Host "RDP:    Not enabled" }
if ($docker) { Write-Host "Docker: Installed" } else { Write-Host "Docker: Not found" }
$bunCheck = Get-Command bun -ErrorAction SilentlyContinue
if ($bunCheck) { Write-Host "Bun:    Installed" } else { Write-Host "Bun:    Not found" }
if ($nvsmi) { Write-Host "GPU:    OK" } else { Write-Host "GPU:    Not found" }
Write-Host ""
