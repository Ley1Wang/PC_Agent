@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 24 or newer.
  pause
  exit /b 1
)
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  echo Built-in SQLite is unavailable. Please install Node.js 24 or newer.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
