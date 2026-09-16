require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const inicializarTablasCaja = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caja_sesiones (
      id SERIAL PRIMARY KEY,
      sucursal_id INTEGER NOT NULL,
      usuario_apertura_id INTEGER NOT NULL,
      fecha_apertura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      monto_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
      estado VARCHAR(20) NOT NULL DEFAULT 'abierta',
      fecha_cierre TIMESTAMP,
      usuario_cierre_id INTEGER,
      monto_esperado NUMERIC(12,2),
      monto_contado NUMERIC(12,2),
      diferencia NUMERIC(12,2),
      observacion TEXT
    );

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

    CREATE TABLE IF NOT EXISTS configuracion_tienda (
      sucursal_id INTEGER PRIMARY KEY,
      nombre VARCHAR(160) NOT NULL DEFAULT 'Tienda Tieri',
      direccion VARCHAR(240) NOT NULL DEFAULT '',
      telefono VARCHAR(60) NOT NULL DEFAULT '',
      logo TEXT NOT NULL DEFAULT '',
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
    const { usuario, password } = req.body;

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

    const token = jwt.sign(
      {
        id: user.id,
        usuario: user.usuario,
        rol_id: user.rol_id,
        sucursal_id: user.sucursal_id
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
        sucursal_id: user.sucursal_id
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

// =====================================
// PRODUCTOS
// =====================================

app.get('/api/configuracion', async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id)
    const resultado = await pool.query(
      `INSERT INTO configuracion_tienda (sucursal_id)
       VALUES ($1) ON CONFLICT (sucursal_id) DO UPDATE SET sucursal_id = EXCLUDED.sucursal_id
       RETURNING sucursal_id, nombre, direccion, telefono, logo`,
      [sucursalId]
    )
    res.json({ ok: true, configuracion: resultado.rows[0] })
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

app.get('/api/productos', async (req, res) => {
  try {
    const resultado = await pool.query(
      `
      SELECT
        p.id,
        p.codigo_interno,
        p.codigo_barras,
        p.nombre,
        c.nombre AS categoria,
        p.marca,
        pr.nombre AS proveedor,
        p.unidad,
        p.descripcion,
        p.imagen_url,
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
        AND i.sucursal_id = 2
      WHERE p.activo = true
      ORDER BY p.nombre
      `
    );

    res.json({
      ok: true,
      productos: resultado.rows
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

app.get('/api/productos/deshabilitados', async (req, res) => {
  try {
    const resultado = await pool.query(
      `
      SELECT
        p.id,
        p.codigo_interno,
        p.codigo_barras,
        p.nombre,
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
        AND i.sucursal_id = 2
      WHERE p.activo = false
      ORDER BY p.nombre
      `
    );

    res.json({
      ok: true,
      productos: resultado.rows
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

app.put('/api/productos/:id/estado', async (req, res) => {
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

app.put('/api/productos/:id', async (req, res) => {
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
      stock_minimo,
      codigo_barras,
      imagen_url
    } = req.body;

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

    await pool.query(
      `
      UPDATE inventario
      SET
        stock_actual = $1,
        stock_minimo = $2
      WHERE producto_id = $3
        AND sucursal_id = 2
      `,
      [
        Number(stock_inicial) || 0,
        Number(stock_minimo) || 0,
        productoId
      ]
    );

    res.json({
      ok: true,
      mensaje: 'Producto actualizado correctamente',
      producto: actualizado.rows[0]
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
// CREAR PRODUCTO
// =====================================

app.post('/api/productos', async (req, res) => {
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
      imagen_url
    } = req.body


    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El nombre del producto es obligatorio'
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
        activo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
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
        imagen_url || null
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
        2,
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
        AND sucursal_id = 2
      `,
      [
        Number(stock_inicial) || 0,
        Number(stock_minimo) || 0,
        productoCreado.id
      ]
    )


    res.status(201).json({
      ok: true,
      mensaje: 'Producto creado correctamente',
      producto: productoCreado
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

app.get('/api/caja/estado', async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);

    if (!sucursalId) {
      return res.status(400).json({ ok: false, mensaje: 'Falta la sucursal' });
    }

    const cajaResult = await pool.query(
      `
      SELECT cs.*, u.nombre AS usuario_nombre
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

    res.json({
      ok: true,
      caja,
      resumen: {
        ...resumen,
        efectivo_esperado: efectivoEsperado,
        diferencia: 0,
        egresos: Number(resumen.egresos),
        total_ventas: Number(resumen.total_ventas)
      }
    });
  } catch (error) {
    console.error('ERROR ESTADO CAJA:', error.message);
    res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/caja/apertura', async (req, res) => {
  try {
    const { usuario_id, sucursal_id, monto_inicial = 0 } = req.body;
    const monto = Number(monto_inicial);

    if (!usuario_id || !sucursal_id || !Number.isFinite(monto) || monto < 0) {
      return res.status(400).json({ ok: false, mensaje: 'Los datos de apertura no son válidos' });
    }

    const resultado = await pool.query(
      `INSERT INTO caja_sesiones (sucursal_id, usuario_apertura_id, monto_inicial)
       VALUES ($1, $2, $3) RETURNING *`,
      [sucursal_id, usuario_id, monto.toFixed(2)]
    );

    res.status(201).json({ ok: true, caja: resultado.rows[0], mensaje: 'Caja abierta correctamente' });
  } catch (error) {
    const mensaje = error.code === '23505' ? 'Ya existe una caja abierta para esta sucursal' : error.message;
    res.status(400).json({ ok: false, mensaje });
  }
});

app.post('/api/caja/movimientos', async (req, res) => {
  try {
    const { caja_id, usuario_id, monto, tipo, metodo = 'EFECTIVO', concepto } = req.body;
    const montoNumero = Number(monto);

    if (!caja_id || !usuario_id || !concepto || !['ingreso', 'egreso'].includes(tipo) || !Number.isFinite(montoNumero) || montoNumero <= 0) {
      return res.status(400).json({ ok: false, mensaje: 'Los datos del movimiento no son válidos' });
    }

    const resultado = await pool.query(
      `INSERT INTO caja_movimientos (caja_id, usuario_id, tipo, metodo, concepto, monto)
       SELECT $1, $2, $3, UPPER($4), $5, $6
       WHERE EXISTS (SELECT 1 FROM caja_sesiones WHERE id = $1 AND estado = 'abierta')
       RETURNING *`,
      [caja_id, usuario_id, tipo, metodo, concepto.trim(), montoNumero.toFixed(2)]
    );

    if (resultado.rows.length === 0) throw new Error('La caja no está abierta');
    res.status(201).json({ ok: true, movimiento: resultado.rows[0], mensaje: 'Movimiento registrado correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

app.post('/api/caja/cierre', async (req, res) => {
  try {
    const { caja_id, usuario_id, monto_contado, observacion = '' } = req.body;
    const montoContado = Number(monto_contado);

    if (!caja_id || !usuario_id || !Number.isFinite(montoContado) || montoContado < 0) {
      return res.status(400).json({ ok: false, mensaje: 'El monto contado no es válido' });
    }

    const resultado = await pool.query(
      `
      WITH ventas AS (
        SELECT COALESCE(SUM(p.monto) FILTER (WHERE UPPER(p.metodo) = 'EFECTIVO'), 0) AS efectivo
        FROM pagos p JOIN ventas v ON v.id = p.venta_id
        JOIN caja_sesiones cs ON cs.sucursal_id = v.sucursal_id
        WHERE cs.id = $1 AND v.fecha >= cs.fecha_apertura AND v.estado = 'completada'
      ), movimientos AS (
        SELECT
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND UPPER(m.metodo) = 'EFECTIVO'), 0) AS ingresos,
          COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'egreso' AND UPPER(m.metodo) = 'EFECTIVO'), 0) AS egresos
        FROM caja_movimientos m WHERE m.caja_id = $1
      )
      UPDATE caja_sesiones cs
      SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP, usuario_cierre_id = $2,
          monto_esperado = cs.monto_inicial + ventas.efectivo + movimientos.ingresos - movimientos.egresos,
          monto_contado = $3,
          diferencia = $3 - (cs.monto_inicial + ventas.efectivo + movimientos.ingresos - movimientos.egresos),
          observacion = $4
      FROM ventas, movimientos
      WHERE cs.id = $1 AND cs.estado = 'abierta'
      RETURNING cs.*
      `,
      [caja_id, usuario_id, montoContado.toFixed(2), observacion]
    );

    if (resultado.rows.length === 0) throw new Error('La caja no está abierta');
    res.json({ ok: true, cierre: resultado.rows[0], mensaje: 'Caja cerrada correctamente' });
  } catch (error) {
    res.status(400).json({ ok: false, mensaje: error.message });
  }
});

// =====================================
// VENTAS
// =====================================

app.get('/api/ventas/historial', async (req, res) => {
  try {
    const sucursalId = Number(req.query.sucursal_id);
    const limite = Math.min(Number(req.query.limite) || 30, 100);
    const resultado = await pool.query(
      `
      SELECT v.id, v.fecha, v.subtotal, v.impuesto, v.impuesto_porcentaje,
        v.total, v.estado, v.usuario_id, u.nombre AS usuario_nombre,
        v.cliente_nombre, v.cliente_telefono,
        p.metodo AS metodo_pago, p.monto AS monto_pagado,
        COALESCE(json_agg(json_build_object(
          'producto_id', dv.producto_id, 'nombre', pr.nombre,
          'cantidad', dv.cantidad, 'precio', dv.precio_unitario,
          'subtotal', dv.subtotal
        ) ORDER BY dv.id) FILTER (WHERE dv.id IS NOT NULL), '[]') AS items
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN pagos p ON p.venta_id = v.id
      LEFT JOIN detalle_ventas dv ON dv.venta_id = v.id
      LEFT JOIN productos pr ON pr.id = dv.producto_id
      WHERE v.sucursal_id = $1
      GROUP BY v.id, u.nombre, p.metodo, p.monto, v.cliente_nombre, v.cliente_telefono
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

app.post('/api/ventas/:id/devolucion', async (req, res) => {
  const client = await pool.connect();
  try {
    const ventaId = Number(req.params.id);
    const { usuario_id, motivo } = req.body;
    if (!ventaId || !usuario_id || !motivo?.trim()) throw new Error('Debe indicar el motivo de la devolución');
    await client.query('BEGIN');
    const venta = await client.query(`SELECT id, sucursal_id, estado FROM ventas WHERE id = $1 FOR UPDATE`, [ventaId]);
    if (!venta.rows.length || venta.rows[0].estado !== 'completada') throw new Error('La venta no está disponible para devolución');
    const detalles = await client.query(`SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = $1`, [ventaId]);
    for (const detalle of detalles.rows) {
      await client.query(`UPDATE inventario SET stock_actual = stock_actual + $1, ultima_actualizacion = CURRENT_TIMESTAMP WHERE producto_id = $2 AND sucursal_id = $3`, [detalle.cantidad, detalle.producto_id, venta.rows[0].sucursal_id]);
    }
    await client.query(`INSERT INTO devoluciones_ventas (venta_id, usuario_id, motivo) VALUES ($1, $2, $3)`, [ventaId, usuario_id, motivo.trim()]);
    await client.query(`UPDATE ventas SET estado = 'devuelta' WHERE id = $1`, [ventaId]);
    await client.query('COMMIT');
    res.json({ ok: true, mensaje: 'Devolución registrada y stock repuesto' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ ok: false, mensaje: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/ventas', async (req, res) => {

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



    if (!usuario_id || !sucursal_id) {

      return res.status(400).json({
        ok: false,
        mensaje: 'Falta usuario o sucursal'
      });

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
      `SELECT id FROM caja_sesiones
       WHERE sucursal_id = $1 AND estado = 'abierta'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [sucursal_id]
    );

    if (cajaResult.rows.length === 0) {
      throw new Error('Debe abrir la caja antes de registrar una venta');
    }

    const cajaId = cajaResult.rows[0].id;



    let subtotal = 0;
    const detalles = [];



    for (const item of items) {


      const productoId = Number(item.producto_id);
      const cantidad = Number(item.cantidad);



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
          COALESCE(pp.precio_venta_actual,0) AS precio_venta,
          COALESCE(i.stock_actual,0) AS stock_actual
        FROM productos p

        LEFT JOIN LATERAL
        (
          SELECT precio_venta_actual
          FROM precios_productos
          WHERE producto_id = p.id
          ORDER BY fecha_cambio DESC,id DESC
          LIMIT 1

        ) pp ON true


        LEFT JOIN inventario i
          ON i.producto_id = p.id
          AND i.sucursal_id = $2


        WHERE p.id = $1
          AND p.activo = true

        `,
        [
          productoId,
          sucursal_id
        ]
      );



      if (resultado.rows.length === 0) {

        throw new Error(
          `Producto ${productoId} no encontrado`
        );

      }



      const producto = resultado.rows[0];


      const precio = Number(producto.precio_venta);
      const stock = Number(producto.stock_actual);



      if (cantidad > stock) {

        throw new Error(
          `Stock insuficiente para ${producto.nombre}. Disponible: ${stock}`
        );

      }



      const subtotalItem = precio * cantidad;


      subtotal += subtotalItem;



      detalles.push({

        producto_id: producto.id,
        cantidad,
        precio_unitario: precio,
        subtotal: subtotalItem

      });


    }



    const descuentoNumero = Number(descuento) || 0;


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



    for (const detalle of detalles) {


      await client.query(
        `
        INSERT INTO detalle_ventas
        (
          venta_id,
          producto_id,
          cantidad,
          precio_unitario,
          subtotal
        )

        VALUES
        ($1,$2,$3,$4,$5)

        `,
        [
          venta.id,
          detalle.producto_id,
          detalle.cantidad,
          detalle.precio_unitario.toFixed(2),
          detalle.subtotal.toFixed(2)
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



