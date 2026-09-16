# ERP TIERI

Sistema ERP para minimarkets en Bolivia.

## Objetivo
Gestionar:
- usuarios
- productos
- inventario
- ventas
- caja
- compras
- proveedores
- clientes
- sincronizacion
- dashboard

## Estructura
- docs
- db
- app
- scripts
- logs


# ERP TIERI - DOCUMENTACIÓN DEL PROYECTO

## ?? INFORMACIÓN DE LA BASE DE DATOS

**Nombre de la base:** tieri_erp
**Servidor:** localhost (tu computadora)
**Puerto:** 5432
**Usuario:** postgres
**Contraseña:** admin123

## ?? USUARIO ADMINISTRADOR

**Usuario:** admin
**Contraseña:** admin123

## ?? TABLAS CREADAS (19 en total)

1. usuarios
2. roles
3. sucursales
4. configuracion
5. clientes
6. proveedores
7. categorias
8. productos
9. precios_productos
10. inventario
11. ventas
12. detalle_ventas
13. pagos
14. compras
15. detalle_compras
16. cajas
17. aperturas_caja
18. cierres_caja
19. auditoria

## ?? PRÓXIMOS PASOS

1. Crear proyecto C# en VS Code
2. Conectar con PostgreSQL
3. Crear interfaz LOGIN
4. Crear interfaz POS (Punto de Venta)
5. Crear interfaz CAJA
6. Crear interfaz de REPORTES

## ?? PROGRESO DEL PROYECTO

- Backend (Base de datos): 40% ?
- Frontend (App Visual): 0% ?
- Testing: 0% ?

## ?? COMANDOS ÚTILES PARA CONECTARSE

Para abrir PostgreSQL desde PowerShell:

```powershell
psql -U postgres -h localhost -d tieri_erp
