-- Ejecutar conectado a tieri_erp como tieri_app.
-- El backend agrega columnas idempotentes al iniciar; este archivo ya define
-- el esquema actual para que el primer arranque no dependa de esa inicialización.

GRANT USAGE, CREATE ON SCHEMA public TO tieri_app;

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  permisos JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sucursales (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  direccion VARCHAR(240) NOT NULL DEFAULT '',
  telefono VARCHAR(60) NOT NULL DEFAULT '',
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  usuario VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol_id INTEGER NOT NULL REFERENCES roles(id),
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  permisos JSONB NOT NULL DEFAULT '[]'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS proveedores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  empresa VARCHAR(150),
  telefono VARCHAR(50),
  productos_que_vende TEXT,
  ofrece_descuento BOOLEAN NOT NULL DEFAULT false,
  detalle_descuento TEXT,
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS clientes_erp (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  telefono VARCHAR(50) NOT NULL DEFAULT '',
  documento VARCHAR(50),
  email VARCHAR(120),
  direccion TEXT,
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  codigo_interno VARCHAR(40) UNIQUE,
  codigo_barras VARCHAR(80) UNIQUE,
  categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  nombre VARCHAR(240) NOT NULL,
  marca VARCHAR(120),
  unidad VARCHAR(80) NOT NULL DEFAULT 'Unidad',
  descripcion TEXT,
  imagen_url TEXT,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  activo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS precios_productos (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio_compra_actual NUMERIC(12,2) NOT NULL DEFAULT 0,
  precio_venta_actual NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_cambio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventario (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  stock_actual NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12,3) NOT NULL DEFAULT 0,
  ultima_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (producto_id, sucursal_id)
);

CREATE TABLE IF NOT EXISTS caja_sesiones (
  id SERIAL PRIMARY KEY,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  usuario_apertura_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha_apertura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_inicial_qr NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(20) NOT NULL DEFAULT 'abierta',
  fecha_cierre TIMESTAMP,
  usuario_cierre_id INTEGER REFERENCES usuarios(id),
  monto_esperado NUMERIC(12,2),
  monto_contado NUMERIC(12,2),
  diferencia NUMERIC(12,2),
  monto_esperado_qr NUMERIC(12,2),
  monto_contado_qr NUMERIC(12,2),
  diferencia_qr NUMERIC(12,2),
  observacion TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS caja_sesion_abierta_por_sucursal
  ON caja_sesiones (sucursal_id)
  WHERE estado = 'abierta';

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id SERIAL PRIMARY KEY,
  caja_id INTEGER NOT NULL REFERENCES caja_sesiones(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  metodo VARCHAR(30) NOT NULL DEFAULT 'EFECTIVO',
  concepto VARCHAR(180) NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas (
  id SERIAL PRIMARY KEY,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  cliente_id INTEGER REFERENCES clientes_erp(id) ON DELETE SET NULL,
  cliente_nombre VARCHAR(120),
  cliente_telefono VARCHAR(40),
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
  impuesto_porcentaje NUMERIC(8,2) NOT NULL DEFAULT 0,
  impuesto NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  caja_id INTEGER REFERENCES caja_sesiones(id) ON DELETE SET NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'completada'
);

CREATE TABLE IF NOT EXISTS detalle_ventas (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad NUMERIC(12,3) NOT NULL,
  cantidad_presentacion NUMERIC(12,3),
  presentacion_nombre VARCHAR(80),
  factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_unitario NUMERIC(12,4),
  costo_presentacion NUMERIC(12,2),
  descuento_asignado NUMERIC(12,2),
  ganancia_bruta NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS pagos (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  metodo VARCHAR(30) NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  referencia VARCHAR(180),
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devoluciones_ventas (
  id SERIAL PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  motivo TEXT NOT NULL,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  tipo VARCHAR(20) NOT NULL DEFAULT 'total',
  monto NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS devoluciones_ventas_detalle (
  id SERIAL PRIMARY KEY,
  devolucion_id INTEGER NOT NULL REFERENCES devoluciones_ventas(id) ON DELETE CASCADE,
  detalle_venta_id INTEGER NOT NULL REFERENCES detalle_ventas(id),
  cantidad_presentacion NUMERIC(12,3) NOT NULL CHECK (cantidad_presentacion > 0),
  cantidad_base NUMERIC(12,3) NOT NULL CHECK (cantidad_base > 0),
  monto NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS configuracion_tienda (
  sucursal_id INTEGER PRIMARY KEY REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL DEFAULT 'Tienda Tieri',
  direccion VARCHAR(240) NOT NULL DEFAULT '',
  telefono VARCHAR(60) NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compras_erp (
  id SERIAL PRIMARY KEY,
  proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  numero_factura VARCHAR(50),
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacion TEXT
);

CREATE TABLE IF NOT EXISTS producto_presentaciones (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre VARCHAR(80) NOT NULL,
  factor NUMERIC(12,4) NOT NULL CHECK (factor > 0),
  precio_venta NUMERIC(12,2) NOT NULL CHECK (precio_venta >= 0),
  costo NUMERIC,
  activo BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (producto_id, nombre)
);

CREATE TABLE IF NOT EXISTS detalle_compras_erp (
  id SERIAL PRIMARY KEY,
  compra_id INTEGER NOT NULL REFERENCES compras_erp(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  presentacion_id INTEGER REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
  cantidad_presentacion NUMERIC(12,2) NOT NULL,
  presentacion_nombre VARCHAR(80),
  factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1,
  cantidad NUMERIC(12,2) NOT NULL,
  costo_unitario NUMERIC(12,2) NOT NULL,
  costo_presentacion NUMERIC(12,2),
  descuento_presentacion NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS transferencias_stock (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  sucursal_origen_id INTEGER NOT NULL REFERENCES sucursales(id),
  sucursal_destino_id INTEGER NOT NULL REFERENCES sucursales(id),
  cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nota VARCHAR(255),
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transferencias_tickets (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  sucursal_origen_id INTEGER NOT NULL REFERENCES sucursales(id),
  sucursal_destino_id INTEGER NOT NULL REFERENCES sucursales(id),
  estado VARCHAR(30) NOT NULL DEFAULT 'en_transito'
    CHECK (estado IN ('en_transito', 'recibida', 'recibida_con_diferencia', 'anulada')),
  nota TEXT NOT NULL DEFAULT '',
  nota_recepcion TEXT NOT NULL DEFAULT '',
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  recibido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  anulado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_recepcion TIMESTAMP,
  fecha_anulacion TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transferencias_ticket_items (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES transferencias_tickets(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  cantidad_presentacion NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidades_sueltas NUMERIC(12,2) NOT NULL DEFAULT 0,
  presentacion_id INTEGER REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
  presentacion_nombre VARCHAR(80) NOT NULL DEFAULT 'Unidad',
  factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1,
  cantidad_recibida NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0)
);

CREATE INDEX IF NOT EXISTS transferencias_ticket_items_ticket_idx
  ON transferencias_ticket_items (ticket_id, id);

CREATE TABLE IF NOT EXISTS transferencias_ticket_recepciones (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES transferencias_tickets(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  nota TEXT NOT NULL DEFAULT '',
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transferencias_ticket_recepcion_items (
  id SERIAL PRIMARY KEY,
  recepcion_id INTEGER NOT NULL REFERENCES transferencias_ticket_recepciones(id) ON DELETE CASCADE,
  ticket_item_id INTEGER NOT NULL REFERENCES transferencias_ticket_items(id),
  cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS transferencias_tickets_ruta_fecha_idx
  ON transferencias_tickets (sucursal_origen_id, sucursal_destino_id, fecha DESC);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) NOT NULL UNIQUE,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  cliente_id INTEGER REFERENCES clientes_erp(id) ON DELETE SET NULL,
  cliente_nombre VARCHAR(160) NOT NULL DEFAULT '',
  cliente_telefono VARCHAR(60) NOT NULL DEFAULT '',
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  mostrar_detalle BOOLEAN NOT NULL DEFAULT true,
  estado VARCHAR(20) NOT NULL DEFAULT 'vigente',
  convertido_venta_id INTEGER REFERENCES ventas(id) ON DELETE SET NULL,
  observacion TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS detalle_cotizaciones (
  id SERIAL PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  nombre VARCHAR(240) NOT NULL,
  codigo VARCHAR(80) NOT NULL DEFAULT '',
  cantidad NUMERIC(12,3) NOT NULL,
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  presentacion_id INTEGER REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
  presentacion_nombre VARCHAR(80),
  factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS cotizaciones_fecha_idx
  ON cotizaciones (sucursal_id, fecha DESC);

CREATE INDEX IF NOT EXISTS usuarios_sucursal_idx ON usuarios (sucursal_id);
CREATE INDEX IF NOT EXISTS productos_nombre_idx ON productos (nombre);
CREATE INDEX IF NOT EXISTS precios_productos_historial_idx
  ON precios_productos (producto_id, fecha_cambio DESC, id DESC);
CREATE INDEX IF NOT EXISTS ventas_sucursal_fecha_idx
  ON ventas (sucursal_id, fecha DESC);
CREATE INDEX IF NOT EXISTS detalle_ventas_venta_idx
  ON detalle_ventas (venta_id);
CREATE INDEX IF NOT EXISTS pagos_venta_idx ON pagos (venta_id);
CREATE INDEX IF NOT EXISTS compras_sucursal_fecha_idx
  ON compras_erp (sucursal_id, fecha DESC);
