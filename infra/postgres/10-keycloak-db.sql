-- Keycloak guarda su estado en la misma instancia de Postgres, en su propia base de datos.
-- Solo corre en la primera inicializacion del volumen; en uno existente, crearla a mano:
--   docker compose exec db psql -U crokbit -d crokbit -c 'CREATE DATABASE keycloak OWNER crokbit'
CREATE DATABASE keycloak OWNER crokbit;
