const path = require('path');
const { createRequire } = require('module');

const backendRequire = createRequire(path.resolve(__dirname, '..', 'app', 'backend', 'package.json'));
backendRequire('dotenv').config({
  path: path.resolve(__dirname, '..', 'app', 'backend', '.env')
});

const { Pool } = backendRequire('pg');
const bcrypt = backendRequire('bcryptjs');

const required = ['INITIAL_ADMIN_NAME', 'INITIAL_ADMIN_USERNAME', 'INITIAL_ADMIN_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Define estas variables de entorno antes de continuar: ${missing.join(', ')}`);
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const crearAdministrador = async () => {
  const username = process.env.INITIAL_ADMIN_USERNAME.trim();
  const name = process.env.INITIAL_ADMIN_NAME.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!name || !username || password.length < 12) {
    throw new Error('El nombre y usuario son obligatorios; la contraseña debe tener al menos 12 caracteres.');
  }

  const cuentaExistente = await pool.query(
    'SELECT id FROM usuarios WHERE LOWER(usuario) = LOWER($1)',
    [username]
  );
  if (cuentaExistente.rows.length) {
    throw new Error('Ya existe un usuario con ese nombre. No se modificó ninguna cuenta.');
  }

  const base = await pool.query(
    'SELECT (SELECT id FROM roles WHERE id = 1) AS rol_id, (SELECT id FROM sucursales WHERE id = 1) AS sucursal_id'
  );
  if (!base.rows[0].rol_id || !base.rows[0].sucursal_id) {
    throw new Error('No existe el rol inicial o la sucursal principal. Ejecuta primero 03_datos_iniciales.sql.');
  }

  const permisos = [
    'ventas.ver',
    'inventario.ver',
    'inventario.crear',
    'inventario.editar',
    'inventario.solo_propios',
    'inventario.transferir',
    'compras.ver',
    'compras.crear',
    'precios.compra.ver',
    'cotizaciones.ver',
    'cotizaciones.crear',
    'cotizaciones.eliminar',
    'caja.ver',
    'reportes.ver',
    'clientes.ver',
    'proveedores.ver'
  ];
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO usuarios
       (nombre, usuario, password_hash, rol_id, sucursal_id, permisos, activo)
     VALUES ($1, $2, $3, 1, 1, $4::jsonb, true)
     RETURNING id, nombre, usuario`,
    [name, username, passwordHash, JSON.stringify(permisos)]
  );

  console.log(`Administrador inicial creado: ${result.rows[0].usuario} (id ${result.rows[0].id}).`);
};

crearAdministrador()
  .catch((error) => {
    console.error(`No se pudo crear el administrador inicial: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
