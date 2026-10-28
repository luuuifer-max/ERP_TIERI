-- Ejecutar conectado a tieri_erp como tieri_app.
-- Define roles/permisos y una sucursal inicial, pero no crea contraseñas.

INSERT INTO roles (id, nombre, permisos) VALUES
  (1, 'Dueño', '["ventas.ver","inventario.ver","inventario.crear","inventario.editar","inventario.solo_propios","inventario.transferir","compras.ver","compras.crear","precios.compra.ver","cotizaciones.ver","cotizaciones.crear","cotizaciones.eliminar","caja.ver","reportes.ver","clientes.ver","proveedores.ver"]'::jsonb),
  (2, 'Cajero', '["ventas.ver","inventario.ver","cotizaciones.ver","cotizaciones.crear","caja.ver"]'::jsonb),
  (3, 'Vendedor de calle', '["inventario.ver","cotizaciones.ver","cotizaciones.crear"]'::jsonb),
  (4, 'Encargado de almacén', '["inventario.ver","inventario.crear","inventario.editar","inventario.transferir","compras.ver","compras.crear","precios.compra.ver","proveedores.ver"]'::jsonb)
ON CONFLICT (id) DO UPDATE
SET nombre = EXCLUDED.nombre,
    permisos = EXCLUDED.permisos;

SELECT setval(
  pg_get_serial_sequence('roles', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM roles), 1),
  true
);

INSERT INTO sucursales (id, nombre, direccion, telefono, activo)
VALUES (1, 'Sucursal Principal', '', '', true)
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('sucursales', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM sucursales), 1),
  true
);

INSERT INTO configuracion_tienda (sucursal_id)
VALUES (1)
ON CONFLICT (sucursal_id) DO NOTHING;
