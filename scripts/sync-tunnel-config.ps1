#Requires -RunAsAdministrator
# Sync cloudflared config from user profile to service locations and restart.

$ErrorActionPreference = "Continue"

$UserConfig = "C:\Users\pc\.cloudflared\config.yml"
$ServiceDir = "C:\Program Files (x86)\cloudflared"
$SystemDir = "C:\Windows\System32\config\systemprofile\.cloudflared"

Write-Host "=== Syncing tunnel config ===" -ForegroundColor Cyan

# Sync to Program Files
Copy-Item $UserConfig "$ServiceDir\config.yml" -Force
(Get-Content "$ServiceDir\config.yml") `
    -replace [regex]::Escape("C:\Users\pc\.cloudflared"), $ServiceDir |
    Set-Content "$ServiceDir\config.yml"
Write-Host "Synced to $ServiceDir" -ForegroundColor Green

# Sync to SYSTEM profile (this is what the service actually reads)
Copy-Item $UserConfig "$SystemDir\config.yml" -Force
(Get-Content "$SystemDir\config.yml") `
    -replace [regex]::Escape("C:\Users\pc\.cloudflared"), $SystemDir |
    Set-Content "$SystemDir\config.yml"
Write-Host "Synced to $SystemDir" -ForegroundColor Green

Write-Host "=== Restarting cloudflared ===" -ForegroundColor Cyan

net stop cloudflared 2>$null
Start-Sleep 2
net start cloudflared

sc.exe query cloudflared | Select-String "STATE"
