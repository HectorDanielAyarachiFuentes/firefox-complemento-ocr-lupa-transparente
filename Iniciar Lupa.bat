@echo off
rem Inicia la extension Lupa OCR Transparente en Mozilla Firefox con recarga automatica (web-ext)
cd /d "%~dp0"

echo ===================================================
echo   Lupa OCR Transparente - Modo Desarrollo Firefox  
echo ===================================================
echo.
echo Iniciando Firefox con la extension cargada...
echo Cualquier cambio en los archivos recargara la extension en vivo.
echo.

npx web-ext run
if %ERRORLEVEL% neq 0 (
  echo.
  echo Hubo un error al ejecutar web-ext.
  echo Asegurate de tener Mozilla Firefox instalado.
  pause
)
