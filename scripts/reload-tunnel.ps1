# Called by the dashboard to sync config and restart cloudflared.
param([string]$ConfigSource = "C:\Users\pc\.cloudflared\config.yml")

$ServiceDir = "C:\Program Files (x86)\cloudflared"
$SystemDir = "C:\Windows\System32\config\systemprofile\.cloudflared"

# Validate config before doing anything
$configContent = Get-Content $ConfigSource -Raw
if (-not ($configContent -match "ingress:") -or -not ($configContent -match "http_status:404")) {
    Write-Error "Invalid config - missing ingress rules or catch-all"
    exit 1
}

# Sync to both locations
Copy-Item $ConfigSource "$ServiceDir\config.yml" -Force
(Get-Content "$ServiceDir\config.yml") -replace [regex]::Escape("C:\Users\pc\.cloudflared"), $ServiceDir | Set-Content "$ServiceDir\config.yml"

Copy-Item $ConfigSource "$SystemDir\config.yml" -Force
(Get-Content "$SystemDir\config.yml") -replace [regex]::Escape("C:\Users\pc\.cloudflared"), $SystemDir | Set-Content "$SystemDir\config.yml"

# Restart service with retry
net stop cloudflared 2>$null
Start-Sleep 3

$retries = 3
for ($i = 1; $i -le $retries; $i++) {
    net start cloudflared 2>$null
    Start-Sleep 2
    $svc = sc.exe query cloudflared 2>$null
    if ($svc -match "RUNNING") {
        Write-Host "cloudflared restarted successfully"
        exit 0
    }
    Write-Host "Retry $i/$retries..."
    Start-Sleep 2
}

Write-Error "Failed to restart cloudflared after $retries attempts"
exit 1
