@echo off
title Streaming Player Server
echo.
echo ==========================================
echo   Streaming Player + TorrServer Proxy
echo ==========================================
echo.
echo   Buka browser: http://localhost:8091
echo   Tekan Ctrl+C untuk stop
echo.
node "%~dp0streaming-server.js"
pause
