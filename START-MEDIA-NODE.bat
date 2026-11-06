@echo off
title VEXERO+ PC Media Node
cd /d "%~dp0media-node"
if not exist node-config.json (
  copy node-config.example.json node-config.json >nul
  echo node-config.json bana diya. Usme RENDER_URL, API_KEY, MOVIES_DIR bhar ke dobara chalao.
  notepad node-config.json
  exit /b
)
node media-node.js
pause
