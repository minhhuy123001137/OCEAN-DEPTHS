@echo off
title OCEAN DEPTHS - 3D Showcase Server
echo ========================================================
echo   OCEAN DEPTHS - Dang khoi dong may chu 3D...
echo ========================================================
echo.

REM Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  set "PATH=C:\Program Files\nodejs;%PATH%"
)

REM Mo trinh duyet va khoi chay Vite
start http://localhost:5173
cmd.exe /c "npx vite --host 127.0.0.1 --port 5173"
pause
