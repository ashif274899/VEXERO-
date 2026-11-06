@echo off
setlocal
title VEXERO+ Local Admin (sirf is PC par)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js install nahi hai: https://nodejs.org & pause & exit /b 1)
if not exist media-node\node-config.json (echo Pehle START-MEDIA-NODE.bat se node-config.json bharo. & pause & exit /b 1)
set ADMIN_LOCAL=1
start "" http://localhost:3030/admin
node server.js
pause
