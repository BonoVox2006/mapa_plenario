@echo off
setlocal
set "DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%start-server.ps1"
echo.
echo (Se apareceu algum erro acima, copie/cole pra eu ajustar.)
pause
