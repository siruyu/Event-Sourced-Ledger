-- ============================================================================
-- App role provisioning for append-only ledger enforcement (architecture.md §7.3)
--
-- Creates a restricted `ledger_app` role that can only SELECT/INSERT on `entries`
-- (never UPDATE/DELETE), so the append-only guarantee is enforced by the database
-- itself, not just by application discipline.
--
-- Apply with a privileged (migration/superuser) connection and a real password:
--
--   psql "$DATABASE_URL" -v app_password='a-strong-secret' -f db/roles.sql
--
-- Then point the API at it, e.g.:
--
--   DATABASE_URL=postgres://ledger_app:<password>@localhost:5432/ledger
--
-- NOTE: local development (docker-compose, the default DATABASE_URL) still uses
-- the owner role; apply this script before any production-ish deployment.
-- ============================================================================

-- Idempotent role creation. Password comes from the psql -v variable so no
-- secret is committed to the repo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN PASSWORD :'app_password';
  ELSE
    ALTER ROLE ledger_app PASSWORD :'app_password';
  END IF;
END
$$;

-- Schema + connection access.
GRANT CONNECT ON DATABASE ledger TO ledger_app;
GRANT USAGE ON SCHEMA public TO ledger_app;

-- accounts: full read, plus metadata/sequence/status updates.
GRANT SELECT, INSERT, UPDATE ON accounts TO ledger_app;

-- transactions: read + insert, plus void-status updates.
GRANT SELECT, INSERT, UPDATE ON transactions TO ledger_app;

-- entries: the append-only event log — SELECT + INSERT ONLY.
-- UPDATE/DELETE are deliberately NOT granted, enforcing append-only at the DB.
GRANT SELECT, INSERT ON entries TO ledger_app;

-- snapshots (stretch): read + write when snapshotting lands.
GRANT SELECT, INSERT ON snapshots TO ledger_app;

-- Identity-column sequences used by INSERTs.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;

-- Keep new tables covered.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO ledger_app;
