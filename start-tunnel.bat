@echo off
title Stardust Cloudflare Tunnel
cd /d "%~dp0"

set "CFP=C:\Program Files (x86)\cloudflared\cloudflared.exe"

rem --- Stop any existing stardust tunnel instance (the one using metrics port 20243) ---
echo [Stardust] Checking for an existing tunnel...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr "127.0.0.1:20243 " ^| findstr "LISTENING"') do (
    echo [Stardust] Stopping existing tunnel PID %%p.
    taskkill /F /PID %%p >nul 2>&1
)

rem --- Give the port a moment to be released ---
ping -n 1 -w 1000 127.0.0.1 >nul

echo [Stardust] Starting Cloudflare tunnel...
if exist "%CFP%" (
    "%CFP%" tunnel --config "C:\Users\cassi\.cloudflared\config.yml" --metrics 127.0.0.1:20243 run stardust
) else (
    cloudflared tunnel --config "C:\Users\cassi\.cloudflared\config.yml" --metrics 127.0.0.1:20243 run stardust
)
pause