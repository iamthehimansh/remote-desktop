@echo off
:: Start PC Dashboard (Next.js) and Terminal WebSocket server on login.

cd /d H:\remote-desktop

:: Wait for network to be ready
timeout /t 10 /nobreak >nul

:: Ensure cloudflared service uses remote config (no --config flag)
:: This requires admin, so elevate just for this one command
powershell -Command "Start-Process powershell -ArgumentList '-Command', 'Set-ItemProperty -Path \"HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared\" -Name ImagePath -Value \"\`\"C:\Program Files (x86)\cloudflared\cloudflared.exe\`\" tunnel run\"' -Verb RunAs -WindowStyle Hidden" 2>nul

:: Start Next.js dashboard on port 3005
start "PC Dashboard" /min cmd /c "cd /d H:\remote-desktop && bun run start"

:: Start WebSocket terminal server on port 3006
start "PC Terminal" /min cmd /c "cd /d H:\remote-desktop && node --import tsx server/ws-server.ts"
