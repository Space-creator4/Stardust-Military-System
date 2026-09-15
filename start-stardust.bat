@echo off
title Stardust Server
cd /d "%~dp0server"

rem --- Ensure the Cloudflare tunnel is running ---
set "CFP=C:\Program Files (x86)\cloudflared\cloudflared.exe"
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | find /I "cloudflared.exe" >nul
if errorlevel 1 (
    echo [Stardust] Starting Cloudflare tunnel...
    if exist "%CFP%" (
        start "cloudflared-stardust" /min "%CFP%" tunnel --config C:\Users\cassi\.cloudflared\config.yml --metrics 127.0.0.1:20243 run stardust
    ) else (
        start "cloudflared-stardust" /min cloudflared tunnel --config C:\Users\cassi\.cloudflared\config.yml --metrics 127.0.0.1:20243 run stardust
    )
) else (
    echo [Stardust] Cloudflare tunnel already running.
)

rem --- Free port 3000 from any existing process ---
echo [Stardust] Checking port 3000...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo [Stardust] Stopping existing process on port 3000 PID %%p.
    taskkill /F /PID %%p >nul 2>&1
)

rem --- Give the port a moment to be released ---
ping -n 1 -w 1000 127.0.0.1 >nul

rem --- Start the server ---
echo [Stardust] Starting server on port 3000...
node server.js
pause