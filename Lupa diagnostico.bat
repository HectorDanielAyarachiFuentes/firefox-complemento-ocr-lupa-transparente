@echo off
rem Modo diagnostico y validacion de compatibilidad para Mozilla Firefox
cd /d "%~dp0"

echo ===================================================
echo   Diagnostico de Extension para Mozilla Firefox    
echo ===================================================
echo.
echo 1. Validando manifest y estructura con web-ext lint...
call npx web-ext lint
echo.
echo 2. Iniciando Firefox en modo verbose/diagnostico...
call npx web-ext run --verbose

echo.
echo Firefox se cerro. Revisa los mensajes anteriores si hubo advertencias.
pause
