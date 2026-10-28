require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false
});

const autenticar = (req, res, next) => {
  const cabecera = req.headers.authorization || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, mensaje: 'Sesión requerida' });
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, mensaje: 'La sesión no es válida o ha expirado' });
  }
};

const esAdministrador = (usuario) => [1, '1'].includes(usuario?.rol_id) || ['admin', 'administrador', 'dueño', 'dueno', 'gerente general'].includes(String(usuario?.rol || '').toLowerCase());
const esDueno = (usuario) => [1, '1'].includes(usuario?.rol_id) || ['dueño', 'dueno', 'propietario'].includes(String(usuario?.rol || '').toLowerCase());
const puedeAutorizarDescuento = (usuario) => esDueno(usuario) || ['jefe', 'supervisor', 'gerente', 'gerente general'].includes(String(usuario?.rol || '').toLowerCase());
const tienePermiso = (usuario, permiso) => esDueno(usuario) || (Array.isArray(usuario?.permisos) && usuario.permisos.includes(permiso));
const validarSucursal = (usuario, sucursalId) => esAdministrador(usuario) || Number(usuario?.sucursal_id) === Number(sucursalId);
const CAJA_MAX_HORAS = 24;
const cajaExpirada = (fechaApertura) => Date.now() - new Date(fechaApertura).getTime() >= CAJA_MAX_HORAS * 60 * 60 * 1000;
const puedeOperarCaja = (usuario) => esAdministrador(usuario) || tienePermiso(usuario, 'caja.ver');
// Un usuario con el permiso 'inventario.solo_propios' solo puede editar/deshabilitar los productos que él mismo creó.
// Si no tiene ese permiso pero sí 'inventario.editar', puede editar cualquier producto (comportamiento anterior).
// Marca si el usuario puede editar cada producto y oculta el precio de compra a quien no tenga el permiso 'precios.compra.ver'.
const formatearProductos = (filas, usuario) => {
  const puedeVerCompra = esDueno(usuario) || tienePermiso(usuario, 'precios.compra.ver');
  return filas.map((fila) => {
    const producto = { ...fila, puede_editar: puedeEditarProducto(usuario, fila.creado_por) };
    if (!puedeVerCompra) {
      delete producto.precio_compra_actual;
      if (Array.isArray(producto.presentaciones)) producto.presentaciones = producto.presentaciones.map(({ costo, ...resto }) => resto);
    }
    return producto;
  });
};
const puedeEditarProducto = (usuario, creadoPor) => {
  if (esDueno(usuario)) return true;
  if (!tienePermiso(usuario, 'inventario.editar')) return false;
  if (Array.isArray(usuario?.permisos) && usuario.permisos.includes('inventario.solo_propios')) {
    return creadoPor != null && Number(creadoPor) === Number(usuario?.id);
  }
  return true;
};

const normalizarPresentaciones = (presentaciones, unidad, precioVenta, precioCompra) => {
  const origen = Array.isArray(presentaciones) && presentaciones.length
    ? presentaciones
    : [{ nombre: unidad || 'Unidad', factor: 1, precio_venta: precioVenta }];
  const nombres = new Set();
  return origen.map((item) => {
    const nombre = String(item?.nombre || '').trim();
    const factor = Number(item?.factor);
    const precio = Number(item?.precio_venta);
    if (!nombre || !Number.isFinite(factor) || factor <= 0 || !Number.isFinite(precio) || precio < 0) {
      throw new Error('Cada presentación debe tener nombre, cantidad y precio de venta válidos');
    }
    const clave = nombre.toLowerCase();
    if (nombres.has(clave)) throw new Error('No puede repetir el nombre de una presentación');
    nombres.add(clave);
    // El costo de cada presentación se puede anotar a mano (no siempre es proporcional, por
    // descuentos de compra al por mayor, etc.). Si no se especifica, se sugiere de forma
    // proporcional al precio de compra base, pero eso es solo un valor por defecto.
    const costoManual = Number(item?.costo);
    const costo = Number.isFinite(costoManual) && costoManual >= 0 ? costoManual : Number(precioCompra || 0) * factor;
    return { nombre, factor, precio, costo };
  });
};

const guardarPresentaciones = async (client, productoId, presentaciones, unidad, precioVenta, precioCompra) => {
  const items = normalizarPresentaciones(presentaciones, unidad, precioVenta, precioCompra);
  await client.query('DELETE FROM producto_presentaciones WHERE producto_id = $1', [productoId]);
  for (const item of items) {
    await client.query(
      'INSERT INTO producto_presentaciones (producto_id, nombre, factor, precio_venta, costo, activo) VALUES ($1,$2,$3,$4,$5,true)',
      [productoId, item.nombre, item.factor, item.precio, item.costo]
    );
  }
  return items;
};

