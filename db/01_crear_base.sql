-- Ejecutar una sola vez conectado a la base postgres como administrador.
CREATE DATABASE tieri_erp
  WITH OWNER = tieri_app
       ENCODING = 'UTF8'
       TEMPLATE = template0;
