@echo off
setlocal enabledelayedexpansion
title VEXERO+ - Push to GitHub
cd /d "%~dp0"
set "REPO=https://github.com/ashif274899/VEXERO-.git"
set "BRANCH=main"

where git >nul 2>nul
if errorlevel 1 (
  echo  Git install nahi hai. Yaha se install karo: https://git-scm.com/download/win
  pause & exit /b 1
)

if not exist ".git" (
  echo  [1/5] Git repo bana raha hu...
  git init -b %BRANCH% >nul 2>nul || (git init >nul & git checkout -b %BRANCH%)
)
git branch -M %BRANCH%

git remote get-url origin >nul 2>nul
if errorlevel 1 (git remote add origin %REPO%) else (git remote set-url origin %REPO%)

rem Safety: movies / data / config kabhi push nahi honge (.gitignore me hai)
git config user.name >nul 2>nul || git config user.name "ashif274899"
git config user.email >nul 2>nul || git config user.email "ashif274899@users.noreply.github.com"

echo  [2/5] Files add kar raha hu...
git add -A

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update %date% %time:~0,5%"
echo  [3/5] Commit: %MSG%
git commit -m "%MSG%" >nul 2>nul
if errorlevel 1 echo        (koi naya change nahi, bas push check kar raha hu)

echo  [4/5] GitHub par push ho raha hai...
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo  Push fail hua. Shayad GitHub repo me pehle se kuch files hain. Merge karke dobara try kar raha hu...
  git pull origin %BRANCH% --allow-unrelated-histories --no-edit -X ours
  git push -u origin %BRANCH%
)
if errorlevel 1 (
  echo.
  echo  Abhi bhi fail. Check karo: GitHub login ho gaya? Repo ka naam sahi hai? Internet chal raha hai?
  echo  Agar GitHub ki purani files ki zaroorat nahi, to force push kar sakte ho:
  set /p F="  Force push karu? (y/n): "
  if /i "!F!"=="y" git push -u origin %BRANCH% --force
)

echo.
echo  [5/5] Done. Repo: %REPO%
pause
