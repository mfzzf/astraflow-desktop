-- AstraFlow API PostgreSQL bootstrap 0000.
--
-- Run this against an admin database, usually "postgres", before applying
-- schema migrations to a new online PostgreSQL instance.
--
-- Example:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v app_db=astraflow \
--     -v app_user=astraflow_app \
--     -v app_password='REPLACE_WITH_A_STRONG_PASSWORD' \
--     -f backend/astraflow-api/migration/0000_bootstrap_database.sql

\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE %I WITH LOGIN PASSWORD %L',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'app_user'
)
\gexec

SELECT format(
  'CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0',
  :'app_db',
  :'app_user',
  'UTF8'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = :'app_db'
)
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  :'app_db',
  :'app_user'
)
\gexec
