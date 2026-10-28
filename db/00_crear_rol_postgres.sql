-- Ejecutar conectado a una base de mantenimiento (por ejemplo, postgres).
-- El rol no tiene una contraseña predeterminada. Asignarla interactivamente
-- con \password tieri_app desde psql antes de usarlo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tieri_app') THEN
    CREATE ROLE tieri_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT;
  END IF;
END;
$$;
