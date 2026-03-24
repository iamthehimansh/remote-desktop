#Requires -RunAsAdministrator
# Register PC Dashboard to auto-start on login via Registry Run key.
# Also verifies Windows auto-login is configured.

$ErrorActionPreference = "Continue"

$StartScript = "H:\remote-desktop\scripts\start-dashboard.bat"

# ============================================================
# Register dashboard startup via Registry Run key
# ============================================================
Write-Host ""
Write-Host "=== Register dashboard auto-start ===" -ForegroundColor Cyan

$regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $regPath -Name "PCDashboard" -Value $StartScript
$val = (Get-ItemProperty -Path $regPath -Name "PCDashboard").PCDashboard
Write-Host "Registry Run key set: $val" -ForegroundColor Green

# ============================================================
# Verify Windows auto-login is configured
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
    Write-Host "Auto-login configured for user: pc" -ForegroundColor Green
    Write-Host "NOTE: Password is stored in registry in plain text. This is how Windows auto-login works." -ForegroundColor Yellow
}

# ============================================================
# Also register as a Scheduled Task (backup, runs even if login fails)
# ============================================================
Write-Host ""
Write-Host "=== Register scheduled task (backup) ===" -ForegroundColor Cyan

$taskName = "PCDashboardStartup"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed old scheduled task." -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction -Execute $StartScript
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "pc" -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Start PC Dashboard on boot"
Write-Host "Scheduled task '$taskName' registered." -ForegroundColor Green

# ============================================================
# Summary
# ============================================================
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "1. Registry Run key: PCDashboard -> $StartScript"
Write-Host "2. Scheduled Task: $taskName (runs at startup)"
Write-Host "3. Auto-login: user=pc"
Write-Host ""
Write-Host "On next boot: Windows auto-logs in -> start-dashboard.bat runs -> Next.js + Terminal server start" -ForegroundColor Green
Write-Host ""
