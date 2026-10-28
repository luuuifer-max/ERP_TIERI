# ERP TIERI — paquete para revisión

Este ZIP contiene el código fuente del proyecto ERP TIERI para revisión y depuración.

## Estructura
- `app/backend/` — API Node.js/Express y conexión PostgreSQL.
- `app/frontend/` — aplicación React/Vite.
- `logs/` — logs disponibles del proyecto.
- `ERP_TIERI_Excel_Prueba_Importacion.xlsx` — archivo de prueba/importación del proyecto.
- `INICIAR_ERP_GPT.bat` — script de inicio incluido en el proyecto.

## Importante
- Se excluyeron `.git/`, `node_modules/`, `dist/`, `build/`, `.vite/`, cachés y `coverage/` para reducir el tamaño y evitar archivos generados innecesarios.
- El archivo real `app/backend/.env` NO está incluido por seguridad. Se agregó `app/backend/.env.example` con las variables esperadas, sin valores secretos.
- Los `package.json` y `package-lock.json` sí están incluidos para poder reconstruir las dependencias.

## Objetivo de la revisión
Revisar el proyecto completo respetando su estado actual, localizar errores reales en el código y proponer/corregir cambios únicamente cuando estén sustentados por el código existente. No asumir que una solución anterior ya aplicada debe repetirse.
