@echo off
setlocal
title VEXERO+ Server
cd /d "%~dp0"
echo.
echo  ==============================================
echo    V E X E R O +   -   LOCAL STREAMING SERVER
echo  ==============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Get the LTS from https://nodejs.org/
  pause
  exit /b 1
)
start "" http://localhost:3030
node server.js
echo.
echo  VEXERO+ has stopped.
pause
