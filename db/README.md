# Scripts de base de datos

El ERP utiliza PostgreSQL. Estos archivos permiten crear una base vacía, preparar los roles/permisos que reconoce la aplicación y crear de forma segura su primer usuario administrador. Los scripts no incluyen datos reales ni contraseñas predeterminadas.

## Requisitos

- PostgreSQL y el cliente `psql`.
- Dependencias instaladas en `app/backend` (`npm install`).
- Copiar `app/backend/.env.example` a `app/backend/.env` y configurar allí las credenciales de conexión del backend. No reutilices contraseñas de desarrollo.

## Instalación en Windows

Ejecuta estos pasos desde la raíz del proyecto, en PowerShell:

1. Crear el rol de conexión de la aplicación:

   ```powershell
   psql -U postgres -h localhost -d postgres -f .\db\00_crear_rol_postgres.sql
   ```

2. Asignar una contraseña propia al rol, sin guardarla en el repositorio:

   ```powershell
   psql -U postgres -h localhost -d postgres
   ```

   En la consola de `psql`, ejecuta `\password tieri_app` y sigue las indicaciones; luego sal con `\q`.

3. Crear la base de datos. El comando requiere permisos de administrador y debe ejecutarse una sola vez:

   ```powershell
   psql -U postgres -h localhost -d postgres -f .\db\01_crear_base.sql
   ```

4. Configurar `app/backend/.env` con el usuario `tieri_app`, la contraseña que asignaste, el nombre `tieri_erp` y el host/puerto del servidor PostgreSQL.

5. Crear las tablas e índices con el mismo usuario que usará el backend. Este paso es importante porque el backend aplica cambios idempotentes de esquema al iniciar:

   ```powershell
   psql -U tieri_app -h localhost -d tieri_erp -f .\db\02_esquema.sql
   psql -U tieri_app -h localhost -d tieri_erp -f .\db\03_datos_iniciales.sql
   ```

6. Instalar dependencias del backend si todavía no lo están:

   ```powershell
   Set-Location .\app\backend
   npm install
   Set-Location ..\..
   ```

7. Crear el usuario administrador inicial con una contraseña nueva. No introduzcas la contraseña en el código ni la guardes en `.env`:

   ```powershell
   $env:INITIAL_ADMIN_NAME = "Administrador principal"
   $env:INITIAL_ADMIN_USERNAME = "admin"
   $securePassword = Read-Host "Contraseña inicial (mínimo 12 caracteres)" -AsSecureString
   $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
   try {
     $env:INITIAL_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
     node .\db\crear_admin_inicial.js
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
     Remove-Item Env:\INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
     Remove-Item Env:\INITIAL_ADMIN_NAME -ErrorAction SilentlyContinue
     Remove-Item Env:\INITIAL_ADMIN_USERNAME -ErrorAction SilentlyContinue
   }
   ```

El script rechaza contraseñas de menos de 12 caracteres, almacena únicamente su hash bcrypt y se detiene si ya existe ese usuario. Inicia el backend después de completar la configuración.

## Archivos

- `00_crear_rol_postgres.sql`: crea `tieri_app` sin privilegios de superusuario y sin contraseña incorporada.
- `01_crear_base.sql`: crea `tieri_erp`, propiedad de `tieri_app`.
- `02_esquema.sql`: crea tablas, relaciones, restricciones e índices de los módulos del ERP.
- `03_datos_iniciales.sql`: registra los roles/permisos predeterminados y una sucursal inicial.
- `crear_admin_inicial.js`: crea el usuario dueño con contraseña suministrada al ejecutar el script.

Los roles de aplicación (`Dueño`, `Cajero`, `Vendedor de calle` y `Encargado de almacén`) y sus permisos son distintos del rol de conexión PostgreSQL `tieri_app`. Los permisos de la aplicación se guardan como listas JSONB en las tablas `roles` y `usuarios`.