const soloAdministradores = (req, res, next) => {
  if (!esAdministrador(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permisos de administración' });
  next();
};

const inicializarTablasCaja = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caja_sesiones (
      id SERIAL PRIMARY KEY,
      sucursal_id INTEGER NOT NULL,
      usuario_apertura_id INTEGER NOT NULL,
      fecha_apertura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      monto_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
      monto_inicial_qr NUMERIC(12,2) NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL DEFAULT 'abierta',
      fecha_cierre TIMESTAMP,
      usuario_cierre_id INTEGER,
      monto_esperado NUMERIC(12,2),
      monto_contado NUMERIC(12,2),
      diferencia NUMERIC(12,2),
      monto_esperado_qr NUMERIC(12,2),
      monto_contado_qr NUMERIC(12,2),
      diferencia_qr NUMERIC(12,2),
      observacion TEXT
    );

    ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS monto_inicial_qr NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS monto_esperado_qr NUMERIC(12,2);
    ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS monto_contado_qr NUMERIC(12,2);
    ALTER TABLE caja_sesiones ADD COLUMN IF NOT EXISTS diferencia_qr NUMERIC(12,2);

    CREATE UNIQUE INDEX IF NOT EXISTS caja_sesion_abierta_por_sucursal
      ON caja_sesiones (sucursal_id) WHERE estado = 'abierta';

    CREATE TABLE IF NOT EXISTS caja_movimientos (
      id SERIAL PRIMARY KEY,
      caja_id INTEGER NOT NULL REFERENCES caja_sesiones(id),
      usuario_id INTEGER NOT NULL,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
      metodo VARCHAR(30) NOT NULL DEFAULT 'EFECTIVO',
      concepto VARCHAR(180) NOT NULL,
      monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS caja_id INTEGER;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS impuesto_porcentaje NUMERIC(8,2) NOT NULL DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS impuesto NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(120);
    ALTER TABLE ventas ADD COLUMN IF NOT EXISTS cliente_telefono VARCHAR(40);
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url TEXT;

    CREATE TABLE IF NOT EXISTS devoluciones_ventas (
      id SERIAL PRIMARY KEY,
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      usuario_id INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE devoluciones_ventas ADD COLUMN IF NOT EXISTS codigo VARCHAR(40);
    ALTER TABLE devoluciones_ventas ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'total';
    ALTER TABLE devoluciones_ventas ADD COLUMN IF NOT EXISTS monto NUMERIC(12,2) NOT NULL DEFAULT 0;
    UPDATE devoluciones_ventas SET codigo = 'DEV-' || LPAD(id::text, 8, '0') WHERE codigo IS NULL;
    ALTER TABLE devoluciones_ventas ALTER COLUMN codigo SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS devoluciones_ventas_codigo_idx ON devoluciones_ventas (codigo);

    CREATE TABLE IF NOT EXISTS devoluciones_ventas_detalle (
      id SERIAL PRIMARY KEY,
      devolucion_id INTEGER NOT NULL REFERENCES devoluciones_ventas(id) ON DELETE CASCADE,
      detalle_venta_id INTEGER NOT NULL REFERENCES detalle_ventas(id),
      cantidad_presentacion NUMERIC(12,3) NOT NULL CHECK (cantidad_presentacion > 0),
      cantidad_base NUMERIC(12,3) NOT NULL CHECK (cantidad_base > 0),
      monto NUMERIC(12,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS configuracion_tienda (
      sucursal_id INTEGER PRIMARY KEY,
      nombre VARCHAR(160) NOT NULL DEFAULT 'Tienda Tieri',
      direccion VARCHAR(240) NOT NULL DEFAULT '',
      telefono VARCHAR(60) NOT NULL DEFAULT '',
      logo TEXT NOT NULL DEFAULT '',
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cotizaciones (
      id SERIAL PRIMARY KEY,
      codigo VARCHAR(30) UNIQUE NOT NULL,
      sucursal_id INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      cliente_id INTEGER,
      cliente_nombre VARCHAR(160) NOT NULL DEFAULT '',
      cliente_telefono VARCHAR(60) NOT NULL DEFAULT '',
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      mostrar_detalle BOOLEAN NOT NULL DEFAULT true,
      estado VARCHAR(20) NOT NULL DEFAULT 'vigente',
      convertido_venta_id INTEGER,
      observacion TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS detalle_cotizaciones (
      id SERIAL PRIMARY KEY,
      cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
      producto_id INTEGER,
      nombre VARCHAR(240) NOT NULL,
      codigo VARCHAR(80) NOT NULL DEFAULT '',
      cantidad NUMERIC(12,3) NOT NULL,
      precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0
    );
    ALTER TABLE detalle_cotizaciones ADD COLUMN IF NOT EXISTS presentacion_id INTEGER;
    ALTER TABLE detalle_cotizaciones ADD COLUMN IF NOT EXISTS presentacion_nombre VARCHAR(80);
    ALTER TABLE detalle_cotizaciones ADD COLUMN IF NOT EXISTS factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1;

    CREATE INDEX IF NOT EXISTS cotizaciones_fecha_idx ON cotizaciones (sucursal_id, fecha DESC);

    ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE roles ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS creado_por INTEGER;
    ALTER TABLE producto_presentaciones ADD COLUMN IF NOT EXISTS costo NUMERIC;

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

    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS empresa VARCHAR(150);
    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);
    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS productos_que_vende TEXT;
    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ofrece_descuento BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS detalle_descuento TEXT;
    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

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

    CREATE TABLE IF NOT EXISTS compras_erp (
      id SERIAL PRIMARY KEY,
      proveedor_id INTEGER REFERENCES proveedores(id),
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      numero_factura VARCHAR(50),
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      observacion TEXT
    );

    CREATE TABLE IF NOT EXISTS detalle_compras_erp (
      id SERIAL PRIMARY KEY,
      compra_id INTEGER NOT NULL REFERENCES compras_erp(id) ON DELETE CASCADE,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      cantidad_presentacion NUMERIC(12,2) NOT NULL,
      presentacion_nombre VARCHAR(80),
      factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1,
      cantidad NUMERIC(12,2) NOT NULL,
      costo_unitario NUMERIC(12,2) NOT NULL,
      subtotal NUMERIC(12,2) NOT NULL
    );
    ALTER TABLE detalle_compras_erp ADD COLUMN IF NOT EXISTS costo_presentacion NUMERIC(12,2);
    ALTER TABLE detalle_compras_erp ADD COLUMN IF NOT EXISTS descuento_presentacion NUMERIC(12,2) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS producto_presentaciones (
      id SERIAL PRIMARY KEY,
      producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      nombre VARCHAR(80) NOT NULL,
      factor NUMERIC(12,4) NOT NULL CHECK (factor > 0),
      precio_venta NUMERIC(12,2) NOT NULL CHECK (precio_venta >= 0),
      activo BOOLEAN NOT NULL DEFAULT true,
      UNIQUE (producto_id, nombre)
    );

    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS presentacion_nombre VARCHAR(80);
    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12,4);
    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS costo_presentacion NUMERIC(12,2);
    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS descuento_asignado NUMERIC(12,2);
    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS ganancia_bruta NUMERIC(12,2);

    CREATE TABLE IF NOT EXISTS transferencias_stock (
      id SERIAL PRIMARY KEY,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      sucursal_origen_id INTEGER NOT NULL REFERENCES sucursales(id),
      sucursal_destino_id INTEGER NOT NULL REFERENCES sucursales(id),
      cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
      usuario_id INTEGER REFERENCES usuarios(id),
      nota VARCHAR(255),
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transferencias_tickets (
      id SERIAL PRIMARY KEY,
      codigo VARCHAR(40) UNIQUE NOT NULL,
      sucursal_origen_id INTEGER NOT NULL REFERENCES sucursales(id),
      sucursal_destino_id INTEGER NOT NULL REFERENCES sucursales(id),
      estado VARCHAR(30) NOT NULL DEFAULT 'en_transito' CHECK (estado IN ('en_transito', 'recibida', 'recibida_con_diferencia', 'anulada')),
      nota TEXT NOT NULL DEFAULT '',
      nota_recepcion TEXT NOT NULL DEFAULT '',
      usuario_id INTEGER REFERENCES usuarios(id),
      recibido_por INTEGER REFERENCES usuarios(id),
      anulado_por INTEGER REFERENCES usuarios(id),
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
      presentacion_id INTEGER,
      presentacion_nombre VARCHAR(80) NOT NULL DEFAULT 'Unidad',
      factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1,
      cantidad_recibida NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0)
    );
    CREATE INDEX IF NOT EXISTS transferencias_ticket_items_ticket_idx
      ON transferencias_ticket_items (ticket_id, id);
    CREATE TABLE IF NOT EXISTS transferencias_ticket_recepciones (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES transferencias_tickets(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id),
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
    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS factor_presentacion NUMERIC(12,4) NOT NULL DEFAULT 1;
    ALTER TABLE detalle_ventas ADD COLUMN IF NOT EXISTS cantidad_presentacion NUMERIC(12,3);
    ALTER TABLE detalle_compras_erp ADD COLUMN IF NOT EXISTS presentacion_id INTEGER;
  `);
};

// =====================================
// SALUD DEL SERVIDOR
// =====================================

app.get('/api/salud', async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT current_database() AS base, current_user AS usuario'
    );

    res.json({
      ok: true,
      mensaje: 'Servidor ERP funcionando',
      base: resultado.rows[0].base,
      usuario_bd: resultado.rows[0].usuario
    });

  } catch (error) {
    console.error('ERROR SALUD:', error.message);

    res.status(500).json({
      ok: false,
      mensaje: 'Error conectando con PostgreSQL'
    });
  }
});

// =====================================
// LOGIN
// =====================================

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, password, sucursal_id: sucursalSolicitada } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Usuario y contraseña son obligatorios'
      });
    }

    const resultado = await pool.query(
      `
      SELECT
        u.id,
        u.nombre,
        u.usuario,
        u.password_hash,
        u.rol_id,
        u.sucursal_id,
        u.activo,
        u.permisos,
        r.nombre AS rol
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE u.usuario = $1
      `,
      [usuario]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contraseña incorrectos'
      });
    }

    const user = resultado.rows[0];

    if (!user.activo) {
      return res.status(403).json({
        ok: false,
        mensaje: 'El usuario está desactivado'
      });
    }

    const passwordCorrecta = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordCorrecta) {
      return res.status(401).json({
        ok: false,
        mensaje: 'Usuario o contraseña incorrectos'
      });
    }

    const sucursalId = esDueno({ rol_id: user.rol_id, rol: user.rol }) && sucursalSolicitada
      ? Number(sucursalSolicitada)
      : user.sucursal_id;
    if (!sucursalId) return res.status(409).json({ ok: false, mensaje: 'El usuario no tiene una sucursal asignada' });
    const sucursal = await pool.query('SELECT id, nombre FROM sucursales WHERE id = $1 AND activo = true', [sucursalId]);
    if (!sucursal.rows.length) return res.status(400).json({ ok: false, mensaje: 'La sucursal seleccionada no está disponible' });

    const token = jwt.sign(
      {
        id: user.id,
        usuario: user.usuario,
        rol_id: user.rol_id,
        rol: user.rol,
        sucursal_id: sucursalId,
        permisos: user.permisos || []
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '8h'
      }
    );

    res.json({
      ok: true,
      mensaje: 'Inicio de sesión correcto',
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        usuario: user.usuario,
        rol_id: user.rol_id,
        rol: user.rol,
        sucursal_id: sucursalId,
        sucursal_nombre: sucursal.rows[0].nombre,
        permisos: user.permisos || []
      }
    });

  } catch (error) {
    console.error('ERROR LOGIN:', error.message);

    res.status(500).json({
      ok: false,
      mensaje: 'Error interno del servidor'
    });
  }
});

app.post('/api/sesion/sucursal', autenticar, async (req, res) => {
  try {
    if (!esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño puede cambiar de sucursal' });
    const sucursalId = Number(req.body.sucursal_id);
    const sucursal = await pool.query('SELECT id, nombre FROM sucursales WHERE id = $1 AND activo = true', [sucursalId]);
    if (!sucursal.rows.length) return res.status(400).json({ ok: false, mensaje: 'La sucursal seleccionada no está disponible' });
    const token = jwt.sign({ ...req.usuario, sucursal_id: sucursalId }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ ok: true, token, sucursal: sucursal.rows[0] });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

// =====================================
// ADMINISTRACION MULTISUCURSAL
// =====================================

app.get('/api/sucursales', autenticar, async (req, res) => {
  try {
    const filtro = esAdministrador(req.usuario) ? '' : 'WHERE s.id = $1';
    const parametros = esAdministrador(req.usuario) ? [] : [req.usuario.sucursal_id];
    const resultado = await pool.query(`SELECT s.id, s.nombre, s.direccion, s.telefono, s.activo, COUNT(DISTINCT u.id)::integer AS usuarios, COALESCE(SUM(i.stock_actual), 0) AS unidades_stock FROM sucursales s LEFT JOIN usuarios u ON u.sucursal_id = s.id LEFT JOIN inventario i ON i.sucursal_id = s.id ${filtro} GROUP BY s.id ORDER BY s.id`, parametros);
    res.json({ ok: true, sucursales: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/sucursales', autenticar, soloAdministradores, async (req, res) => {
  try {
    const { nombre, direccion = '', telefono = '' } = req.body;
    if (!nombre?.trim()) throw new Error('El nombre de la sucursal es obligatorio');
    const resultado = await pool.query('INSERT INTO sucursales (nombre, direccion, telefono, activo) VALUES ($1,$2,$3,true) RETURNING id, nombre, direccion, telefono, activo', [nombre.trim(), direccion.trim(), telefono.trim()]);
    res.status(201).json({ ok: true, sucursal: resultado.rows[0], mensaje: 'Sucursal creada correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.put('/api/sucursales/:id', autenticar, soloAdministradores, async (req, res) => {
  try {
    const { nombre, direccion = '', telefono = '' } = req.body;
    if (!nombre?.trim()) throw new Error('El nombre de la sucursal es obligatorio');
    const resultado = await pool.query('UPDATE sucursales SET nombre = $1, direccion = $2, telefono = $3 WHERE id = $4 RETURNING id, nombre, direccion, telefono, activo', [nombre.trim(), direccion.trim(), telefono.trim(), Number(req.params.id)]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Sucursal no encontrada' });
    res.json({ ok: true, sucursal: resultado.rows[0], mensaje: 'Sucursal actualizada correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.patch('/api/sucursales/:id/estado', autenticar, soloAdministradores, async (req, res) => {
  try {
    const resultado = await pool.query('UPDATE sucursales SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo', [Boolean(req.body.activo), Number(req.params.id)]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Sucursal no encontrada' });
    res.json({ ok: true, sucursal: resultado.rows[0] });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/usuarios', autenticar, soloAdministradores, async (req, res) => {
  try {
    const resultado = await pool.query(`SELECT u.id, u.nombre, u.usuario, u.rol_id, r.nombre AS rol, u.sucursal_id, s.nombre AS sucursal_nombre, u.activo, u.permisos FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id LEFT JOIN sucursales s ON s.id = u.sucursal_id ORDER BY u.nombre`);
    res.json({ ok: true, usuarios: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/roles', autenticar, soloAdministradores, async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre, permisos FROM roles ORDER BY id');
    res.json({ ok: true, roles: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/roles', autenticar, soloAdministradores, async (req, res) => {
  try {
    if (!esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño puede crear roles' });
    const { nombre, permisos = [] } = req.body;
    if (!nombre?.trim()) throw new Error('El nombre del rol es obligatorio');
    const permisosValidos = Array.isArray(permisos) ? permisos.filter((permiso) => typeof permiso === 'string') : [];
    const resultado = await pool.query('INSERT INTO roles (nombre, permisos) VALUES ($1,$2) RETURNING id, nombre, permisos', [nombre.trim(), JSON.stringify(permisosValidos)]);
    res.status(201).json({ ok: true, rol: resultado.rows[0], mensaje: 'Rol creado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.code === '23505' ? 'Ya existe un rol con ese nombre' : error.message });
  }
});

app.put('/api/roles/:id', autenticar, soloAdministradores, async (req, res) => {
  try {
    if (!esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño puede editar roles' });
    const { nombre, permisos = [] } = req.body;
    if (!nombre?.trim()) throw new Error('El nombre del rol es obligatorio');
    const permisosValidos = Array.isArray(permisos) ? permisos.filter((permiso) => typeof permiso === 'string') : [];
    const resultado = await pool.query('UPDATE roles SET nombre = $1, permisos = $2 WHERE id = $3 RETURNING id, nombre, permisos', [nombre.trim(), JSON.stringify(permisosValidos), Number(req.params.id)]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Rol no encontrado' });
    res.json({ ok: true, rol: resultado.rows[0], mensaje: 'Rol actualizado correctamente. Los usuarios que ya tenían permisos personalizados no se ven afectados; los nuevos usuarios de este rol partirán de estos permisos.' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.delete('/api/roles/:id', autenticar, soloAdministradores, async (req, res) => {
  try {
    if (!esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño puede eliminar roles' });
    const rolId = Number(req.params.id);
    if ([1, '1'].includes(rolId)) return res.status(400).json({ ok: false, mensaje: 'No puedes eliminar el rol de administrador/dueño' });
    const enUso = await pool.query('SELECT COUNT(*)::integer AS total FROM usuarios WHERE rol_id = $1', [rolId]);
    if (enUso.rows[0].total > 0) return res.status(400).json({ ok: false, mensaje: `No puedes eliminar este rol: ${enUso.rows[0].total} usuario(s) todavía lo tienen asignado. Cámbiales el rol primero.` });
    const resultado = await pool.query('DELETE FROM roles WHERE id = $1 RETURNING id', [rolId]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Rol no encontrado' });
    res.json({ ok: true, mensaje: 'Rol eliminado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/usuarios', autenticar, soloAdministradores, async (req, res) => {
  try {
    if (!esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño puede crear usuarios' });
    const { nombre, usuario, password, rol_id, sucursal_id, permisos } = req.body;
    if (!nombre?.trim() || !usuario?.trim() || !password || !rol_id || !sucursal_id) throw new Error('Nombre, usuario, contraseña, rol y sucursal son obligatorios');
    const hash = await bcrypt.hash(password, 10);
    const sucursal = await pool.query('SELECT id FROM sucursales WHERE id = $1 AND activo = true', [Number(sucursal_id)]);
    if (!sucursal.rows.length) throw new Error('La sucursal no existe o está inactiva');
    // Si no se especifican permisos manualmente, el usuario nuevo hereda los permisos por defecto de su rol.
    let permisosValidos;
    if (Array.isArray(permisos)) {
      permisosValidos = permisos.filter((permiso) => typeof permiso === 'string');
    } else {
      const rolPlantilla = await pool.query('SELECT permisos FROM roles WHERE id = $1', [Number(rol_id)]);
      permisosValidos = rolPlantilla.rows[0]?.permisos || [];
    }
    const resultado = await pool.query('INSERT INTO usuarios (nombre, usuario, password_hash, rol_id, sucursal_id, permisos, activo) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id, nombre, usuario, rol_id, sucursal_id, permisos, activo', [nombre.trim(), usuario.trim(), hash, Number(rol_id), Number(sucursal_id), JSON.stringify(permisosValidos)]);
    res.status(201).json({ ok: true, usuario: resultado.rows[0], mensaje: 'Usuario creado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.code === '23505' ? 'El nombre de usuario ya existe' : error.message });
  }
});

app.put('/api/usuarios/:id', autenticar, soloAdministradores, async (req, res) => {
  try {
    if (!esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño puede editar usuarios' });
    const usuarioId = Number(req.params.id);
    const { nombre, rol_id, sucursal_id, permisos = [], password } = req.body;
    if (!nombre?.trim() || !rol_id || !sucursal_id) throw new Error('Nombre, rol y sucursal son obligatorios');
    const sucursal = await pool.query('SELECT id FROM sucursales WHERE id = $1 AND activo = true', [Number(sucursal_id)]);
    if (!sucursal.rows.length) throw new Error('La sucursal no existe o está inactiva');
    const permisosValidos = Array.isArray(permisos) ? permisos.filter((permiso) => typeof permiso === 'string') : [];
    let resultado;
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password, 10);
      resultado = await pool.query('UPDATE usuarios SET nombre = $1, rol_id = $2, sucursal_id = $3, permisos = $4, password_hash = $5 WHERE id = $6 RETURNING id, nombre, usuario, rol_id, sucursal_id, permisos, activo', [nombre.trim(), Number(rol_id), Number(sucursal_id), JSON.stringify(permisosValidos), hash, usuarioId]);
    } else {
      resultado = await pool.query('UPDATE usuarios SET nombre = $1, rol_id = $2, sucursal_id = $3, permisos = $4 WHERE id = $5 RETURNING id, nombre, usuario, rol_id, sucursal_id, permisos, activo', [nombre.trim(), Number(rol_id), Number(sucursal_id), JSON.stringify(permisosValidos), usuarioId]);
    }
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
    res.json({ ok: true, usuario: resultado.rows[0], mensaje: 'Usuario actualizado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.patch('/api/usuarios/:id/estado', autenticar, soloAdministradores, async (req, res) => {
  try {
    const resultado = await pool.query('UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, usuario, activo', [Boolean(req.body.activo), Number(req.params.id)]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado' });
    res.json({ ok: true, usuario: resultado.rows[0] });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

// =====================================
// PRODUCTOS
// =====================================

app.get('/api/configuracion', async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id)
    const resultado = await pool.query(
      `INSERT INTO configuracion_tienda (sucursal_id)
       VALUES ($1) ON CONFLICT (sucursal_id) DO NOTHING
       RETURNING sucursal_id, nombre, direccion, telefono, logo`,
      [sucursalId]
    )
    if (resultado.rows.length) return res.json({ ok: true, configuracion: resultado.rows[0] })
    const existente = await pool.query(
      'SELECT sucursal_id, nombre, direccion, telefono, logo FROM configuracion_tienda WHERE sucursal_id = $1',
      [sucursalId]
    )
    res.json({ ok: true, configuracion: existente.rows[0] })
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message })
  }
})

app.put('/api/configuracion', async (req, res) => {
  try {
    const { sucursal_id, nombre, direccion = '', telefono = '', logo = '' } = req.body
    if (!sucursal_id || !nombre?.trim()) throw new Error('El nombre del negocio es obligatorio')
    if (String(logo).length > 1100000) throw new Error('El logo es demasiado grande')
    const resultado = await pool.query(
      `INSERT INTO configuracion_tienda (sucursal_id, nombre, direccion, telefono, logo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sucursal_id) DO UPDATE SET nombre = EXCLUDED.nombre, direccion = EXCLUDED.direccion,
       telefono = EXCLUDED.telefono, logo = EXCLUDED.logo, actualizado_en = CURRENT_TIMESTAMP
       RETURNING sucursal_id, nombre, direccion, telefono, logo`,
      [sucursal_id, nombre.trim(), direccion.trim(), telefono.trim(), logo]
    )
    res.json({ ok: true, configuracion: resultado.rows[0], mensaje: 'Configuración guardada' })
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message })
  }
})

app.get('/api/productos', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id) || Number(req.usuario.sucursal_id);
    if (!sucursalId || !validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar otra sucursal' });
    const resultado = await pool.query(
      `
      SELECT
        p.id,
        p.codigo_interno,
        p.codigo_barras,
        p.categoria_id,
        p.proveedor_id,
        p.activo,
        p.nombre,
        p.creado_por,
        c.nombre AS categoria,
        p.marca,
        pr.nombre AS proveedor,
        p.unidad,
        p.descripcion,
        p.imagen_url,
        pp.precio_compra_actual,
        pp.precio_venta_actual,
        COALESCE((
          SELECT json_agg(json_build_object('id', x.id, 'nombre', x.nombre, 'factor', x.factor, 'precio_venta', x.precio_venta, 'costo', x.costo) ORDER BY x.id)
          FROM producto_presentaciones x
          WHERE x.producto_id = p.id AND x.activo = true
        ), '[]'::json) AS presentaciones,
        COALESCE(i.stock_actual, 0) AS stock_actual,
        COALESCE(i.stock_minimo, 0) AS stock_minimo
      FROM productos p
      LEFT JOIN categorias c
        ON c.id = p.categoria_id
      LEFT JOIN proveedores pr
        ON pr.id = p.proveedor_id
      LEFT JOIN LATERAL (
        SELECT
          precio_compra_actual,
          precio_venta_actual
        FROM precios_productos
        WHERE producto_id = p.id
        ORDER BY fecha_cambio DESC, id DESC
        LIMIT 1
      ) pp ON true
      LEFT JOIN inventario i
        ON i.producto_id = p.id
        AND i.sucursal_id = $1
      WHERE p.activo = true
      ORDER BY p.nombre
      `,
      [sucursalId]
    );

    res.json({
      ok: true,
      productos: formatearProductos(resultado.rows, req.usuario)
    });

  } catch (error) {
    console.error('ERROR PRODUCTOS:', error.message);

    res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron obtener los productos'
    });
  }
});

// =====================================
// PRODUCTOS DESHABILITADOS
// =====================================

app.get('/api/productos/deshabilitados', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id) || Number(req.usuario.sucursal_id);
    if (!sucursalId || !validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar otra sucursal' });
    const resultado = await pool.query(
      `
      SELECT
        p.id,
        p.codigo_interno,
        p.codigo_barras,
        p.categoria_id,
        p.proveedor_id,
        p.nombre,
        p.creado_por,
        c.nombre AS categoria,
        p.marca,
        pr.nombre AS proveedor,
        p.unidad,
        p.descripcion,
        p.imagen_url,
        p.activo,
        pp.precio_compra_actual,
        pp.precio_venta_actual,
        COALESCE(i.stock_actual, 0) AS stock_actual,
        COALESCE(i.stock_minimo, 0) AS stock_minimo
      FROM productos p
      LEFT JOIN categorias c
        ON c.id = p.categoria_id
      LEFT JOIN proveedores pr
        ON pr.id = p.proveedor_id
      LEFT JOIN LATERAL (
        SELECT
          precio_compra_actual,
          precio_venta_actual
        FROM precios_productos
        WHERE producto_id = p.id
        ORDER BY fecha_cambio DESC, id DESC
        LIMIT 1
      ) pp ON true
      LEFT JOIN inventario i
        ON i.producto_id = p.id
        AND i.sucursal_id = $1
      WHERE p.activo = false
      ORDER BY p.nombre
      `,
      [sucursalId]
    );

    res.json({
      ok: true,
      productos: formatearProductos(resultado.rows, req.usuario)
    });

  } catch (error) {
    console.error(
      'ERROR PRODUCTOS DESHABILITADOS:',
      error.message
    );

    res.status(500).json({
      ok: false,
      mensaje: 'No se pudieron obtener los productos deshabilitados'
    });
  }
});

// =====================================
// CAMBIAR ESTADO DEL PRODUCTO
// =====================================

app.put('/api/productos/:id/estado', autenticar, async (req, res) => {
  try {
    const productoId = Number(req.params.id);
    const { activo } = req.body;

    if (!Number.isInteger(productoId)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'ID de producto inválido'
      });
    }

    if (typeof activo !== 'boolean') {
      return res.status(400).json({
        ok: false,
        mensaje: 'El estado del producto es inválido'
      });
    }
    const productoActual = await pool.query('SELECT creado_por FROM productos WHERE id = $1', [productoId]);
    if (!productoActual.rows.length) return res.status(404).json({ ok: false, mensaje: 'Producto no encontrado' });
    if (!puedeEditarProducto(req.usuario, productoActual.rows[0].creado_por)) return res.status(403).json({ ok: false, mensaje: 'Solo puedes deshabilitar/habilitar los productos que tú creaste' });

    const resultado = await pool.query(
      `
      UPDATE productos
      SET activo = $1
      WHERE id = $2
      RETURNING id, nombre, activo
      `,
      [activo, productoId]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto no encontrado'
      });
    }

    res.json({
      ok: true,
      mensaje: activo
        ? 'Producto habilitado correctamente'
        : 'Producto deshabilitado correctamente',
      producto: resultado.rows[0]
    });

  } catch (error) {
    console.error(
      'ERROR CAMBIANDO ESTADO PRODUCTO:',
      error.message
    );

    res.status(500).json({
      ok: false,
      mensaje: 'No se pudo cambiar el estado del producto'
    });
  }
});

// =====================================
// EDITAR PRODUCTO
// =====================================

app.put('/api/productos/:id', autenticar, async (req, res) => {
  try {
    const productoId = Number(req.params.id);

    const {
      nombre,
      categoria_id,
      proveedor_id,
      marca,
      unidad,
      descripcion,
      precio_compra,
      precio_venta,
      stock_inicial,
      stock_base,
      stock_minimo,
      codigo_barras,
      imagen_url,
      presentaciones,
      sucursal_id = 2
    } = req.body;
    const productoActual = await pool.query('SELECT creado_por FROM productos WHERE id = $1', [productoId]);
    if (!productoActual.rows.length) return res.status(404).json({ ok: false, mensaje: 'Producto no encontrado' });
    if (!puedeEditarProducto(req.usuario, productoActual.rows[0].creado_por)) return res.status(403).json({ ok: false, mensaje: 'Solo puedes editar los productos que tú creaste' });
    if (!validarSucursal(req.usuario, sucursal_id)) return res.status(403).json({ ok: false, mensaje: 'No puedes editar inventario de otra sucursal' });

    if (!Number.isInteger(productoId)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'ID de producto inválido'
      });
    }

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del producto es obligatorio'
      });
    }

    const existe = await pool.query(
      `
      SELECT id
      FROM productos
      WHERE codigo_barras = $1
        AND id <> $2
      `,
      [
        codigo_barras || null,
        productoId
      ]
    );

    if (codigo_barras && existe.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El código de barras ya pertenece a otro producto'
      });
    }

    const actualizado = await pool.query(
      `
      UPDATE productos
      SET
        nombre = $1,
        categoria_id = $2,
        proveedor_id = $3,
        marca = $4,
        unidad = $5,
        descripcion = $6,
        codigo_barras = $7,
        imagen_url = $8
      WHERE id = $9
      RETURNING *
      `,
      [
        nombre.trim(),
        categoria_id || null,
        proveedor_id || null,
        marca || null,
        unidad || 'Unidad',
        descripcion || null,
        codigo_barras || null,
        imagen_url || null,
        productoId
      ]
    );

    if (actualizado.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        mensaje: 'Producto no encontrado'
      });
    }

    await pool.query(
      `
      INSERT INTO precios_productos
      (
        producto_id,
        precio_compra_actual,
        precio_venta_actual
      )
      VALUES ($1, $2, $3)
      `,
      [
        productoId,
        Number(precio_compra) || 0,
        Number(precio_venta) || 0
      ]
    );

    const inventarioExistente = await pool.query('SELECT id FROM inventario WHERE producto_id = $1 AND sucursal_id = $2', [productoId, Number(sucursal_id)]);
    const stockSolicitado = Number(stock_inicial) || 0;
    const ajustarContraBase = stock_base !== undefined && stock_base !== null && Number.isFinite(Number(stock_base));
    const ajusteStock = ajustarContraBase ? stockSolicitado - Number(stock_base) : null;
    if (inventarioExistente.rows.length) {
      let resultadoStock;
      if (ajustarContraBase && ajusteStock !== 0) {
        resultadoStock = await pool.query('UPDATE inventario SET stock_actual = stock_actual + $1, stock_minimo = $2, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $3 AND sucursal_id = $4 AND stock_actual + $1 >= 0 RETURNING id', [ajusteStock, Number(stock_minimo) || 0, productoId, Number(sucursal_id)]);
      } else if (ajustarContraBase) {
        resultadoStock = await pool.query('UPDATE inventario SET stock_minimo = $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3 RETURNING id', [Number(stock_minimo) || 0, productoId, Number(sucursal_id)]);
      } else {
        resultadoStock = await pool.query('UPDATE inventario SET stock_actual = $1, stock_minimo = $2, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $3 AND sucursal_id = $4 RETURNING id', [stockSolicitado, Number(stock_minimo) || 0, productoId, Number(sucursal_id)]);
      }
      if (!resultadoStock.rows.length) throw new Error('El ajuste dejaría el inventario en negativo; revisa el stock actual');
    } else {
      if (ajustarContraBase && ajusteStock < 0) throw new Error('El ajuste dejaría el inventario en negativo; revisa el stock actual');
      await pool.query(
        'INSERT INTO inventario (producto_id, sucursal_id, stock_actual, stock_minimo) VALUES ($1,$2,$3,$4)',
        [productoId, Number(sucursal_id), ajustarContraBase ? ajusteStock : stockSolicitado, Number(stock_minimo) || 0]
      );
    }

    const presentacionesGuardadas = await guardarPresentaciones(
      pool,
      productoId,
      presentaciones,
      unidad,
      precio_venta,
      precio_compra
    );

    res.json({
      ok: true,
      mensaje: 'Producto actualizado correctamente',
      producto: { ...actualizado.rows[0], presentaciones: presentacionesGuardadas }
    });

  } catch (error) {
    console.error(
      'ERROR EDITAR PRODUCTO:',
      error.message
    );

    res.status(500).json({
      ok: false,
      mensaje: error.message
    });
  }
});
 

  // =====================================
// TRANSFERENCIAS DE STOCK ENTRE SUCURSALES
// =====================================

app.post('/api/transferencias', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    const { items = [], sucursal_origen_id, sucursal_destino_id, nota = '' } = req.body;
    const origenId = Number(sucursal_origen_id);
    const destinoId = Number(sucursal_destino_id);

    if (!origenId || !destinoId || !Array.isArray(items) || !items.length) {
      throw new Error('Indica sucursales y al menos un producto para transferir');
    }
    if (origenId === destinoId) throw new Error('La sucursal de origen y destino no pueden ser la misma');

    if (!esDueno(req.usuario)) {
      if (!tienePermiso(req.usuario, 'inventario.transferir')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para transferir stock entre sucursales' });
      if (Number(req.usuario?.sucursal_id) !== origenId) return res.status(403).json({ ok: false, mensaje: 'Solo puedes transferir stock que esté en tu propia sucursal' });
    }

    const sucursales = await client.query('SELECT id FROM sucursales WHERE id = ANY($1) AND activo = true', [[origenId, destinoId]]);
    if (sucursales.rows.length !== 2) throw new Error('La sucursal de origen o destino no existe o está inactiva');

    await client.query('BEGIN');

    const lineas = [];
    for (const item of items) {
      const productoId = Number(item.producto_id);
      const presentacionId = Number(item.presentacion_id) || null;
      const cantidadPresentacion = Number(item.cantidad_presentacion) || 0;
      const unidadesSueltas = Number(item.unidades_sueltas) || 0;
      if (!Number.isInteger(productoId) || cantidadPresentacion < 0 || unidadesSueltas < 0) throw new Error('Hay productos o cantidades inválidas en el ticket');
      const producto = await client.query(
        `SELECT p.id, p.unidad, pp.id AS presentacion_id, pp.nombre AS presentacion_nombre, pp.factor
         FROM productos p
         LEFT JOIN producto_presentaciones pp ON pp.producto_id = p.id AND pp.activo = true AND pp.id = $2
         WHERE p.id = $1 AND p.activo = true`,
        [productoId, presentacionId]
      );
      if (!producto.rows.length || (presentacionId && !producto.rows[0].presentacion_id)) throw new Error('Un producto o presentación ya no está disponible');
      const info = producto.rows[0];
      const factor = Number(info.factor || 1);
      const cantidad = cantidadPresentacion * factor + unidadesSueltas;
      if (!(cantidad > 0)) throw new Error(`Indica una cantidad mayor que cero para ${info.presentacion_nombre || info.unidad || 'el producto'}`);
      lineas.push({ producto_id: productoId, cantidad, cantidad_presentacion: cantidadPresentacion, unidades_sueltas: unidadesSueltas, presentacion_id: info.presentacion_id, presentacion_nombre: info.presentacion_nombre || info.unidad || 'Unidad', factor_presentacion: factor });
    }

    const cantidadesPorProducto = new Map();
    for (const linea of lineas) cantidadesPorProducto.set(linea.producto_id, (cantidadesPorProducto.get(linea.producto_id) || 0) + linea.cantidad);
    const productoIds = [...cantidadesPorProducto.keys()].sort((a, b) => a - b);
    const stockOrigen = await client.query(
      'SELECT producto_id, stock_actual FROM inventario WHERE sucursal_id = $1 AND producto_id = ANY($2::integer[]) ORDER BY producto_id FOR UPDATE',
      [origenId, productoIds]
    );
    if (stockOrigen.rows.length !== productoIds.length) throw new Error('Uno o más productos no tienen inventario registrado en la sucursal de origen');
    for (const stock of stockOrigen.rows) {
      const solicitado = cantidadesPorProducto.get(Number(stock.producto_id));
      if (Number(stock.stock_actual) < solicitado) throw new Error(`Stock insuficiente para el producto ${stock.producto_id} (disponible: ${stock.stock_actual})`);
    }

    for (const [productoId, cantidad] of cantidadesPorProducto) {
      await client.query('UPDATE inventario SET stock_actual = stock_actual - $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3', [cantidad, productoId, origenId]);
    }

    const codigo = `TR-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const ticket = await client.query(
      'INSERT INTO transferencias_tickets (codigo, sucursal_origen_id, sucursal_destino_id, nota, usuario_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, codigo, fecha',
      [codigo, origenId, destinoId, String(nota).trim(), req.usuario?.id || null]
    );
    for (const linea of lineas) {
      await client.query(
        'INSERT INTO transferencias_ticket_items (ticket_id, producto_id, cantidad, cantidad_presentacion, unidades_sueltas, presentacion_id, presentacion_nombre, factor_presentacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [ticket.rows[0].id, linea.producto_id, linea.cantidad, linea.cantidad_presentacion, linea.unidades_sueltas, linea.presentacion_id, linea.presentacion_nombre, linea.factor_presentacion]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ok: true, ticket: { ...ticket.rows[0], estado: 'en_transito', items: lineas }, mensaje: 'Ticket creado y stock descontado del origen; queda en tránsito hasta su recepción' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/transferencias/:codigo/recepcion', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!esDueno(req.usuario) && !tienePermiso(req.usuario, 'inventario.transferir')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para recibir transferencias' });
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) throw new Error('Indica al menos una línea recibida');
    await client.query('BEGIN');
    const resultado = await client.query('SELECT * FROM transferencias_tickets WHERE codigo = $1 FOR UPDATE', [codigo]);
    if (!resultado.rows.length) throw new Error('No se encontró el ticket de transferencia');
    const ticket = resultado.rows[0];
    if (Number(req.usuario?.sucursal_id) !== Number(ticket.sucursal_destino_id)) throw new Error('Solo la sucursal destino puede confirmar la recepción');
    if (ticket.estado !== 'en_transito') throw new Error('Este ticket ya no está en tránsito');
    const recepcion = await client.query(
      'INSERT INTO transferencias_ticket_recepciones (ticket_id, usuario_id, nota) VALUES ($1,$2,$3) RETURNING id',
      [ticket.id, req.usuario?.id || null, String(req.body.nota || '').trim()]
    );

    let recibidasEnEstaOperacion = 0;
    for (const item of items) {
      const itemId = Number(item.item_id);
      const cantidadRecibida = Number(item.cantidad_recibida);
      if (!Number.isInteger(itemId) || !Number.isFinite(cantidadRecibida) || cantidadRecibida < 0) throw new Error('Hay cantidades recibidas inválidas');
      const linea = await client.query('SELECT * FROM transferencias_ticket_items WHERE id = $1 AND ticket_id = $2 FOR UPDATE', [itemId, ticket.id]);
      if (!linea.rows.length) throw new Error('Una línea no corresponde a este ticket');
      const pendiente = Number(linea.rows[0].cantidad) - Number(linea.rows[0].cantidad_recibida);
      if (cantidadRecibida > pendiente) throw new Error(`La recepción supera lo pendiente para ${linea.rows[0].presentacion_nombre}`);
      if (cantidadRecibida === 0) continue;
      const inventario = await client.query('SELECT id FROM inventario WHERE producto_id = $1 AND sucursal_id = $2 FOR UPDATE', [linea.rows[0].producto_id, ticket.sucursal_destino_id]);
      if (inventario.rows.length) {
        await client.query('UPDATE inventario SET stock_actual = stock_actual + $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3', [cantidadRecibida, linea.rows[0].producto_id, ticket.sucursal_destino_id]);
      } else {
        await client.query('INSERT INTO inventario (producto_id, sucursal_id, stock_actual, stock_minimo) VALUES ($1,$2,$3,0)', [linea.rows[0].producto_id, ticket.sucursal_destino_id, cantidadRecibida]);
      }
      await client.query('UPDATE transferencias_ticket_items SET cantidad_recibida = cantidad_recibida + $1 WHERE id = $2', [cantidadRecibida, itemId]);
      await client.query('INSERT INTO transferencias_ticket_recepcion_items (recepcion_id, ticket_item_id, cantidad) VALUES ($1,$2,$3)', [recepcion.rows[0].id, itemId, cantidadRecibida]);
      recibidasEnEstaOperacion += cantidadRecibida;
    }
    const cerrarConDiferencia = Boolean(req.body.cerrar_con_diferencia);
    if (!recibidasEnEstaOperacion && !cerrarConDiferencia) throw new Error('La cantidad total recibida debe ser mayor que cero');
    const pendientes = await client.query('SELECT COUNT(*)::integer AS total FROM transferencias_ticket_items WHERE ticket_id = $1 AND cantidad_recibida < cantidad', [ticket.id]);
    if (cerrarConDiferencia && pendientes.rows[0].total > 0 && !String(req.body.nota || '').trim()) throw new Error('Describe la diferencia antes de cerrar la recepción');
    const estado = pendientes.rows[0].total === 0 ? 'recibida' : (cerrarConDiferencia ? 'recibida_con_diferencia' : 'en_transito');
    await client.query(
      `UPDATE transferencias_tickets SET estado = $1, recibido_por = $2, nota_recepcion = CASE WHEN $3 = '' THEN nota_recepcion ELSE CONCAT_WS(CHR(10), NULLIF(nota_recepcion, ''), $3) END,
       fecha_recepcion = CASE WHEN $1 IN ('recibida', 'recibida_con_diferencia') THEN CURRENT_TIMESTAMP ELSE fecha_recepcion END WHERE id = $4`,
      [estado, req.usuario?.id || null, String(req.body.nota || '').trim(), ticket.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, estado, mensaje: estado === 'recibida' ? 'Recepción completa; el stock ingresó al destino' : (estado === 'recibida_con_diferencia' ? 'Recepción cerrada con diferencia; solo lo recibido ingresó al destino' : 'Recepción parcial registrada; el saldo continúa en tránsito') });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/transferencias/:codigo/anular', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.body.confirmar_devolucion) throw new Error('Confirma que el saldo pendiente regresó físicamente a la sucursal de origen');
    if (!esDueno(req.usuario) && !tienePermiso(req.usuario, 'inventario.transferir')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para anular transferencias' });
    await client.query('BEGIN');
    const resultado = await client.query('SELECT * FROM transferencias_tickets WHERE codigo = $1 FOR UPDATE', [String(req.params.codigo || '').trim().toUpperCase()]);
    if (!resultado.rows.length) throw new Error('No se encontró el ticket de transferencia');
    const ticket = resultado.rows[0];
    if (!esDueno(req.usuario) && Number(req.usuario?.sucursal_id) !== Number(ticket.sucursal_origen_id)) throw new Error('Solo la sucursal origen puede anular el saldo pendiente');
    if (ticket.estado !== 'en_transito') throw new Error('Solo se pueden anular tickets que siguen en tránsito');
    const lineas = await client.query('SELECT * FROM transferencias_ticket_items WHERE ticket_id = $1 ORDER BY producto_id FOR UPDATE', [ticket.id]);
    for (const linea of lineas.rows) {
      const pendiente = Number(linea.cantidad) - Number(linea.cantidad_recibida);
      if (pendiente <= 0) continue;
      const inventario = await client.query('SELECT id FROM inventario WHERE producto_id = $1 AND sucursal_id = $2 FOR UPDATE', [linea.producto_id, ticket.sucursal_origen_id]);
      if (inventario.rows.length) {
        await client.query('UPDATE inventario SET stock_actual = stock_actual + $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3', [pendiente, linea.producto_id, ticket.sucursal_origen_id]);
      } else {
        await client.query('INSERT INTO inventario (producto_id, sucursal_id, stock_actual, stock_minimo) VALUES ($1,$2,$3,0)', [linea.producto_id, ticket.sucursal_origen_id, pendiente]);
      }
    }
    await client.query('UPDATE transferencias_tickets SET estado = \'anulada\', anulado_por = $1, fecha_anulacion = CURRENT_TIMESTAMP WHERE id = $2', [req.usuario?.id || null, ticket.id]);
    await client.query('COMMIT');
    res.json({ ok: true, mensaje: 'Ticket anulado; el saldo pendiente volvió al stock de origen' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/transferencias/ticket/:codigo', autenticar, async (req, res) => {
  try {
    if (!esDueno(req.usuario) && !tienePermiso(req.usuario, 'inventario.ver') && !tienePermiso(req.usuario, 'inventario.transferir')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar tickets de transferencia' });
    const resultado = await pool.query(
      `SELECT t.id, t.codigo, t.estado, t.nota, t.nota_recepcion, t.fecha, t.fecha_recepcion,
        t.sucursal_origen_id, t.sucursal_destino_id, so.nombre AS sucursal_origen, sd.nombre AS sucursal_destino,
        u.nombre AS usuario, ur.nombre AS receptor,
        COALESCE(json_agg(json_build_object('id', ti.id, 'producto_id', ti.producto_id, 'producto', p.nombre, 'cantidad', ti.cantidad,
          'cantidad_presentacion', ti.cantidad_presentacion, 'unidades_sueltas', ti.unidades_sueltas, 'presentacion_nombre', ti.presentacion_nombre,
          'factor_presentacion', ti.factor_presentacion, 'cantidad_recibida', ti.cantidad_recibida) ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]'::json) AS items
        ,COALESCE((SELECT json_agg(json_build_object('fecha', r.fecha, 'usuario', ru.nombre, 'nota', r.nota,
          'items', (SELECT COALESCE(json_agg(json_build_object('ticket_item_id', ri.ticket_item_id, 'cantidad', ri.cantidad) ORDER BY ri.id), '[]'::json)
                   FROM transferencias_ticket_recepcion_items ri WHERE ri.recepcion_id = r.id)) ORDER BY r.fecha, r.id)
          FROM transferencias_ticket_recepciones r LEFT JOIN usuarios ru ON ru.id = r.usuario_id WHERE r.ticket_id = t.id), '[]'::json) AS recepciones
       FROM transferencias_tickets t
       JOIN sucursales so ON so.id = t.sucursal_origen_id
       JOIN sucursales sd ON sd.id = t.sucursal_destino_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN usuarios ur ON ur.id = t.recibido_por
       LEFT JOIN transferencias_ticket_items ti ON ti.ticket_id = t.id
       LEFT JOIN productos p ON p.id = ti.producto_id
       WHERE t.codigo = $1
       GROUP BY t.id, so.nombre, sd.nombre, u.nombre, ur.nombre`,
      [String(req.params.codigo || '').trim().toUpperCase()]
    );
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'No se encontró el ticket' });
    const ticket = resultado.rows[0];
    if (!esDueno(req.usuario) && ![Number(ticket.sucursal_origen_id), Number(ticket.sucursal_destino_id)].includes(Number(req.usuario?.sucursal_id))) return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este ticket' });
    res.json({ ok: true, ticket });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/transferencias', autenticar, async (req, res) => {
  try {
    if (!tienePermiso(req.usuario, 'inventario.ver') && !tienePermiso(req.usuario, 'inventario.transferir') && !esDueno(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver transferencias' });
    const filtros = [];
    const valores = [];
    if (!esDueno(req.usuario)) {
      // Un usuario normal solo ve las transferencias que entraron o salieron de su propia sucursal.
      valores.push(Number(req.usuario?.sucursal_id));
      filtros.push(`(t.sucursal_origen_id = $${valores.length} OR t.sucursal_destino_id = $${valores.length})`);
    }
    const resultado = await pool.query(
      `
      SELECT
        t.id, t.cantidad, t.nota, t.fecha,
        p.nombre AS producto,
        so.nombre AS sucursal_origen,
        sd.nombre AS sucursal_destino,
        u.nombre AS usuario
      FROM transferencias_stock t
      JOIN productos p ON p.id = t.producto_id
      JOIN sucursales so ON so.id = t.sucursal_origen_id
      JOIN sucursales sd ON sd.id = t.sucursal_destino_id
      LEFT JOIN usuarios u ON u.id = t.usuario_id
      ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
      ORDER BY t.fecha DESC
      LIMIT 200
      `,
      valores
    );
    const ticketsValores = esDueno(req.usuario) ? [] : [Number(req.usuario?.sucursal_id)];
    const ticketsFiltro = esDueno(req.usuario) ? '' : 'WHERE t.sucursal_origen_id = $1 OR t.sucursal_destino_id = $1';
    const tickets = await pool.query(
      `SELECT t.id, t.codigo, t.estado, t.nota, t.nota_recepcion, t.fecha, t.fecha_recepcion,
        t.sucursal_origen_id, t.sucursal_destino_id,
        so.nombre AS sucursal_origen, sd.nombre AS sucursal_destino,
        u.nombre AS usuario, ur.nombre AS receptor,
        COALESCE(json_agg(json_build_object('id', ti.id, 'producto_id', ti.producto_id, 'producto', p.nombre, 'cantidad', ti.cantidad,
          'cantidad_presentacion', ti.cantidad_presentacion, 'unidades_sueltas', ti.unidades_sueltas, 'presentacion_nombre', ti.presentacion_nombre,
          'factor_presentacion', ti.factor_presentacion, 'cantidad_recibida', ti.cantidad_recibida) ORDER BY ti.id) FILTER (WHERE ti.id IS NOT NULL), '[]'::json) AS items
        ,COALESCE((SELECT json_agg(json_build_object('fecha', r.fecha, 'usuario', ru.nombre, 'nota', r.nota,
          'items', (SELECT COALESCE(json_agg(json_build_object('ticket_item_id', ri.ticket_item_id, 'cantidad', ri.cantidad) ORDER BY ri.id), '[]'::json)
                   FROM transferencias_ticket_recepcion_items ri WHERE ri.recepcion_id = r.id)) ORDER BY r.fecha, r.id)
          FROM transferencias_ticket_recepciones r LEFT JOIN usuarios ru ON ru.id = r.usuario_id WHERE r.ticket_id = t.id), '[]'::json) AS recepciones
       FROM transferencias_tickets t
       JOIN sucursales so ON so.id = t.sucursal_origen_id
       JOIN sucursales sd ON sd.id = t.sucursal_destino_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN usuarios ur ON ur.id = t.recibido_por
       LEFT JOIN transferencias_ticket_items ti ON ti.ticket_id = t.id
       LEFT JOIN productos p ON p.id = ti.producto_id
       ${ticketsFiltro}
       GROUP BY t.id, so.nombre, sd.nombre, u.nombre, ur.nombre
       ORDER BY t.fecha DESC LIMIT 200`,
      ticketsValores
    );
    res.json({ ok: true, tickets: tickets.rows, transferencias: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

  // =====================================
// PROVEEDORES (versión mínima: lista y alta rápida, para poder usarlos en Compras.
// El módulo completo con ficha detallada se construye en la próxima ronda)
// =====================================

app.get('/api/proveedores', autenticar, async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nombre, empresa, telefono, productos_que_vende, ofrece_descuento, detalle_descuento, activo FROM proveedores WHERE activo = true ORDER BY nombre');
    res.json({ ok: true, proveedores: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/proveedores', autenticar, async (req, res) => {
  try {
    const { nombre, empresa = '', telefono = '' } = req.body;
    if (!nombre?.trim()) throw new Error('El nombre del proveedor es obligatorio');
    const resultado = await pool.query('INSERT INTO proveedores (nombre, empresa, telefono) VALUES ($1,$2,$3) RETURNING id, nombre, empresa, telefono, activo', [nombre.trim(), empresa.trim(), telefono.trim()]);
    res.status(201).json({ ok: true, proveedor: resultado.rows[0], mensaje: 'Proveedor creado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

  // =====================================
// COMPRAS (registrar entrada de mercadería: suma stock y actualiza el precio de
// compra del producto. Para correcciones puntuales sigue existiendo la edición
// manual de stock en Inventario, esto no la reemplaza)
// =====================================

app.post('/api/compras', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!esAdministrador(req.usuario) && !tienePermiso(req.usuario, 'compras.crear')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para registrar compras' });

    const { proveedor_id = null, sucursal_id, numero_factura = '', observacion = '', items } = req.body;
    const sucursalId = Number(sucursal_id);
    if (!sucursalId) throw new Error('Falta la sucursal');
    if (!validarSucursal(req.usuario, sucursalId)) throw new Error('No puedes registrar compras para otra sucursal');
    if (!Array.isArray(items) || !items.length) throw new Error('La compra debe tener al menos un producto');

    const detalles = items.map((item) => {
      const cantidadPresentacion = Number(item.cantidad_presentacion);
      const costoPresentacion = Number(item.costo_unitario); // lo que costó UNA presentación (ej. 1 caja)
      const descuentoPresentacion = Number(item.descuento_unitario) || 0;
      if (!Number.isInteger(Number(item.producto_id)) || !(cantidadPresentacion > 0) || !Number.isFinite(costoPresentacion) || !(costoPresentacion >= 0) || !Number.isFinite(descuentoPresentacion) || descuentoPresentacion < 0 || descuentoPresentacion > costoPresentacion) throw new Error('Hay datos inválidos en los productos de la compra');
      return {
        producto_id: Number(item.producto_id),
        presentacion_id: Number(item.presentacion_id) || null,
        cantidad_presentacion: cantidadPresentacion,
        presentacion_nombre: item.presentacion_nombre || 'Unidad',
        factor_presentacion: 1,
        cantidad: cantidadPresentacion,
        descuento_presentacion: descuentoPresentacion,
        costo_presentacion: costoPresentacion - descuentoPresentacion,
        costo_unitario: 0,
        subtotal_bruto: cantidadPresentacion * costoPresentacion,
        subtotal: cantidadPresentacion * (costoPresentacion - descuentoPresentacion)
      };
    });

    await client.query('BEGIN');

    for (const detalle of detalles) {
      const presentacion = await client.query(
        `SELECT pp.id, pp.nombre, pp.factor
         FROM producto_presentaciones pp
         JOIN productos p ON p.id = pp.producto_id AND p.activo = true
         WHERE pp.producto_id = $1 AND pp.activo = true
           AND (($2::integer IS NOT NULL AND pp.id = $2)
             OR ($2::integer IS NULL AND pp.nombre = $3))
         ORDER BY pp.id LIMIT 1 FOR SHARE OF pp`,
        [detalle.producto_id, detalle.presentacion_id, detalle.presentacion_nombre]
      );
      if (!presentacion.rows.length) throw new Error('Un producto de la compra no tiene la presentación seleccionada activa');
      const seleccion = presentacion.rows[0];
      detalle.presentacion_id = seleccion.id;
      detalle.presentacion_nombre = seleccion.nombre;
      detalle.factor_presentacion = Number(seleccion.factor);
      detalle.cantidad = Math.round(detalle.cantidad_presentacion * detalle.factor_presentacion * 10000) / 10000;
      detalle.costo_unitario = detalle.costo_presentacion / detalle.factor_presentacion;
      detalle.subtotal_bruto = Math.round(detalle.cantidad_presentacion * (detalle.costo_presentacion + detalle.descuento_presentacion) * 100) / 100;
      detalle.subtotal = Math.round(detalle.cantidad_presentacion * detalle.costo_presentacion * 100) / 100;
    }

    const subtotal = detalles.reduce((total, item) => total + item.subtotal_bruto, 0);
    const totalCompra = detalles.reduce((total, item) => total + item.subtotal, 0);
    const totalDescuento = Math.max(0, subtotal - totalCompra);

    const compra = await client.query(
      'INSERT INTO compras_erp (proveedor_id, sucursal_id, usuario_id, numero_factura, subtotal, total, observacion) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, fecha',
      [proveedor_id ? Number(proveedor_id) : null, sucursalId, req.usuario.id, numero_factura.trim(), subtotal.toFixed(2), totalCompra.toFixed(2), observacion.trim()]
    );
    const compraId = compra.rows[0].id;

    for (const detalle of detalles) {
      await client.query(
        'INSERT INTO detalle_compras_erp (compra_id, producto_id, presentacion_id, cantidad_presentacion, presentacion_nombre, factor_presentacion, cantidad, costo_unitario, subtotal, costo_presentacion, descuento_presentacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [compraId, detalle.producto_id, detalle.presentacion_id, detalle.cantidad_presentacion, detalle.presentacion_nombre, detalle.factor_presentacion, detalle.cantidad, detalle.costo_unitario.toFixed(4), detalle.subtotal.toFixed(2), detalle.costo_presentacion.toFixed(2), detalle.descuento_presentacion.toFixed(2)]
      );

      const inventarioExistente = await client.query('SELECT id FROM inventario WHERE producto_id = $1 AND sucursal_id = $2', [detalle.producto_id, sucursalId]);
      if (inventarioExistente.rows.length) {
        await client.query('UPDATE inventario SET stock_actual = stock_actual + $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3', [detalle.cantidad, detalle.producto_id, sucursalId]);
      } else {
        await client.query('INSERT INTO inventario (producto_id, sucursal_id, stock_actual, stock_minimo) VALUES ($1,$2,$3,0)', [detalle.producto_id, sucursalId, detalle.cantidad]);
      }

      const precioActual = await client.query('SELECT precio_compra_actual, precio_venta_actual FROM precios_productos WHERE producto_id = $1 ORDER BY fecha_cambio DESC, id DESC LIMIT 1', [detalle.producto_id]);
      const costoBaseAnterior = Number(precioActual.rows[0]?.precio_compra_actual || 0);
      await client.query(
        'INSERT INTO precios_productos (producto_id, precio_compra_actual, precio_venta_actual) VALUES ($1,$2,$3)',
        [detalle.producto_id, detalle.costo_unitario.toFixed(4), precioActual.rows[0]?.precio_venta_actual || 0]
      );

      // La presentación comprada queda con exactamente lo que pagaste. Las demás se recalculan
      // solo si su costo era el proporcional automático (no pisa costos que escribiste a mano).
      const presentacionesProducto = await client.query('SELECT id, nombre, factor, costo FROM producto_presentaciones WHERE producto_id = $1 AND activo = true', [detalle.producto_id]);
      for (const pres of presentacionesProducto.rows) {
        let nuevoCosto = null;
        if (pres.nombre === detalle.presentacion_nombre) nuevoCosto = detalle.costo_presentacion;
        else if (pres.costo == null || Math.abs(Number(pres.costo) - costoBaseAnterior * Number(pres.factor)) < 0.02) nuevoCosto = detalle.costo_unitario * Number(pres.factor);
        if (nuevoCosto !== null) await client.query('UPDATE producto_presentaciones SET costo = $1 WHERE id = $2', [nuevoCosto.toFixed(2), pres.id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ok: true, compra: { id: compraId, subtotal, descuento: totalDescuento, total: totalCompra }, mensaje: 'Compra registrada: stock y costo neto actualizados' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/compras', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);
    if (!sucursalId) return res.status(400).json({ ok: false, mensaje: 'Falta la sucursal' });
    if (!validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar compras de otra sucursal' });
    const resultado = await pool.query(
      `SELECT c.id, c.fecha, c.numero_factura, c.subtotal, c.total, c.observacion,
         pv.nombre AS proveedor_nombre, u.nombre AS usuario_nombre,
         COALESCE(json_agg(json_build_object('producto_id', dc.producto_id, 'nombre', p.nombre, 'cantidad_presentacion', dc.cantidad_presentacion, 'presentacion_nombre', dc.presentacion_nombre, 'costo_unitario', dc.costo_unitario, 'costo_presentacion', dc.costo_presentacion, 'descuento_presentacion', dc.descuento_presentacion, 'subtotal', dc.subtotal) ORDER BY dc.id) FILTER (WHERE dc.id IS NOT NULL), '[]') AS items
       FROM compras_erp c
       LEFT JOIN proveedores pv ON pv.id = c.proveedor_id
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN detalle_compras_erp dc ON dc.compra_id = c.id
       LEFT JOIN productos p ON p.id = dc.producto_id
       WHERE c.sucursal_id = $1
       GROUP BY c.id, pv.nombre, u.nombre
       ORDER BY c.fecha DESC
       LIMIT 100`,
      [sucursalId]
    );
    res.json({ ok: true, compras: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

  // =====================================
// CLIENTES (ficha + historial de compras calculado desde las ventas ya registradas:
// una venta se asocia a un cliente si coincide su teléfono o su nombre)
// =====================================

const puedeGestionarClientes = (usuario) => esDueno(usuario) || esAdministrador(usuario) || tienePermiso(usuario, 'clientes.ver');
const coincideCliente = `(
  (c.telefono <> '' AND v.cliente_telefono = c.telefono)
  OR (COALESCE(TRIM(v.cliente_nombre), '') <> '' AND LOWER(TRIM(v.cliente_nombre)) = LOWER(TRIM(c.nombre)))
)`;

app.get('/api/clientes/lista-ventas', autenticar, async (req, res) => {
  try {
    if (!puedeGestionarClientes(req.usuario) && !tienePermiso(req.usuario, 'ventas.ver') && !tienePermiso(req.usuario, 'cotizaciones.crear')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para buscar clientes' });
    const resultado = await pool.query('SELECT id, nombre, telefono FROM clientes_erp WHERE activo = true ORDER BY nombre LIMIT 1000');
    res.json({ ok: true, clientes: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/clientes', autenticar, async (req, res) => {
  try {
    if (!puedeGestionarClientes(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver clientes' });
    const valores = [];
    let filtroSucursal = '';
    if (!esAdministrador(req.usuario)) {
      valores.push(Number(req.usuario?.sucursal_id));
      filtroSucursal = `AND v.sucursal_id = $${valores.length}`;
    }
    const resultado = await pool.query(
      `SELECT c.id, c.nombre, c.telefono, c.documento, c.email, c.direccion, c.notas, c.activo,
         COALESCE(h.total_comprado, 0) AS total_comprado, COALESCE(h.compras, 0) AS compras, h.ultima_compra
       FROM clientes_erp c
       LEFT JOIN LATERAL (
         SELECT SUM(v.total) AS total_comprado, COUNT(*)::integer AS compras, MAX(v.fecha) AS ultima_compra
         FROM ventas v
         WHERE v.estado = 'completada' ${filtroSucursal} AND ${coincideCliente}
       ) h ON true
       ORDER BY c.activo DESC, COALESCE(h.total_comprado, 0) DESC, c.nombre`,
      valores
    );
    res.json({ ok: true, clientes: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/clientes/:id/historial', autenticar, async (req, res) => {
  try {
    if (!puedeGestionarClientes(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver clientes' });
    const valores = [Number(req.params.id)];
    let filtroSucursal = '';
    if (!esAdministrador(req.usuario)) {
      valores.push(Number(req.usuario?.sucursal_id));
      filtroSucursal = `AND v.sucursal_id = $${valores.length}`;
    }
    const cliente = await pool.query('SELECT id, nombre, telefono FROM clientes_erp c WHERE c.id = $1', [valores[0]]);
    if (!cliente.rows.length) return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado' });
    const [ventas, productos] = await Promise.all([
      pool.query(
        `SELECT v.id, v.fecha, v.total, s.nombre AS sucursal_nombre, u.nombre AS usuario_nombre
         FROM clientes_erp c JOIN ventas v ON v.estado = 'completada' ${filtroSucursal} AND ${coincideCliente}
         LEFT JOIN sucursales s ON s.id = v.sucursal_id LEFT JOIN usuarios u ON u.id = v.usuario_id
         WHERE c.id = $1 ORDER BY v.fecha DESC LIMIT 30`, valores),
      pool.query(
        `SELECT p.nombre, SUM(dv.subtotal) AS total, COUNT(*)::integer AS veces
         FROM clientes_erp c JOIN ventas v ON v.estado = 'completada' ${filtroSucursal} AND ${coincideCliente}
         JOIN detalle_ventas dv ON dv.venta_id = v.id JOIN productos p ON p.id = dv.producto_id
         WHERE c.id = $1 GROUP BY p.nombre ORDER BY total DESC LIMIT 5`, valores)
    ]);
    res.json({ ok: true, cliente: cliente.rows[0], ventas: ventas.rows, productos_top: productos.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

const datosCliente = (body) => {
  const nombre = String(body.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del cliente es obligatorio');
  return [nombre, String(body.telefono || '').trim(), String(body.documento || '').trim() || null, String(body.email || '').trim() || null, String(body.direccion || '').trim() || null, String(body.notas || '').trim() || null];
};

app.post('/api/clientes', autenticar, async (req, res) => {
  try {
    if (!puedeGestionarClientes(req.usuario) && !tienePermiso(req.usuario, 'ventas.ver')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para crear clientes' });
    const resultado = await pool.query('INSERT INTO clientes_erp (nombre, telefono, documento, email, direccion, notas) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', datosCliente(req.body));
    res.status(201).json({ ok: true, id: resultado.rows[0].id, mensaje: 'Cliente creado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.put('/api/clientes/:id', autenticar, async (req, res) => {
  try {
    if (!puedeGestionarClientes(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar clientes' });
    const resultado = await pool.query('UPDATE clientes_erp SET nombre=$1, telefono=$2, documento=$3, email=$4, direccion=$5, notas=$6 WHERE id=$7 RETURNING id', [...datosCliente(req.body), Number(req.params.id)]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado' });
    res.json({ ok: true, mensaje: 'Cliente actualizado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.patch('/api/clientes/:id/estado', autenticar, async (req, res) => {
  try {
    if (!puedeGestionarClientes(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar clientes' });
    const resultado = await pool.query('UPDATE clientes_erp SET activo = $1 WHERE id = $2 RETURNING id', [Boolean(req.body.activo), Number(req.params.id)]);
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado' });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

  // =====================================
// CREAR PRODUCTO
// =====================================

app.post('/api/productos', autenticar, async (req, res) => {
  try {

    const {
      nombre,
      categoria_id,
      proveedor_id,
      marca,
      unidad,
      descripcion,
      precio_compra,
      precio_venta,
      stock_inicial,
      stock_minimo,
      codigo_barras,
      imagen_url,
      presentaciones,
      sucursal_id = 2
    } = req.body
    if (!tienePermiso(req.usuario, 'inventario.crear')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para crear productos' });
    if (!validarSucursal(req.usuario, sucursal_id)) return res.status(403).json({ ok: false, mensaje: 'No puedes crear inventario en otra sucursal' });


    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del producto es obligatorio'
      })
    }

    const productoConMismoNombre = await pool.query(
      'SELECT id FROM productos WHERE LOWER(BTRIM(nombre)) = LOWER(BTRIM($1)) LIMIT 1',
      [nombre]
    )
    if (productoConMismoNombre.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        mensaje: 'Ya existe un producto con ese nombre. Cierra esta ficha y selecciónalo en la lista de Compras.'
      })
    }


    // Evitar productos duplicados por código de barras

    if (codigo_barras) {

      const existente = await pool.query(
        `
        SELECT id
        FROM productos
        WHERE codigo_barras = $1
        `,
        [codigo_barras]
      )


      if (existente.rows.length > 0) {

        return res.status(400).json({
          ok: false,
          mensaje: 'El código de barras ya pertenece a un producto existente'
        })

      }
    }


    const producto = await pool.query(
      `
      INSERT INTO productos
      (
        nombre,
        categoria_id,
        proveedor_id,
        marca,
        unidad,
        descripcion,
        codigo_barras,
        imagen_url,
        creado_por,
        activo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
      RETURNING *
      `,
      [
        nombre.trim(),
        categoria_id || null,
        proveedor_id || null,
        marca || null,
        unidad || 'Unidad',
        descripcion || null,
        codigo_barras || null,
        imagen_url || null,
        req.usuario.id || null
      ]
    )


    const productoCreado = producto.rows[0]


    await pool.query(
      `
      INSERT INTO inventario
      (
        producto_id,
        sucursal_id,
        stock_actual,
        stock_minimo
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        productoCreado.id,
        Number(sucursal_id),
        Number(stock_inicial) || 0,
        Number(stock_minimo) || 0
      ]
    )


    await pool.query(
      `
      INSERT INTO precios_productos
      (
        producto_id,
        precio_compra_actual,
        precio_venta_actual
      )
      VALUES ($1,$2,$3)
      `,
      [
        productoCreado.id,
        Number(precio_compra) || 0,
        Number(precio_venta) || 0
      ]
    )


    await pool.query(
      `
      UPDATE inventario
      SET
        stock_actual = $1,
        stock_minimo = $2
      WHERE producto_id = $3
        AND sucursal_id = $4
      `,
      [
        Number(stock_inicial) || 0,
        Number(stock_minimo) || 0,
        productoCreado.id,
        Number(sucursal_id)
      ]
    )

    const presentacionesGuardadas = await guardarPresentaciones(
      pool,
      productoCreado.id,
      presentaciones,
      unidad,
      precio_venta,
      precio_compra
    )


    res.status(201).json({
      ok: true,
      mensaje: 'Producto creado correctamente',
      producto: { ...productoCreado, presentaciones: presentacionesGuardadas }
    })


  } catch (error) {

    console.error(
      'ERROR CREAR PRODUCTO:',
      error.message
    )


    res.status(500).json({
      ok: false,
      mensaje: error.message
    })

  }

})


// =====================================
// CAJA
// =====================================

app.get('/api/dashboard/resumen', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);
    if (!sucursalId) return res.status(400).json({ ok: false, mensaje: 'Falta la sucursal' });
    if (!validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar otra sucursal' });

    const [ventasHoy, productos, stockBajo, cajaResult, gananciaHoy] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total), 0) AS total, COUNT(*)::integer AS operaciones FROM ventas WHERE sucursal_id = $1 AND estado = 'completada' AND fecha >= CURRENT_DATE AND fecha < CURRENT_DATE + INTERVAL '1 day'`, [sucursalId]),
      pool.query(`SELECT COUNT(*)::integer AS total FROM productos WHERE activo = true`),
      pool.query(`SELECT COUNT(*)::integer AS total FROM inventario i JOIN productos p ON p.id = i.producto_id WHERE i.sucursal_id = $1 AND p.activo = true AND i.stock_actual <= i.stock_minimo`, [sucursalId]),
      pool.query(`SELECT id, monto_inicial, fecha_apertura FROM caja_sesiones WHERE sucursal_id = $1 AND estado = 'abierta' ORDER BY id DESC LIMIT 1`, [sucursalId]),
      pool.query(
        `SELECT COALESCE(SUM(d.ganancia_bruta), 0) AS ganancia,
           COUNT(DISTINCT v.id) FILTER (WHERE d.ganancia_bruta IS NULL)::integer AS ventas_sin_costo
         FROM ventas v
         JOIN detalle_ventas d ON d.venta_id = v.id
         WHERE v.sucursal_id = $1 AND v.estado = 'completada'
           AND v.fecha >= CURRENT_DATE AND v.fecha < CURRENT_DATE + INTERVAL '1 day'`,
        [sucursalId]
      )
    ]);

    let cajaAbierta = false
    let cajaSaldo = 0
    if (cajaResult.rows.length) {
      const caja = cajaResult.rows[0]
      const resumen = await pool.query(
        `SELECT
           COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'EFECTIVO'), 0) AS efectivo_ventas,
           (SELECT COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND UPPER(metodo) = 'EFECTIVO'), 0) FROM caja_movimientos WHERE caja_id = $3) AS ingresos_efectivo,
           (SELECT COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND UPPER(metodo) = 'EFECTIVO'), 0) FROM caja_movimientos WHERE caja_id = $3) AS egresos_efectivo
         FROM pagos p JOIN ventas v ON v.id = p.venta_id
         WHERE v.sucursal_id = $1 AND v.fecha >= $2 AND v.estado = 'completada'`,
        [sucursalId, caja.fecha_apertura, caja.id]
      )
      const r = resumen.rows[0]
      cajaAbierta = true
      cajaSaldo = Number(caja.monto_inicial) + Number(r.efectivo_ventas) + Number(r.ingresos_efectivo) - Number(r.egresos_efectivo)
    }

    res.json({
      ok: true,
      ventas_hoy: Number(ventasHoy.rows[0]?.total || 0),
      operaciones_hoy: Number(ventasHoy.rows[0]?.operaciones || 0),
      ...(esAdministrador(req.usuario) ? {
        ganancia_bruta_hoy: Number(gananciaHoy.rows[0]?.ganancia || 0),
        ventas_sin_costo_hoy: Number(gananciaHoy.rows[0]?.ventas_sin_costo || 0)
      } : {}),
      productos_total: Number(productos.rows[0]?.total || 0),
      stock_bajo: Number(stockBajo.rows[0]?.total || 0),
      caja_abierta: cajaAbierta,
      caja_saldo: cajaSaldo
    });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/caja/estado', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);

    if (!sucursalId) {
      return res.status(400).json({ ok: false, mensaje: 'Falta la sucursal' });
    }
    if (!puedeOperarCaja(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar caja' });
    if (!validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar la caja de otra sucursal' });

    const cajaResult = await pool.query(
      `
      SELECT cs.*, u.nombre AS usuario_nombre,
        cs.fecha_apertura <= CURRENT_TIMESTAMP - INTERVAL '24 hours' AS expirada
      FROM caja_sesiones cs
      LEFT JOIN usuarios u ON u.id = cs.usuario_apertura_id
      WHERE cs.sucursal_id = $1 AND cs.estado = 'abierta'
      ORDER BY cs.id DESC
      LIMIT 1
      `,
      [sucursalId]
    );

    if (cajaResult.rows.length === 0) {
      return res.json({ ok: true, caja: null, resumen: {} });
    }

    const caja = cajaResult.rows[0];
    const resumenResult = await pool.query(
      `
      WITH ventas_caja AS (
        SELECT
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'EFECTIVO'), 0) AS efectivo,
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'QR'), 0) AS qr,
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'TARJETA'), 0) AS tarjeta,
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'TRANSFERENCIA'), 0) AS transferencia,
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) NOT IN ('EFECTIVO', 'QR', 'TARJETA', 'TRANSFERENCIA')), 0) AS otros,
          COALESCE(SUM(p.monto), 0) AS total_ventas,
          COUNT(DISTINCT v.id) AS cantidad_ventas
        FROM pagos p
        JOIN ventas v ON v.id = p.venta_id
        WHERE v.sucursal_id = $1 AND v.fecha >= $2 AND v.estado = 'completada'
      ), movimientos AS (
        SELECT
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND UPPER(m.metodo) = 'EFECTIVO'), 0) AS ingresos_efectivo,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'egreso' AND UPPER(m.metodo) = 'EFECTIVO'), 0) AS egresos,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND UPPER(m.metodo) = 'QR'), 0) AS ingresos_qr,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'egreso' AND UPPER(m.metodo) = 'QR'), 0) AS egresos_qr,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'ingreso'), 0) AS ingresos
        FROM caja_movimientos m
        WHERE m.caja_id = $3
      )
      SELECT * FROM ventas_caja CROSS JOIN movimientos
      `,
      [sucursalId, caja.fecha_apertura, caja.id]
    );

    const resumen = resumenResult.rows[0];
    const efectivoEsperado = Number(caja.monto_inicial) + Number(resumen.efectivo) + Number(resumen.ingresos_efectivo) - Number(resumen.egresos);
  const qrEsperado = Number(caja.monto_inicial_qr) + Number(resumen.qr) + Number(resumen.ingresos_qr) - Number(resumen.egresos_qr);

    res.json({
      ok: true,
      caja,
      resumen: {
        ...resumen,
        efectivo_esperado: efectivoEsperado,
        qr_esperado: qrEsperado,
        diferencia: 0,
        diferencia_qr: 0,
        egresos: Number(resumen.egresos),
        total_ventas: Number(resumen.total_ventas)
      }
    });
  } catch (error) {
    console.error('ERROR ESTADO CAJA:', error.message);
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/caja/movimientos', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);
    if (!sucursalId) return res.status(400).json({ ok: false, mensaje: 'Falta la sucursal' });
    if (!puedeOperarCaja(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar movimientos de caja' });
    if (!validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar movimientos de otra sucursal' });
    const cajaResult = await pool.query(`SELECT id, fecha_apertura FROM caja_sesiones WHERE sucursal_id = $1 AND estado = 'abierta' ORDER BY id DESC LIMIT 1`, [sucursalId]);
    if (!cajaResult.rows.length) return res.json({ ok: true, movimientos: [] });
    const resultado = await pool.query(
      `SELECT m.id, m.tipo, m.metodo, m.concepto, m.monto, m.fecha, u.nombre AS usuario
       FROM caja_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.caja_id = $1 ORDER BY m.fecha DESC`,
      [cajaResult.rows[0].id]
    );
    res.json({ ok: true, movimientos: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/caja/apertura', autenticar, async (req, res) => {
  try {
    const { sucursal_id, monto_inicial = 0, monto_inicial_qr = 0 } = req.body;
    const monto = Number(monto_inicial);
    const montoQr = Number(monto_inicial_qr);

    if (!sucursal_id || !Number.isFinite(monto) || monto < 0 || !Number.isFinite(montoQr) || montoQr < 0) {
      return res.status(400).json({ ok: false, mensaje: 'Los datos de apertura no son válidos' });
    }
    if (!puedeOperarCaja(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para abrir caja' });
    if (!validarSucursal(req.usuario, Number(sucursal_id))) return res.status(403).json({ ok: false, mensaje: 'No puedes abrir caja en otra sucursal' });

    const resultado = await pool.query(
      `INSERT INTO caja_sesiones (sucursal_id, usuario_apertura_id, monto_inicial, monto_inicial_qr)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [Number(sucursal_id), req.usuario.id, monto.toFixed(2), montoQr.toFixed(2)]
    );

    res.status(201).json({ ok: true, caja: resultado.rows[0], mensaje: 'Caja abierta correctamente' });
  } catch (error) {
    const mensaje = error.code === '23505' ? 'Ya existe una caja abierta para esta sucursal' : error.message;
    res.status(400).json({ ok: false, mensaje });
  }
});

app.post('/api/caja/movimientos', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    const { caja_id, monto, tipo, metodo = 'EFECTIVO', concepto } = req.body;
    const montoNumero = Number(monto);

    if (!caja_id || !concepto || !['ingreso', 'egreso'].includes(tipo) || !Number.isFinite(montoNumero) || montoNumero <= 0) {
      return res.status(400).json({ ok: false, mensaje: 'Los datos del movimiento no son válidos' });
    }
    if (!puedeOperarCaja(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para registrar movimientos de caja' });

    await client.query('BEGIN');
    const caja = await client.query('SELECT id, sucursal_id, fecha_apertura FROM caja_sesiones WHERE id = $1 AND estado = \'abierta\' FOR UPDATE', [Number(caja_id)]);
    if (!caja.rows.length) throw new Error('La caja no está abierta');
    if (!validarSucursal(req.usuario, caja.rows[0].sucursal_id)) throw new Error('No puedes operar la caja de otra sucursal');
    if (cajaExpirada(caja.rows[0].fecha_apertura)) throw new Error('La caja superó las 24 horas; debe contarse y cerrarse antes de registrar movimientos');

    const resultado = await client.query(
      `INSERT INTO caja_movimientos (caja_id, usuario_id, tipo, metodo, concepto, monto)
       VALUES ($1, $2, $3, UPPER($4), $5, $6) RETURNING *`,
      [Number(caja_id), req.usuario.id, tipo, metodo, concepto.trim(), montoNumero.toFixed(2)]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true, movimiento: resultado.rows[0], mensaje: 'Movimiento registrado correctamente' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/caja/cierre', autenticar, async (req, res) => {
  try {
    const { caja_id, monto_contado, monto_contado_qr = 0, observacion = '' } = req.body;
    const montoContado = Number(monto_contado);
    const montoContadoQr = Number(monto_contado_qr);

    if (!caja_id || !Number.isFinite(montoContado) || montoContado < 0 || !Number.isFinite(montoContadoQr) || montoContadoQr < 0) {
      return res.status(400).json({ ok: false, mensaje: 'El monto contado no es válido' });
    }
    if (!puedeOperarCaja(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para cerrar caja' });

    const cajaActual = await pool.query('SELECT sucursal_id FROM caja_sesiones WHERE id = $1 AND estado = \'abierta\'', [Number(caja_id)]);
    if (!cajaActual.rows.length) throw new Error('La caja no está abierta');
    if (!validarSucursal(req.usuario, cajaActual.rows[0].sucursal_id)) throw new Error('No puedes cerrar la caja de otra sucursal');

    const resultado = await pool.query(
      `
      WITH ventas AS (
        SELECT
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'EFECTIVO'), 0) AS efectivo,
          COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'QR'), 0) AS qr
        FROM pagos p JOIN ventas v ON v.id = p.venta_id
        JOIN caja_sesiones cs ON cs.sucursal_id = v.sucursal_id
        WHERE cs.id = $1 AND v.fecha >= cs.fecha_apertura AND v.estado = 'completada'
      ), movimientos AS (
        SELECT
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND UPPER(m.metodo) = 'EFECTIVO'), 0) AS ingresos,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'egreso' AND UPPER(m.metodo) = 'EFECTIVO'), 0) AS egresos,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND UPPER(m.metodo) = 'QR'), 0) AS ingresos_qr,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'egreso' AND UPPER(m.metodo) = 'QR'), 0) AS egresos_qr
        FROM caja_movimientos m WHERE m.caja_id = $1
      )
      UPDATE caja_sesiones cs
      SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP, usuario_cierre_id = $2,
          monto_esperado = cs.monto_inicial + ventas.efectivo + movimientos.ingresos - movimientos.egresos,
          monto_contado = $3,
          diferencia = $3 - (cs.monto_inicial + ventas.efectivo + movimientos.ingresos - movimientos.egresos),
          monto_esperado_qr = cs.monto_inicial_qr + ventas.qr + movimientos.ingresos_qr - movimientos.egresos_qr,
          monto_contado_qr = $5,
          diferencia_qr = $5 - (cs.monto_inicial_qr + ventas.qr + movimientos.ingresos_qr - movimientos.egresos_qr),
          observacion = $4
      FROM ventas, movimientos
      WHERE cs.id = $1 AND cs.estado = 'abierta'
      RETURNING cs.*
      `,
      [Number(caja_id), req.usuario.id, montoContado.toFixed(2), observacion, montoContadoQr.toFixed(2)]
    );

    if (resultado.rows.length === 0) throw new Error('La caja no está abierta');
    res.json({ ok: true, cierre: resultado.rows[0], mensaje: 'Caja cerrada correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

// =====================================
// COTIZACIONES
// =====================================

app.get('/api/cotizaciones', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);
    const busqueda = String(req.query.busqueda || '').trim();
    if (!validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar cotizaciones de otra sucursal' });
    const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 100);
    const resultado = await pool.query(
      `SELECT c.id, c.codigo, c.fecha, c.cliente_nombre, c.cliente_telefono,
        c.subtotal, c.descuento, c.total, c.mostrar_detalle, c.estado,
        c.convertido_venta_id, u.nombre AS usuario_nombre,
        COUNT(dc.id)::integer AS cantidad_items
       FROM cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN detalle_cotizaciones dc ON dc.cotizacion_id = c.id
       WHERE c.sucursal_id = $1
         AND c.estado != 'convertida'
         AND ($2 = '' OR c.codigo ILIKE '%' || $2 || '%' OR c.cliente_nombre ILIKE '%' || $2 || '%' OR c.cliente_telefono ILIKE '%' || $2 || '%')
       GROUP BY c.id, u.nombre
       ORDER BY c.fecha DESC
       LIMIT $3`,
      [sucursalId, busqueda, limite]
    );
    res.json({ ok: true, cotizaciones: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/cotizaciones/:id', autenticar, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT c.*, u.nombre AS usuario_nombre, s.nombre AS sucursal_nombre,
        COALESCE(json_agg(json_build_object(
          'producto_id', dc.producto_id, 'nombre', dc.nombre, 'codigo', dc.codigo,
          'cantidad', dc.cantidad, 'precio', dc.precio_unitario, 'subtotal', dc.subtotal,
          'presentacion_id', dc.presentacion_id, 'presentacion_nombre', dc.presentacion_nombre, 'factor_presentacion', dc.factor_presentacion
        ) ORDER BY dc.id) FILTER (WHERE dc.id IS NOT NULL), '[]') AS items
       FROM cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN sucursales s ON s.id = c.sucursal_id
       LEFT JOIN detalle_cotizaciones dc ON dc.cotizacion_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, u.nombre, s.nombre`,
      [Number(req.params.id)]
    );
    if (!resultado.rows.length) return res.status(404).json({ ok: false, mensaje: 'Cotización no encontrada' });
    if (!validarSucursal(req.usuario, resultado.rows[0].sucursal_id)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar esta cotización' });
    res.json({ ok: true, cotizacion: resultado.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.patch('/api/cotizaciones/:id/convertida', autenticar, async (req, res) => {
  try {
    const ventaId = Number(req.body.venta_id);
    const resultado = await pool.query(
      `UPDATE cotizaciones c SET estado = 'convertida', convertido_venta_id = $1
       WHERE c.id = $2 AND c.estado = 'vigente' AND EXISTS (SELECT 1 FROM ventas v WHERE v.id = $1 AND v.sucursal_id = c.sucursal_id)
       AND ($3::integer IS NULL OR c.sucursal_id = $3) RETURNING c.id, c.codigo, c.estado, c.convertido_venta_id`,
      [ventaId, Number(req.params.id), esAdministrador(req.usuario) ? null : Number(req.usuario.sucursal_id)]
    );
    if (!resultado.rows.length) return res.status(409).json({ ok: false, mensaje: 'La cotización ya fue convertida o no existe' });
    res.json({ ok: true, cotizacion: resultado.rows[0] });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/cotizaciones', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      usuario_id, sucursal_id, cliente_id = null, cliente_nombre = '', cliente_telefono = '', fecha = null,
      descuento = 0, mostrar_detalle = true, observacion = '', items
    } = req.body;
    if (!usuario_id || !sucursal_id || !Array.isArray(items) || !items.length) throw new Error('La cotización debe tener al menos un producto');
    if (Number(usuario_id) !== Number(req.usuario.id) || !validarSucursal(req.usuario, sucursal_id)) throw new Error('La cotización no corresponde a la sesión actual');
    if (Number(descuento) > 0 && !puedeAutorizarDescuento(req.usuario)) throw new Error('El descuento requiere autorización del dueño o jefe');
    await client.query('BEGIN');
    const detalles = items.map((item) => {
      const cantidad = Math.round(Number(item.cantidad));
      const precio = Number(item.precio);
      if (!Number.isFinite(item.producto_id) || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio < 0) throw new Error('Hay un producto o cantidad inválida');
      return { producto_id: Number(item.producto_id), nombre: String(item.nombre || '').trim(), codigo: String(item.codigo || ''), cantidad, precio, subtotal: cantidad * precio, presentacion_id: item.presentacion_id ? Number(item.presentacion_id) : null, presentacion_nombre: item.presentacion_nombre ? String(item.presentacion_nombre).trim() : null, factor_presentacion: Number(item.factor_presentacion) > 0 ? Number(item.factor_presentacion) : 1 };
    });
    const subtotal = detalles.reduce((total, item) => total + item.subtotal, 0);
    const descuentoNumero = Math.min(Math.max(Number(descuento) || 0, 0), subtotal);
    const total = subtotal - descuentoNumero;
    const hoyISO = new Date().toISOString().slice(0, 10);
    const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha)) && String(fecha) >= hoyISO ? String(fecha) : hoyISO;
    const fechaCotizacion = `${fechaValida} 12:00:00`;
    const codigoTemporal = `TEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cotizacion = await client.query(
      `INSERT INTO cotizaciones (codigo, sucursal_id, usuario_id, cliente_id, cliente_nombre, cliente_telefono, fecha, subtotal, descuento, total, mostrar_detalle, observacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [codigoTemporal, sucursal_id, usuario_id, cliente_id, String(cliente_nombre).trim(), String(cliente_telefono).trim(), fechaCotizacion, subtotal.toFixed(2), descuentoNumero.toFixed(2), total.toFixed(2), Boolean(mostrar_detalle), String(observacion).trim()]
    );
    const codigo = `COT-${String(cotizacion.rows[0].id).padStart(6, '0')}`;
    await client.query('UPDATE cotizaciones SET codigo = $1 WHERE id = $2', [codigo, cotizacion.rows[0].id]);
    cotizacion.rows[0].codigo = codigo;
    for (const detalle of detalles) {
      await client.query(
        `INSERT INTO detalle_cotizaciones (cotizacion_id, producto_id, nombre, codigo, cantidad, precio_unitario, subtotal, presentacion_id, presentacion_nombre, factor_presentacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cotizacion.rows[0].id, detalle.producto_id, detalle.nombre, detalle.codigo, detalle.cantidad, detalle.precio.toFixed(2), detalle.subtotal.toFixed(2), detalle.presentacion_id, detalle.presentacion_nombre, detalle.factor_presentacion]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, mensaje: 'Cotización guardada correctamente', cotizacion: { ...cotizacion.rows[0], items: detalles } });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/cotizaciones/:id', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    const { cliente_nombre = '', cliente_telefono = '', fecha = null, descuento = 0, mostrar_detalle = true, observacion = '', items } = req.body;
    if (!Array.isArray(items) || !items.length) throw new Error('La cotización debe tener al menos un producto');
    if (Number(descuento) > 0 && !puedeAutorizarDescuento(req.usuario)) throw new Error('El descuento requiere autorización del dueño o jefe');
    const detalles = items.map((item) => ({ producto_id: Number(item.producto_id), nombre: String(item.nombre || '').trim(), codigo: String(item.codigo || ''), cantidad: Math.round(Number(item.cantidad)), precio: Number(item.precio), subtotal: Math.round(Number(item.cantidad)) * Number(item.precio), presentacion_id: item.presentacion_id ? Number(item.presentacion_id) : null, presentacion_nombre: item.presentacion_nombre ? String(item.presentacion_nombre).trim() : null, factor_presentacion: Number(item.factor_presentacion) > 0 ? Number(item.factor_presentacion) : 1 }));
    if (detalles.some((item) => !Number.isInteger(item.producto_id) || item.cantidad <= 0 || !Number.isFinite(item.precio) || item.precio < 0)) throw new Error('Hay datos inválidos en los productos');
    const subtotal = detalles.reduce((total, item) => total + item.subtotal, 0);
    const descuentoNumero = Math.min(Math.max(Number(descuento) || 0, 0), subtotal);
    const hoyISOEdicion = new Date().toISOString().slice(0, 10);
    const fechaCotizacion = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha)) && String(fecha) >= hoyISOEdicion ? `${fecha} 12:00:00` : (/^\d{4}-\d{2}-\d{2}$/.test(String(fecha)) ? `${hoyISOEdicion} 12:00:00` : null);
    await client.query('BEGIN');
    const actualizado = await client.query(
      `UPDATE cotizaciones SET cliente_nombre = $1, cliente_telefono = $2, fecha = COALESCE($3::timestamp, fecha), subtotal = $4, descuento = $5, total = $6, mostrar_detalle = $7, observacion = $8 WHERE id = $9 AND estado = 'vigente' RETURNING *`,
      [String(cliente_nombre).trim(), String(cliente_telefono).trim(), fechaCotizacion, subtotal.toFixed(2), descuentoNumero.toFixed(2), (subtotal - descuentoNumero).toFixed(2), Boolean(mostrar_detalle), String(observacion).trim(), Number(req.params.id)]
    );
    if (!actualizado.rows.length) throw new Error('Solo se pueden editar cotizaciones vigentes');
    await client.query('DELETE FROM detalle_cotizaciones WHERE cotizacion_id = $1', [Number(req.params.id)]);
    for (const detalle of detalles) await client.query('INSERT INTO detalle_cotizaciones (cotizacion_id, producto_id, nombre, codigo, cantidad, precio_unitario, subtotal, presentacion_id, presentacion_nombre, factor_presentacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [Number(req.params.id), detalle.producto_id, detalle.nombre, detalle.codigo, detalle.cantidad, detalle.precio.toFixed(2), detalle.subtotal.toFixed(2), detalle.presentacion_id, detalle.presentacion_nombre, detalle.factor_presentacion]);
    await client.query('COMMIT');
    res.json({ ok: true, cotizacion: { ...actualizado.rows[0], items: detalles }, mensaje: 'Cotización actualizada correctamente' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/cotizaciones/:id', autenticar, async (req, res) => {
  try {
    if (!tienePermiso(req.usuario, 'cotizaciones.eliminar')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para eliminar cotizaciones' });
    const resultado = await pool.query(`DELETE FROM cotizaciones WHERE id = $1 AND estado = 'vigente' AND ($2::integer IS NULL OR sucursal_id = $2) RETURNING id`, [Number(req.params.id), esAdministrador(req.usuario) ? null : Number(req.usuario.sucursal_id)]);
    if (!resultado.rows.length) return res.status(409).json({ ok: false, mensaje: 'Solo se pueden eliminar cotizaciones vigentes' });
    res.json({ ok: true, mensaje: 'Cotización eliminada correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

// =====================================
// VENTAS
// =====================================

app.get('/api/reportes/ventas', autenticar, async (req, res) => {
  try {
    if (!esAdministrador(req.usuario) && !tienePermiso(req.usuario, 'reportes.ver')) return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar reportes' });
    const sucursalSolicitada = Number(req.query.sucursal_id) || null;
    if (!esAdministrador(req.usuario) && sucursalSolicitada && sucursalSolicitada !== Number(req.usuario.sucursal_id)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar reportes de otra sucursal' });
    const sucursalId = esAdministrador(req.usuario) ? sucursalSolicitada : Number(req.usuario.sucursal_id);
    const desde = String(req.query.desde || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.desde : null;
    const hasta = String(req.query.hasta || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.hasta : null;
    const agrupacion = ['dia', 'mes', 'anio'].includes(req.query.agrupacion) ? req.query.agrupacion : 'dia';
    const fechaDesde = desde || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const fechaHasta = hasta || new Date().toISOString().slice(0, 10);
    const parametros = [fechaDesde, fechaHasta, sucursalId];
    const condicionSucursal = '($3::integer IS NULL OR v.sucursal_id = $3)';
    const expresionPeriodo = agrupacion === 'mes'
      ? "TO_CHAR(DATE_TRUNC('month', v.fecha), 'YYYY-MM')"
      : agrupacion === 'anio'
        ? "TO_CHAR(DATE_TRUNC('year', v.fecha), 'YYYY')"
        : "TO_CHAR(DATE_TRUNC('day', v.fecha), 'YYYY-MM-DD')";
    const base = `FROM ventas v WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal}`;

    const diasPeriodo = Math.max(1, Math.floor((Date.parse(`${fechaHasta}T00:00:00`) - Date.parse(`${fechaDesde}T00:00:00`)) / 86400000) + 1);
    const parametrosAgotamiento = [...parametros, diasPeriodo];
    const [resumen, serie, productos, productosMenos, categorias, sucursales, horas, pagos, vendedores, vendedoresMenos, agotamiento, opcionesSucursales] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(v.total), 0) AS ventas, COUNT(*) AS operaciones, COALESCE(SUM(v.total) / NULLIF(COUNT(*), 0), 0) AS ticket_promedio ${base}`, parametros),
      pool.query(`SELECT ${expresionPeriodo} AS periodo, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS operaciones ${base} GROUP BY 1 ORDER BY 1`, parametros),
      pool.query(`SELECT pr.id, pr.nombre, COALESCE(SUM(dv.cantidad), 0) AS cantidad, COALESCE(SUM(dv.subtotal), 0) AS total FROM detalle_ventas dv JOIN ventas v ON v.id = dv.venta_id JOIN productos pr ON pr.id = dv.producto_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal} GROUP BY pr.id, pr.nombre ORDER BY cantidad DESC, total DESC LIMIT 10`, parametros),
      pool.query(`SELECT pr.id, pr.nombre, SUM(dv.cantidad) AS cantidad, SUM(dv.subtotal) AS total FROM detalle_ventas dv JOIN ventas v ON v.id = dv.venta_id JOIN productos pr ON pr.id = dv.producto_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal} GROUP BY pr.id, pr.nombre HAVING SUM(dv.cantidad) > 0 ORDER BY cantidad ASC, total ASC LIMIT 10`, parametros),
      pool.query(`SELECT COALESCE(c.nombre, 'Sin categoría') AS nombre, COALESCE(SUM(dv.cantidad), 0) AS cantidad, COALESCE(SUM(dv.subtotal), 0) AS total FROM detalle_ventas dv JOIN ventas v ON v.id = dv.venta_id JOIN productos pr ON pr.id = dv.producto_id LEFT JOIN categorias c ON c.id = pr.categoria_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal} GROUP BY c.nombre ORDER BY total DESC LIMIT 8`, parametros),
      pool.query(`SELECT v.sucursal_id AS id, COALESCE(s.nombre, 'Sucursal ' || v.sucursal_id) AS nombre, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS operaciones FROM ventas v LEFT JOIN sucursales s ON s.id = v.sucursal_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ($3::integer IS NULL OR v.sucursal_id = $3) GROUP BY v.sucursal_id, s.nombre ORDER BY total DESC`, parametros),
      pool.query(`SELECT EXTRACT(HOUR FROM v.fecha)::integer AS hora, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS operaciones ${base} GROUP BY 1 ORDER BY 1`, parametros),
      pool.query(`SELECT UPPER(COALESCE(p.metodo, 'OTROS')) AS metodo, COALESCE(SUM(p.monto), 0) AS total FROM pagos p JOIN ventas v ON v.id = p.venta_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal} GROUP BY 1 ORDER BY total DESC`, parametros),
      pool.query(`SELECT COALESCE(u.nombre, 'Usuario eliminado') AS nombre, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS operaciones FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal} GROUP BY u.nombre ORDER BY total DESC LIMIT 10`, parametros),
      pool.query(`SELECT COALESCE(u.nombre, 'Usuario eliminado') AS nombre, COALESCE(SUM(v.total), 0) AS total, COUNT(*) AS operaciones FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal} GROUP BY u.nombre ORDER BY total ASC LIMIT 10`, parametros),
      pool.query(`WITH vendido AS (
        SELECT dv.producto_id, v.sucursal_id, SUM(dv.cantidad) AS cantidad
        FROM detalle_ventas dv JOIN ventas v ON v.id = dv.venta_id
        WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ${condicionSucursal}
        GROUP BY dv.producto_id, v.sucursal_id
      )
      SELECT pr.id, pr.nombre, SUM(i.stock_actual) AS stock_actual, SUM(COALESCE(vendido.cantidad, 0)) AS vendido_periodo,
        SUM(i.stock_actual) / NULLIF(SUM(COALESCE(vendido.cantidad, 0)) / $4::numeric, 0) AS dias_estimados
      FROM inventario i JOIN productos pr ON pr.id = i.producto_id
      LEFT JOIN vendido ON vendido.producto_id = i.producto_id AND vendido.sucursal_id = i.sucursal_id
      WHERE pr.activo = true AND ($3::integer IS NULL OR i.sucursal_id = $3)
      GROUP BY pr.id, pr.nombre
      HAVING SUM(COALESCE(vendido.cantidad, 0)) > 0 AND SUM(i.stock_actual) > 0
      ORDER BY dias_estimados ASC LIMIT 10`, parametrosAgotamiento),
      pool.query('SELECT id, nombre FROM sucursales WHERE ($1::integer IS NULL OR id = $1) ORDER BY nombre', [sucursalId])
    ]);

    const datos = { ok: true, filtros: { desde: fechaDesde, hasta: fechaHasta, agrupacion, sucursal_id: sucursalId }, resumen: resumen.rows[0], serie: serie.rows, productos: productos.rows, productos_menos: productosMenos.rows, categorias: categorias.rows, sucursales: sucursales.rows, opciones_sucursales: opcionesSucursales.rows, horas: horas.rows, pagos: pagos.rows, vendedores: vendedores.rows, vendedores_menos: vendedoresMenos.rows, agotamiento: agotamiento.rows };
    if (esAdministrador(req.usuario)) {
      const [gananciaTotal, gananciaSucursales, gananciaProductos, gananciaVendedores, gananciaPagos] = await Promise.all([
        pool.query(`SELECT COALESCE(SUM(d.ganancia_bruta), 0) AS ganancia, COUNT(*) FILTER (WHERE d.ganancia_bruta IS NULL)::integer AS detalles_sin_costo FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ($3::integer IS NULL OR v.sucursal_id = $3)`, parametros),
        pool.query(`SELECT v.sucursal_id AS id, COALESCE(SUM(d.ganancia_bruta), 0) AS ganancia FROM ventas v JOIN detalle_ventas d ON d.venta_id = v.id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ($3::integer IS NULL OR v.sucursal_id = $3) GROUP BY v.sucursal_id`, parametros),
        pool.query(`SELECT d.producto_id AS id, COALESCE(SUM(d.ganancia_bruta), 0) AS ganancia FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ($3::integer IS NULL OR v.sucursal_id = $3) GROUP BY d.producto_id`, parametros),
        pool.query(`SELECT COALESCE(u.nombre, 'Usuario eliminado') AS nombre, COALESCE(SUM(d.ganancia_bruta), 0) AS ganancia FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ($3::integer IS NULL OR v.sucursal_id = $3) GROUP BY u.nombre`, parametros),
        pool.query(`SELECT UPPER(COALESCE(p.metodo, 'OTROS')) AS metodo, COALESCE(SUM(d.ganancia_bruta * p.monto / NULLIF(v.total, 0)), 0) AS ganancia FROM pagos p JOIN ventas v ON v.id = p.venta_id JOIN detalle_ventas d ON d.venta_id = v.id WHERE v.estado = 'completada' AND v.fecha >= $1::date AND v.fecha < ($2::date + INTERVAL '1 day') AND ($3::integer IS NULL OR v.sucursal_id = $3) GROUP BY 1`, parametros)
      ]);
      datos.resumen.ganancia_bruta = Number(gananciaTotal.rows[0]?.ganancia || 0);
      datos.resumen.detalles_sin_costo = Number(gananciaTotal.rows[0]?.detalles_sin_costo || 0);
      const porSucursal = new Map(gananciaSucursales.rows.map((item) => [Number(item.id), Number(item.ganancia)]));
      const porProducto = new Map(gananciaProductos.rows.map((item) => [Number(item.id), Number(item.ganancia)]));
      const porVendedor = new Map(gananciaVendedores.rows.map((item) => [item.nombre, Number(item.ganancia)]));
      const porMetodo = new Map(gananciaPagos.rows.map((item) => [item.metodo, Number(item.ganancia)]));
      datos.sucursales = datos.sucursales.map((item) => ({ ...item, ganancia_bruta: porSucursal.get(Number(item.id)) || 0 }));
      datos.productos = datos.productos.map((item) => ({ ...item, ganancia_bruta: porProducto.get(Number(item.id)) || 0 }));
      datos.productos_menos = datos.productos_menos.map((item) => ({ ...item, ganancia_bruta: porProducto.get(Number(item.id)) || 0 }));
      datos.vendedores = datos.vendedores.map((item) => ({ ...item, ganancia_bruta: porVendedor.get(item.nombre) || 0 }));
      datos.vendedores_menos = datos.vendedores_menos.map((item) => ({ ...item, ganancia_bruta: porVendedor.get(item.nombre) || 0 }));
      datos.pagos = datos.pagos.map((item) => ({ ...item, ganancia_bruta: porMetodo.get(item.metodo) || 0 }));
    }
    res.json(datos);
  } catch (error) {
    console.error('ERROR REPORTES:', error.message);
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.get('/api/ventas/historial', autenticar, async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);
    if (!sucursalId) return res.status(400).json({ ok: false, mensaje: 'Falta la sucursal' });
    if (!validarSucursal(req.usuario, sucursalId)) return res.status(403).json({ ok: false, mensaje: 'No puedes consultar ventas de otra sucursal' });
    const limite = Math.min(Number(req.query.limite) || 30, 100);
    const resultado = await pool.query(
      `
      SELECT v.id, v.fecha, v.subtotal, v.impuesto, v.impuesto_porcentaje,
        v.total, v.estado, v.usuario_id, u.nombre AS usuario_nombre,
        s.nombre AS sucursal_nombre,
        v.cliente_nombre, v.cliente_telefono,
        p.metodo AS metodo_pago, p.monto AS monto_pagado,
        COALESCE(json_agg(json_build_object(
          'detalle_venta_id', dv.id, 'producto_id', dv.producto_id, 'nombre', pr.nombre,
          'cantidad', dv.cantidad, 'cantidad_presentacion', COALESCE(dv.cantidad_presentacion, dv.cantidad / NULLIF(dv.factor_presentacion, 0)), 'precio', dv.precio_unitario,
          'presentacion_nombre', dv.presentacion_nombre, 'factor_presentacion', dv.factor_presentacion,
          'subtotal', dv.subtotal, 'descuento_asignado', COALESCE(dv.descuento_asignado, 0),
          'cantidad_devuelta', COALESCE((SELECT SUM(dvd.cantidad_presentacion) FROM devoluciones_ventas_detalle dvd WHERE dvd.detalle_venta_id = dv.id), 0)
        ) ORDER BY dv.id) FILTER (WHERE dv.id IS NOT NULL), '[]') AS items
        , COALESCE((SELECT json_agg(json_build_object('id', d.id, 'codigo', d.codigo, 'tipo', d.tipo, 'motivo', d.motivo, 'monto', d.monto, 'fecha', d.fecha) ORDER BY d.id)
          FROM devoluciones_ventas d WHERE d.venta_id = v.id), '[]') AS devoluciones
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN sucursales s ON s.id = v.sucursal_id
      LEFT JOIN pagos p ON p.venta_id = v.id
      LEFT JOIN detalle_ventas dv ON dv.venta_id = v.id
      LEFT JOIN productos pr ON pr.id = dv.producto_id
      WHERE v.sucursal_id = $1
      GROUP BY v.id, u.nombre, s.nombre, p.metodo, p.monto, v.cliente_nombre, v.cliente_telefono
      ORDER BY v.fecha DESC
      LIMIT $2
      `,
      [sucursalId, limite]
    );
    res.json({ ok: true, ventas: resultado.rows });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/ventas/:id/devolucion', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!esAdministrador(req.usuario)) return res.status(403).json({ ok: false, mensaje: 'Solo el dueño o un administrador puede aprobar una devolución' });

    const ventaId = Number(req.params.id);
    const { motivo, items = [], tipo = 'total' } = req.body;
    if (!ventaId || !motivo?.trim()) throw new Error('Debe indicar el motivo de la devolución');
    if (!['total', 'parcial'].includes(tipo)) throw new Error('El tipo de devolución no es válido');
    if (tipo === 'parcial' && (!Array.isArray(items) || !items.length)) throw new Error('Selecciona los productos y cantidades de la devolución parcial');
    await client.query('BEGIN');
    const venta = await client.query(`SELECT id, sucursal_id, estado, total, impuesto_porcentaje FROM ventas WHERE id = $1 FOR UPDATE`, [ventaId]);
    if (!venta.rows.length || !['completada', 'devuelta_parcial'].includes(venta.rows[0].estado)) throw new Error('La venta no está disponible para devolución');
    const { sucursal_id: sucursalId, impuesto_porcentaje: impuestoPorcentaje } = venta.rows[0];
    if (!validarSucursal(req.usuario, sucursalId)) throw new Error('No puedes devolver ventas de otra sucursal');
    const cajaAbierta = await client.query(
      `SELECT id, fecha_apertura FROM caja_sesiones
       WHERE sucursal_id = $1 AND estado = 'abierta'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [sucursalId]
    );
    if (!cajaAbierta.rows.length) throw new Error('Abre la caja de esta sucursal antes de procesar una devolución');
    if (cajaExpirada(cajaAbierta.rows[0].fecha_apertura)) throw new Error('La caja superó las 24 horas; debe contarse y cerrarse antes de procesar una devolución');

    // El método de pago no está en la tabla de ventas: está en pagos.
    const pagoVenta = await client.query('SELECT metodo FROM pagos WHERE venta_id = $1 LIMIT 1', [ventaId]);
    const metodoPago = String(pagoVenta.rows[0]?.metodo || 'EFECTIVO').toUpperCase();

    const detalles = await client.query(
      `SELECT dv.id, dv.producto_id, p.nombre, dv.cantidad,
        COALESCE(dv.cantidad_presentacion, dv.cantidad / NULLIF(dv.factor_presentacion, 0)) AS cantidad_presentacion,
        COALESCE(dv.factor_presentacion, 1) AS factor_presentacion, dv.presentacion_nombre,
        dv.subtotal, COALESCE(dv.descuento_asignado, 0) AS descuento_asignado,
        COALESCE((SELECT SUM(dvd.cantidad_presentacion) FROM devoluciones_ventas_detalle dvd WHERE dvd.detalle_venta_id = dv.id), 0) AS cantidad_devuelta
       FROM detalle_ventas dv JOIN productos p ON p.id = dv.producto_id WHERE dv.venta_id = $1 ORDER BY dv.id FOR UPDATE OF dv`,
      [ventaId]
    );
    const detallesPorId = new Map(detalles.rows.map((detalle) => [Number(detalle.id), detalle]));
    const cantidadesSolicitadas = new Map();
    if (tipo === 'total') {
      for (const detalle of detalles.rows) cantidadesSolicitadas.set(Number(detalle.id), Number(detalle.cantidad_presentacion) - Number(detalle.cantidad_devuelta));
    } else {
      for (const item of items) {
        const detalleId = Number(item.detalle_venta_id);
        const cantidad = Number(item.cantidad_presentacion);
        const detalle = detallesPorId.get(detalleId);
        if (!detalle || !Number.isFinite(cantidad) || cantidad <= 0) throw new Error('Una línea de devolución no es válida');
        const pendiente = Number(detalle.cantidad_presentacion) - Number(detalle.cantidad_devuelta);
        const acumulada = (cantidadesSolicitadas.get(detalleId) || 0) + cantidad;
        if (acumulada > pendiente) throw new Error(`La cantidad de ${detalle.nombre} supera lo que falta devolver`);
        cantidadesSolicitadas.set(detalleId, acumulada);
      }
    }
    const detallesADevolver = [];
    let montoDevolucion = 0;
    for (const [detalleId, cantidadPresentacion] of cantidadesSolicitadas) {
      if (cantidadPresentacion <= 0) continue;
      const detalle = detallesPorId.get(detalleId);
      const cantidadBase = cantidadPresentacion * Number(detalle.factor_presentacion || 1);
      const netoPorPresentacion = (Number(detalle.subtotal) - Number(detalle.descuento_asignado)) / Number(detalle.cantidad_presentacion);
      const monto = netoPorPresentacion * cantidadPresentacion * (1 + Number(impuestoPorcentaje || 0) / 100);
      detallesADevolver.push({ detalle, cantidadPresentacion, cantidadBase, monto });
      montoDevolucion += monto;
    }
    if (!detallesADevolver.length || montoDevolucion <= 0) throw new Error('No hay cantidades pendientes para devolver');
    montoDevolucion = Number(montoDevolucion.toFixed(2));
    const codigo = `DEV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const documento = await client.query(
      'INSERT INTO devoluciones_ventas (venta_id, usuario_id, motivo, codigo, tipo, monto) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, codigo, tipo, fecha, monto',
      [ventaId, req.usuario.id, motivo.trim(), codigo, tipo, montoDevolucion.toFixed(2)]
    );
    for (const linea of detallesADevolver) {
      const stock = await client.query('SELECT id FROM inventario WHERE producto_id = $1 AND sucursal_id = $2 FOR UPDATE', [linea.detalle.producto_id, sucursalId]);
      if (stock.rows.length) {
        await client.query('UPDATE inventario SET stock_actual = stock_actual + $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3', [linea.cantidadBase, linea.detalle.producto_id, sucursalId]);
      } else {
        await client.query('INSERT INTO inventario (producto_id, sucursal_id, stock_actual, stock_minimo) VALUES ($1,$2,$3,0)', [linea.detalle.producto_id, sucursalId, linea.cantidadBase]);
      }
      await client.query(
        'INSERT INTO devoluciones_ventas_detalle (devolucion_id, detalle_venta_id, cantidad_presentacion, cantidad_base, monto) VALUES ($1,$2,$3,$4,$5)',
        [documento.rows[0].id, linea.detalle.id, linea.cantidadPresentacion, linea.cantidadBase, linea.monto.toFixed(2)]
      );
    }
    const saldo = await client.query(
      `SELECT COUNT(*)::integer AS pendientes FROM detalle_ventas dv
       WHERE dv.venta_id = $1 AND COALESCE(dv.cantidad_presentacion, dv.cantidad / NULLIF(dv.factor_presentacion, 0)) >
       COALESCE((SELECT SUM(dvd.cantidad_presentacion) FROM devoluciones_ventas_detalle dvd WHERE dvd.detalle_venta_id = dv.id), 0)`,
      [ventaId]
    );
    if (saldo.rows[0].pendientes === 0) await client.query(`UPDATE ventas SET estado = 'devuelta' WHERE id = $1`, [ventaId]);
    else await client.query(`UPDATE ventas SET estado = 'devuelta_parcial' WHERE id = $1`, [ventaId]);

    await client.query(
      `INSERT INTO caja_movimientos (caja_id, usuario_id, tipo, metodo, concepto, monto) VALUES ($1,$2,'egreso',$3,$4,$5)`,
      [cajaAbierta.rows[0].id, req.usuario.id, metodoPago || 'EFECTIVO', `${tipo === 'total' ? 'Devolución total' : 'Devolución parcial'} ${codigo} · venta #${ventaId}: ${motivo.trim()}`, montoDevolucion]
    );

    await client.query('COMMIT');
    res.json({ ok: true, devolucion: { ...documento.rows[0], venta_id: ventaId, motivo: motivo.trim(), items: detallesADevolver.map((linea) => ({ nombre: linea.detalle.nombre, presentacion_nombre: linea.detalle.presentacion_nombre, cantidad_presentacion: linea.cantidadPresentacion, monto: Number(linea.monto.toFixed(2)) })) }, estado_venta: saldo.rows[0].pendientes === 0 ? 'devuelta' : 'devuelta_parcial', mensaje: 'Devolución registrada; se repuso el stock y el reembolso quedó en caja' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/ventas', autenticar, async (req, res) => {

  const client = await pool.connect();


  try {

    const {
      usuario_id,
      sucursal_id,
      items,
      metodo_pago,
      monto_recibido,
      cliente_id = null,
      cliente_nombre = null,
      cliente_telefono = null,
      descuento = 0,
      impuesto_porcentaje = 0
    } = req.body;

    const usuarioVenta = await client.query('SELECT u.id, u.rol_id, r.nombre AS rol FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id WHERE u.id = $1 AND u.activo = true', [usuario_id]);
    if (!usuarioVenta.rows.length) throw new Error('El usuario de la venta no es válido');
    if (Number(descuento) > 0 && !puedeAutorizarDescuento(usuarioVenta.rows[0])) throw new Error('El descuento requiere autorización del dueño o jefe');



    if (!usuario_id || !sucursal_id) {

      return res.status(400).json({
        ok: false,
        mensaje: 'Falta usuario o sucursal'
      });

    }

    if (Number(usuario_id) !== Number(req.usuario.id) || !validarSucursal(req.usuario, sucursal_id)) {
      throw new Error('La venta no corresponde a la sesión actual');
    }



    if (!Array.isArray(items) || items.length === 0) {

      return res.status(400).json({
        ok: false,
        mensaje: 'La venta no tiene productos'
      });

    }



    if (!metodo_pago) {

      return res.status(400).json({
        ok: false,
        mensaje: 'Debe indicar el método de pago'
      });

    }



    await client.query('BEGIN');

    const cajaResult = await client.query(
      `SELECT id, fecha_apertura FROM caja_sesiones
       WHERE sucursal_id = $1 AND estado = 'abierta'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [sucursal_id]
    );

    if (cajaResult.rows.length === 0) {
      throw new Error('Debe abrir la caja antes de registrar una venta');
    }
    if (cajaExpirada(cajaResult.rows[0].fecha_apertura)) {
      throw new Error('La caja superó las 24 horas; debe contarse y cerrarse antes de registrar ventas');
    }

    const cajaId = cajaResult.rows[0].id;


    const productosParaBloquear = [...new Set(items.map((item) => Number(item.producto_id)))].filter(Number.isInteger).sort((a, b) => a - b);
    const inventarioBloqueado = await client.query(
      'SELECT producto_id FROM inventario WHERE sucursal_id = $1 AND producto_id = ANY($2::integer[]) ORDER BY producto_id FOR UPDATE',
      [sucursal_id, productosParaBloquear]
    );
    if (inventarioBloqueado.rows.length !== productosParaBloquear.length) {
      throw new Error('Uno o más productos no tienen inventario registrado en esta sucursal');
    }



    let subtotal = 0;
    const detalles = [];



    for (const item of items) {


      const productoId = Number(item.producto_id);
      const cantidad = Number(item.cantidad);
      const presentacionId = Number(item.presentacion_id) || null;



      if (
        !Number.isFinite(productoId) ||
        !Number.isFinite(cantidad) ||
        cantidad <= 0
      ) {

        throw new Error(
          'Producto o cantidad inválida'
        );

      }



      const resultado = await client.query(
        `
        SELECT
          p.id,
          p.nombre,
          pres.id AS presentacion_id,
          pres.nombre AS presentacion_nombre,
          COALESCE(pres.factor, 1) AS factor_presentacion,
          COALESCE(pres.precio_venta, pp.precio_venta_actual, 0) AS precio_venta,
          COALESCE(pres.costo, pp.precio_compra_actual * COALESCE(pres.factor, 1)) AS costo_presentacion,
          COALESCE(i.stock_actual,0) AS stock_actual
        FROM productos p

        LEFT JOIN LATERAL
        (
          SELECT precio_compra_actual, precio_venta_actual
          FROM precios_productos
          WHERE producto_id = p.id
          ORDER BY fecha_cambio DESC,id DESC
          LIMIT 1

        ) pp ON true

        LEFT JOIN producto_presentaciones pres
          ON pres.id = $3
          AND pres.producto_id = p.id
          AND pres.activo = true


        LEFT JOIN inventario i
          ON i.producto_id = p.id
          AND i.sucursal_id = $2


        WHERE p.id = $1
          AND p.activo = true

        `,
        [
          productoId,
          sucursal_id,
          presentacionId
        ]
      );



      if (resultado.rows.length === 0) {

        throw new Error(
          `Producto ${productoId} no encontrado`
        );

      }



      const producto = resultado.rows[0];
      if (presentacionId && !producto.presentacion_id) {
        throw new Error('La presentación seleccionada no corresponde al producto');
      }


      const precio = Number(producto.precio_venta);
      const stock = Number(producto.stock_actual);
      const factorPresentacion = Number(producto.factor_presentacion);
      const cantidadInventario = cantidad * factorPresentacion;



      if (cantidadInventario > stock) {

        throw new Error(
          `Stock insuficiente para ${producto.nombre}. Disponible: ${stock}`
        );

      }



      const subtotalItem = Number((precio * cantidad).toFixed(2));


      subtotal += subtotalItem;



      detalles.push({

        producto_id: producto.id,
        cantidad: cantidadInventario,
        cantidad_presentacion: cantidad,
        presentacion_nombre: producto.presentacion_nombre || null,
        factor_presentacion: factorPresentacion,
        precio_unitario: precio,
        costo_presentacion: producto.costo_presentacion == null ? null : Number(producto.costo_presentacion),
        subtotal: subtotalItem

      });


    }



    const descuentoSolicitado = Number(descuento) || 0;
    if (!Number.isFinite(descuentoSolicitado) || descuentoSolicitado < 0) throw new Error('El descuento debe ser un monto válido y no negativo');
    const descuentoNumero = Number(Math.min(Math.round(descuentoSolicitado * 100) / 100, subtotal).toFixed(2));

    let descuentoAcumuladoCentavos = 0;
    const descuentoTotalCentavos = Math.round(descuentoNumero * 100);
    detalles.forEach((detalle, indice) => {
      const descuentoLineaCentavos = indice === detalles.length - 1
        ? descuentoTotalCentavos - descuentoAcumuladoCentavos
        : (subtotal > 0 ? Math.floor(descuentoTotalCentavos * detalle.subtotal / subtotal) : 0);
      descuentoAcumuladoCentavos += descuentoLineaCentavos;
      const descuentoLinea = descuentoLineaCentavos / 100;
      detalle.descuento_asignado = descuentoLinea;
      detalle.ganancia_bruta = detalle.costo_presentacion == null
        ? null
        : Number((detalle.subtotal - descuentoLinea - detalle.costo_presentacion * detalle.cantidad_presentacion).toFixed(2));
      detalle.costo_unitario = detalle.costo_presentacion == null
        ? null
        : detalle.costo_presentacion / detalle.factor_presentacion;
    });


    const total = Math.max(
      0,
      subtotal - descuentoNumero
    );

    const impuestoPorcentajeNumero = Math.max(0, Number(impuesto_porcentaje) || 0);
    const impuestoNumero = total * impuestoPorcentajeNumero / 100;
    const totalConImpuesto = total + impuestoNumero;



    const montoRecibido =
      monto_recibido === undefined ||
      monto_recibido === null

      ? totalConImpuesto

      : Number(monto_recibido);



    if (
      !Number.isFinite(montoRecibido) ||
      montoRecibido < totalConImpuesto
    ) {

      throw new Error(
        `Monto recibido insuficiente. Total: ${totalConImpuesto.toFixed(2)}`
      );

    }



    const cambio = montoRecibido - totalConImpuesto;

    const ventaResult = await client.query(
      `
      INSERT INTO ventas
      (
        sucursal_id,
        usuario_id,
        cliente_id,
        cliente_nombre,
        cliente_telefono,
        subtotal,
        descuento,
        impuesto_porcentaje,
        impuesto,
        total,
        caja_id,
        estado
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completada')

      RETURNING
        id,
        fecha,
        subtotal,
        descuento,
        impuesto,
        total,
        cliente_nombre,
        cliente_telefono,
        estado
      `,
      [
        sucursal_id,
        usuario_id,
        cliente_id,
        cliente_nombre,
        cliente_telefono,
        subtotal.toFixed(2),
        descuentoNumero.toFixed(2),
        impuestoPorcentajeNumero.toFixed(2),
        impuestoNumero.toFixed(2),
        totalConImpuesto.toFixed(2),
        cajaId
      ]
    )



    const venta = ventaResult.rows[0]

    const contextoVenta = await client.query('SELECT (SELECT nombre FROM usuarios WHERE id = $1) AS usuario_nombre, (SELECT nombre FROM sucursales WHERE id = $2) AS sucursal_nombre', [usuario_id, sucursal_id])
    venta.usuario_nombre = contextoVenta.rows[0]?.usuario_nombre || null
    venta.sucursal_nombre = contextoVenta.rows[0]?.sucursal_nombre || null



    for (const detalle of detalles) {


      await client.query(
        `
        INSERT INTO detalle_ventas
        (
          venta_id,
          producto_id,
          cantidad,
          cantidad_presentacion,
          presentacion_nombre,
          factor_presentacion,
          precio_unitario,
          subtotal,
          costo_unitario,
          costo_presentacion,
          descuento_asignado,
          ganancia_bruta
        )

        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)

        `,
        [
          venta.id,
          detalle.producto_id,
          detalle.cantidad,
          detalle.cantidad_presentacion,
          detalle.presentacion_nombre,
          detalle.factor_presentacion,
          detalle.precio_unitario.toFixed(2),
          detalle.subtotal.toFixed(2),
          detalle.costo_unitario == null ? null : detalle.costo_unitario.toFixed(4),
          detalle.costo_presentacion == null ? null : detalle.costo_presentacion.toFixed(2),
          detalle.descuento_asignado.toFixed(2),
          detalle.ganancia_bruta == null ? null : detalle.ganancia_bruta.toFixed(2)
        ]
      )



      const stockResult = await client.query(
        `
        UPDATE inventario

        SET
          stock_actual = stock_actual - $1,
          ultima_actualizacion = CURRENT_TIMESTAMP

        WHERE producto_id = $2
          AND sucursal_id = $3
          AND stock_actual >= $1

        RETURNING stock_actual

        `,
        [
          detalle.cantidad,
          detalle.producto_id,
          sucursal_id
        ]
      )



      if (stockResult.rows.length === 0) {

        throw new Error(
          'No se pudo actualizar el inventario'
        )

      }

    }



    await client.query(
      `
      INSERT INTO pagos
      (
        venta_id,
        metodo,
        monto,
        referencia
      )

      VALUES
      ($1,$2,$3,$4)

      `,
      [
        venta.id,
        String(metodo_pago).toUpperCase(),
        totalConImpuesto.toFixed(2),
        req.body.referencia || null
      ]
    )



    await client.query('COMMIT')



    res.status(201).json({

      ok: true,

      mensaje: 'Venta registrada correctamente',

      venta: {

        id: venta.id,

        fecha: venta.fecha,

        subtotal: Number(venta.subtotal),
        descuento: Number(venta.descuento),

        descuento: Number(venta.descuento),

        total: Number(venta.total),
        impuesto: Number(venta.impuesto),
        impuesto_porcentaje: impuestoPorcentajeNumero,
        cliente_nombre: venta.cliente_nombre,
        cliente_telefono: venta.cliente_telefono,

        metodo_pago:
          String(metodo_pago).toUpperCase(),

        monto_recibido:
          Number(montoRecibido.toFixed(2)),

        cambio:
          Number(cambio.toFixed(2))

      }

    })



  } catch (error) {


    await client.query('ROLLBACK')


    console.error(
      'ERROR VENTA:',
      error.message
    )



    res.status(400).json({

      ok: false,

      mensaje: error.message

    })



  } finally {


    client.release()


  }

})



// =====================================
// INICIAR SERVIDOR
// =====================================


const PORT = process.env.PORT || 3000

const iniciarServidor = async () => {
  try {
    await inicializarTablasCaja()
    app.listen(PORT, () => {


      console.log('')

      console.log('======================================')

      console.log('       ERP TIERI - BACKEND')

      console.log('======================================')

      console.log('Servidor ejecutándose en http://localhost:' + PORT)

      console.log('Base de datos: ' + process.env.DB_NAME)

      console.log('======================================')

      console.log('')
    })
  } catch (error) {
    console.error('ERROR INICIALIZANDO CAJA:', error.message)
    process.exit(1)
  }
}

iniciarServidor()



