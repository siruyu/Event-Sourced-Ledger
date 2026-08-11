# Event-Sourced Ledger (Double-Entry Bank Core)

Model money the way real banks do: as an **immutable stream of events**, never mutable
balances. Built with event sourcing, double-entry accounting, and atomic invariant
enforcement.

## Documentation

- [PRD](./docs/prd.md) — what it does, who it's for, feature priorities, user flows
- [Architecture](./docs/architecture.md) — tech stack, schema, concurrency model, env vars
- [Tickets](./docs/ticket.md) — feature tickets with acceptance criteria and dependencies

## Quickstart

Prereqs: Node.js >= 20, a PostgreSQL 16 database (Docker or local).

```bash
npm install
cp .env.example .env        # point DATABASE_URL at your Postgres
npm run db:migrate          # apply schema migrations
npm run dev                 # start API on http://localhost:3000/api/v1
```

Health check: `GET /api/v1/health` → `{ "status": "ok", "timestamp": "..." }`

With Docker (optional):

```bash
docker compose up --build
```

## Testing

```bash
npm test                   # unit + integration (integration needs a test DB)
npm run test:unit
npm run test:integration
```

The integration suite runs against a real PostgreSQL database
(`TEST_DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/ledger_test`)
and includes a concurrency stress test proving "no lost updates" under parallel transfers.

## Production hardening (before exposing publicly)

- **Append-only DB role** — apply `db/roles.sql` with a privileged connection to create the
  restricted `ledger_app` role (SELECT/INSERT on `entries`, never UPDATE/DELETE), then point
  `DATABASE_URL` at it. See `db/roles.sql` for the exact command.
- **Auth + rate limiting** — the `API_KEYS` / `RATE_LIMIT_*` env vars (T-24) are not yet
  implemented; keep the API on a private network until they land.

## Key API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `POST` | `/accounts` | Create account |
| `GET` | `/accounts` | List accounts (with derived balances) |
| `GET` | `/accounts/:id/balance?as_of=` | Current or point-in-time balance |
| `POST` | `/accounts/:id/deposits` | Deposit |
| `POST` | `/accounts/:id/withdrawals` | Withdraw |
| `POST` | `/transfers` | Atomic transfer |
| `GET` | `/accounts/:id/audit?as_of=` | Audit trail / balance reconstruction |

## Design guarantees

- **Append-only ledger** — every balance change is an immutable event; nothing is `UPDATE`d
  or `DELETE`d.
- **Double-entry** — every transaction's debits sum to its credits.
- **Derived balances** — current balance is replayed from history, never stored.
- **Atomic rejection** — an overdraft (or any invariant violation) aborts with no partial
  writes.
- **Concurrency-safe** — row locks in deterministic order + unique per-account sequence
  numbers; no lost updates.
