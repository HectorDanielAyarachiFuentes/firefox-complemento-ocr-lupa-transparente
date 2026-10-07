@echo off
rem Abre Lupa mostrando el registro en esta consola (para diagnosticar problemas).
rem Usa el modo sin aceleracion grafica por si la GPU no dibuja la ventana transparente.
cd /d "%~dp0"
taskkill /F /IM electron.exe >nul 2>&1
set LUPA_DEBUG=1
echo Abriendo Lupa en modo diagnostico... (no cierres esta ventana)
echo.
"node_modules\electron\dist\electron.exe" . --disable-gpu
echo.
echo Lupa se cerro (codigo %ERRORLEVEL%). Copia el texto de arriba si hubo errores.
pause
