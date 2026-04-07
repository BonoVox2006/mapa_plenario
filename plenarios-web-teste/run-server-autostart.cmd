@echo off
setlocal
set "DIR=%~dp0"

REM Garante que a porta 5174 não fica presa de execuções anteriores.
set "LOG=%DIR%autostart.log"
echo [%date% %time%] Iniciando servidor... >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%kill-port.ps1" >> "%LOG%" 2>&1
set "KILLEL=%errorlevel%"
echo [%date% %time%] kill-port exit code: %KILLEL% >> "%LOG%"

if not "%KILLEL%"=="0" (
  echo [%date% %time%] Nao foi possivel liberar a porta 5174. Server nao sera iniciado. >> "%LOG%"
  exit /b %KILLEL%
)

REM Inicia o servidor (PowerShell).
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%start-server.ps1" >> "%LOG%" 2>&1

