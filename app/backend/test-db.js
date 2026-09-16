require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

pool.query('SELECT current_database() AS base, current_user AS usuario')
  .then(result => {
    console.log('CONEXION CORRECTA');
    console.log(result.rows[0]);
  })
  .catch(error => {
    console.error('ERROR DE CONEXION');
    console.error(error.message);
  })
  .finally(() => pool.end());
