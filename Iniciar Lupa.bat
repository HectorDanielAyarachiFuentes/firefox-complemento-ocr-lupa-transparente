@echo off
rem Abre Lupa (doble clic). Instala las dependencias la primera vez si faltan.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando dependencias, espera un momento...
  call npm install || (echo Error instalando dependencias. & pause & exit /b 1)
)
taskkill /F /IM electron.exe >nul 2>&1
start "" "node_modules\electron\dist\electron.exe" .
