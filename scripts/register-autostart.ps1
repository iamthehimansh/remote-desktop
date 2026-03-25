#Requires -RunAsAdministrator
# Register PC Dashboard to auto-start on login with admin privileges.
# Uses Scheduled Task (runs elevated without UAC prompt).

$ErrorActionPreference = "Continue"

$StartScript = "H:\remote-desktop\scripts\start-dashboard.bat"

# ============================================================
# Remove old Registry Run key (replaced by Scheduled Task)
# ============================================================
Write-Host ""
Write-Host "=== Removing old Registry Run key ===" -ForegroundColor Cyan
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "PCDashboard" -ErrorAction SilentlyContinue
Write-Host "Old registry key removed." -ForegroundColor Green

# ============================================================
# Register as Scheduled Task with HIGHEST privileges (no UAC)
# ============================================================
Write-Host ""
Write-Host "=== Register elevated startup task ===" -ForegroundColor Cyan

$taskName = "PCDashboardStartup"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StartScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "pc"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId "pc" -RunLevel Highest -LogonType Interactive

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Start PC Dashboard with admin privileges on login"

Write-Host "Scheduled task '$taskName' registered with HIGHEST privileges." -ForegroundColor Green

# ============================================================
# Verify Windows auto-login
# ============================================================
Write-Host ""
Write-Host "=== Verify Windows auto-login ===" -ForegroundColor Cyan

$autoLoginPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
$autoLogin = (Get-ItemProperty -Path $autoLoginPath -Name "AutoAdminLogon" -ErrorAction SilentlyContinue).AutoAdminLogon
$defaultUser = (Get-ItemProperty -Path $autoLoginPath -Name "DefaultUserName" -ErrorAction SilentlyContinue).DefaultUserName

if ($autoLogin -eq "1") {
    Write-Host "Auto-login is ON for user: $defaultUser" -ForegroundColor Green
} else {
    Write-Host "Auto-login is NOT configured. Setting it up..." -ForegroundColor Yellow
    $user = Read-Host "Enter Windows username"
    $pass = Read-Host "Enter Windows password" -AsSecureString
    $plainPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
    Set-ItemProperty -Path $autoLoginPath -Name "AutoAdminLogon" -Value "1"
    Set-ItemProperty -Path $autoLoginPath -Name "DefaultUserName" -Value $user
    Set-ItemProperty -Path $autoLoginPath -Name "DefaultPassword" -Value $plainPass
    Write-Host "Auto-login configured for user: $user" -ForegroundColor Green
}

# ============================================================
# Summary
# ============================================================
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Scheduled Task: $taskName (runs elevated at logon)"
Write-Host "Script: $StartScript"
Write-Host ""
Write-Host "On boot: Windows auto-logs in -> Task runs elevated -> Dashboard + Terminal start as admin" -ForegroundColor Green
Write-Host ""
