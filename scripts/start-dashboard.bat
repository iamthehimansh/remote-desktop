@echo off
:: Start PC Dashboard (Next.js) and Terminal WebSocket server on login.
:: This script is called by Windows auto-login via Registry Run key.

cd /d H:\remote-desktop

:: Wait a few seconds for network to be ready
timeout /t 10 /nobreak >nul

:: Start Next.js dashboard on port 3005
start "PC Dashboard" /min cmd /c "cd /d H:\remote-desktop && bun run start"

:: Start WebSocket terminal server on port 3006
start "PC Terminal" /min cmd /c "cd /d H:\remote-desktop && npx tsx server/ws-server.ts"
