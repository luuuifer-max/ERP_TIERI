@echo off
setlocal
set "ROOT=%~dp0"

echo Iniciando ERP Tieri - copia de pruebas...
start "ERP Tieri Backend (pruebas)" cmd /k "cd /d ""%ROOT%app\backend"" && node server.js"
start "ERP Tieri Frontend (pruebas)" cmd /k "cd /d ""%ROOT%app\frontend"" && npm run dev -- --host 127.0.0.1"

timeout /t 4 /nobreak >nul
start "" http://localhost:5173

echo Se abrio http://localhost:5173
echo No cierres las dos ventanas de consola mientras estes probando.
endlocal
