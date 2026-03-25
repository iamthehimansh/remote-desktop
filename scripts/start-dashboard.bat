@echo off
:: Start PC Dashboard (Next.js) and Terminal WebSocket server on login.
:: Runs elevated so terminal admin mode and service management work.

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    :: Re-launch self as admin silently
    powershell -WindowStyle Hidden -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs -WindowStyle Hidden"
    exit /b
)

cd /d H:\remote-desktop

:: Wait for network to be ready
timeout /t 10 /nobreak >nul

:: Ensure cloudflared service uses remote config (no --config flag)
powershell -Command "Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared' -Name ImagePath -Value '\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" tunnel run'" 2>nul

:: Build if .next doesn't exist
if not exist ".next\BUILD_ID" (
    call bun run build
)

:: Start Next.js dashboard on port 3005
start "PC Dashboard" /min cmd /c "cd /d H:\remote-desktop && bun run start"

:: Start WebSocket terminal server on port 3006
start "PC Terminal" /min cmd /c "cd /d H:\remote-desktop && node --import tsx server/ws-server.ts"
