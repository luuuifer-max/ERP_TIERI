# ERP TIERI

Sistema ERP para minimarkets en Bolivia, con gestión de usuarios, sucursales, inventario, ventas, caja, compras, clientes, proveedores, cotizaciones y transferencias.

## Base de datos

El backend utiliza PostgreSQL. Los scripts para recrear la estructura, configurar permisos y preparar el acceso inicial están en [`db/`](./db/).

Consulta [`db/README.md`](./db/README.md) para crear la base de datos en otro ambiente. No se incluyen contraseñas: configura credenciales nuevas para PostgreSQL y crea el primer administrador siguiendo esos pasos.

## Estructura

- `app/backend`: API REST de Express y conexión con PostgreSQL.
- `app/frontend`: aplicación web React.
- `db`: scripts SQL y procedimiento de instalación de la base de datos.
- `docs`, `doc`: documentación del proyecto.
- `scripts`: utilidades del proyecto.
