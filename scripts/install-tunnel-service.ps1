#Requires -RunAsAdministrator
# Install cloudflared as a Windows service so the tunnel auto-starts on boot.

$ErrorActionPreference = "Stop"

$UserConfig = "C:\Users\pc\.cloudflared"
$SystemConfig = "C:\Windows\System32\config\systemprofile\.cloudflared"
$TunnelUUID = "7976ab5d-122c-4744-853c-51bc071cd468"

Write-Host "`n=== Step 17: Copy files to SYSTEM profile ===" -ForegroundColor Cyan

New-Item -ItemType Directory -Path $SystemConfig -Force | Out-Null

Copy-Item "$UserConfig\config.yml" "$SystemConfig\config.yml" -Force
Copy-Item "$UserConfig\$TunnelUUID.json" "$SystemConfig\$TunnelUUID.json" -Force
Copy-Item "$UserConfig\cert.pem" "$SystemConfig\cert.pem" -Force

Write-Host "Copied config.yml, credentials, and cert.pem to SYSTEM profile." -ForegroundColor Green

Write-Host "`n=== Step 18: Fix credentials path in SYSTEM config ===" -ForegroundColor Cyan

(Get-Content "$SystemConfig\config.yml") `
    -replace [regex]::Escape("C:\Users\pc"), "C:\Windows\System32\config\systemprofile" |
    Set-Content "$SystemConfig\config.yml"

Write-Host "Updated credentials-file path." -ForegroundColor Green

Write-Host "`n=== Step 19: Install & start service ===" -ForegroundColor Cyan

cloudflared service install
net start cloudflared

Write-Host "`n=== Step 20: Verify ===" -ForegroundColor Cyan

$svc = sc.exe query cloudflared
$svc | ForEach-Object { Write-Host $_ }

if ($svc -match "RUNNING") {
    Write-Host "`ncloudflared service is RUNNING. Tunnel will auto-start on boot." -ForegroundColor Green
} else {
    Write-Host "`nWARNING: Service may not be running. Check the output above." -ForegroundColor Yellow
}
