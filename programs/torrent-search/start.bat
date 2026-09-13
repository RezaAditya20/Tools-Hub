@echo off
title Torrent Search
cd /d "%~dp0"
echo Torrent Search - Auto-restart mode
echo Watching for changes in server.py, engines.py, and HTML...
echo Press Ctrl+C to stop.
echo.

REM Open browser only once on first start
set TS_OPEN_BROWSER=1

:restart
echo [%time%] Starting server...
start /b python server.py > nul 2>&1
timeout /t 2 /nobreak > nul

REM After first start, don't open browser again on restart
set TS_OPEN_BROWSER=0

REM Save initial timestamps
for %%f in (server.py engines.py "..\..\page\Torrent-Search.html") do (
    if exist "%%f" for %%i in ("%%f") do echo %%~ti > "%temp%\ts_old_%%~nxf" 2>nul
)

:watch
timeout /t 2 /nobreak > nul

REM Check file timestamps for changes
set "changed=0"
for %%f in (server.py engines.py "..\..\page\Torrent-Search.html") do (
    if exist "%%f" (
        for %%i in ("%%f") do (
            echo %%~ti > "%temp%\ts_new_%%~nxf"
            if exist "%temp%\ts_old_%%~nxf" (
                fc /b "%temp%\ts_old_%%~nxf" "%temp%\ts_new_%%~nxf" > nul 2>&1
                if %errorlevel% neq 0 (
                    set "changed=1"
                    echo [%time%] Change detected in %%f
                )
            )
            copy /y "%temp%\ts_new_%%~nxf" "%temp%\ts_old_%%~nxf" > nul 2>&1
        )
    )
)

if "%changed%"=="1" (
    echo [%time%] Restarting server...
    taskkill /f /im python.exe > nul 2>&1
    timeout /t 1 /nobreak > nul
    goto restart
)

goto watch
