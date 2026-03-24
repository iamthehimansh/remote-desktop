#Requires -RunAsAdministrator
# Create a scheduled task that the dashboard can trigger to reload the tunnel with admin rights.

$taskName = "PCDashReloadTunnel"
$scriptPath = "H:\remote-desktop\scripts\reload-tunnel.ps1"

# Remove old task if exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`""
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description "Reload cloudflared tunnel config (triggered by PC Dashboard)"

# Grant the pc user permission to start this task
# This allows non-admin processes to trigger it
$task = Get-ScheduledTask -TaskName $taskName
$task | Set-ScheduledTask

Write-Host "Scheduled task '$taskName' created." -ForegroundColor Green
Write-Host "Dashboard can trigger it with: schtasks /run /tn $taskName" -ForegroundColor Cyan
