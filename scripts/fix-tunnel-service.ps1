#Requires -RunAsAdministrator
# Fix cloudflared Windows service by setting correct ImagePath with tunnel run arguments.

$ErrorActionPreference = "Continue"

$ServiceExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$SystemConfig = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"

Write-Host "`n=== Fix service ImagePath ===" -ForegroundColor Cyan

$newImagePath = "`"$ServiceExe`" --config `"$SystemConfig`" tunnel run"
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared" -Name ImagePath -Value $newImagePath

Write-Host "ImagePath set to:" -ForegroundColor Green
$actual = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared").ImagePath
Write-Host "  $actual"

Write-Host "`n=== Start service ===" -ForegroundColor Cyan

net stop cloudflared 2>$null
net start cloudflared

Write-Host "`n=== Verify ===" -ForegroundColor Cyan

$svc = sc.exe query cloudflared
$svc | ForEach-Object { Write-Host $_ }

if ($svc -match "RUNNING") {
    Write-Host "`ncloudflared service is RUNNING. Tunnel will auto-start on boot." -ForegroundColor Green
} else {
    Write-Host "`nWARNING: Service may not be running. Check the output above." -ForegroundColor Yellow
}
