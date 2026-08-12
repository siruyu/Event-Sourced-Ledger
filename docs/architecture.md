# Architecture — Event-Sourced Ledger (Double-Entry Bank Core)

| | |
|---|---|
| **Status** | Draft — v1.0 |
| **Date** | 2026-08-09 |
| **Related docs** | [`prd.md`](./prd.md), [`ticket.md`](./ticket.md) |

---

## 1. Design principles

1. **The event log is the source of truth.** The `entries` table is an append-only ledger.
   Every balance-affecting operation writes events; nothing is ever overwritten or deleted.
2. **Balances are projections, not data.** The current balance of an account is computed by
   replaying its events. The `accounts` table deliberately has **no balance column**.
3. **Double-entry is enforced at write time.** A transaction is only committed when its
   debits and credits sum to zero, evaluated inside the same database transaction that
   writes the events.
4. **Invariants fail atomically.** The overdraft check (and any other invariant) happens
   *before* any event is written, inside the transaction. On violation, the entire
   transaction rolls back — no partial transfers.
5. **Money is never a float.** Amounts are decimal strings on the wire, `NUMERIC(19,4)` in
   the database, and integers/`BigInt` minor units inside the domain layer.
6. **Layered architecture.** Domain logic is pure and database-agnostic; the infrastructure
   layer (PostgreSQL, HTTP) is replaceable without touching business rules.

---

## 2. High-level architecture

```
                         ┌──────────────────────────────┐
                         │        Web UI (stretch)       │
                         │   React + Vite + Tailwind     │
                         └──────────────┬───────────────┘
                                        │  REST (JSON)
                         ┌──────────────▼───────────────┐
                         │        REST API (NestJS)      │
                         │  ┌─────────────────────────┐  │
                         │  │  interfaces (HTTP/DTOs)  │  │
                         │  ├─────────────────────────┤  │
                         │  │  application (use cases) │  │
                         │  ├─────────────────────────┤  │
                         │  │  domain (pure rules)     │  │
                         │  ├─────────────────────────┤  │
                         │  │  infrastructure (DB/ES)  │  │
                         │  └─────────────────────────┘  │
                         └──────────────┬───────────────┘
                                        │ SQL (Drizzle / raw pg)
                         ┌──────────────▼───────────────┐
                         │     PostgreSQL 16             │
                         │  accounts · transactions ·    │
                         │  entries (event log)          │
                         │  snapshots (stretch)          │
                         └──────────────────────────────┘
```

**Why PostgreSQL as the event store:** financial correctness needs real ACID transactions,
row-level locks, unique constraints, and `NUMERIC`. A relational database gives us all of
this in one system, and — critically — lets us write each transaction's events **and**
validate its invariants **in a single atomic DB transaction**. A dedicated event store
(EventStoreDB) is unnecessary for an intermediate project: the relational table *is* the
append-only log.

---

## 3. Tech stack (with reasoning)

| Layer | Choice | Why | Alternatives (and why not) |
|---|---|---|---|
| **Language** | **TypeScript** (Node.js 20 LTS, strict mode) | Type safety is essential for money and domain modeling; single language across API + UI; huge ecosystem. | Go (great concurrency, but more ceremony for an intermediate project); Python (weaker typing for money-heavy domain) |
| **Backend framework** | **NestJS** | Built-in DI, modules, validation pipes, guards, exception filters — enforces the clean layering we need without hand-rolling it. | Express (too unopinionated); Fastify (fast but you rebuild structure yourself) |
| **Database** | **PostgreSQL 16** | Best-in-class ACID, `SELECT ... FOR UPDATE`, unique constraints, `NUMERIC(19,4)`, JSONB for transaction metadata. The only sane choice for financial correctness. | MySQL (weaker locking/isolation tooling); MongoDB (no cross-document atomicity for multi-leg transfers); EventStoreDB (overkill, and we want the invariants in the same tx as the events) |
| **ORM / data access** | **Drizzle ORM + drizzle-kit** migrations | Type-safe, close to SQL, and — critically — easy to run `SELECT ... FOR UPDATE` and multi-statement transactions without ORM magic obscuring the SQL. | Prisma (interactive transactions work but abstract the SQL; less transparent for the concurrency-critical path) |
| **Validation** | **Zod** | Runtime schema validation for API DTOs and event payloads; shares types with TS. | class-validator (fine, but Zod is lighter and more composable) |
| **Testing** | **Jest + ts-jest + Supertest + real PostgreSQL** | Unit tests are fast; API integration tests run against a *real* Postgres database (local install or a CI service container) so transaction/locking behavior is actually verified. Jest+ts-jest is used rather than Vitest because NestJS DI relies on `emitDecoratorMetadata`, which esbuild-based runners cannot emit. | Testcontainers-in-Docker would work where Docker is available; the harness auto-creates its `ledger_test` database, so no external services are required |
| **Docs** | **OpenAPI 3 / Swagger** (NestJS swagger module) | Machine-readable, live-updating API contract. | — |
| **Observability** | **pino** structured logging + request IDs; optional Prometheus metrics | JSON logs, correlation IDs across the request lifecycle. | — |
| **Containers** | **Docker Compose** | One command to run Postgres (+ API + UI). | — |
| **UI** | **React + Vite + Tailwind CSS + TanStack Query + React Router** | Standard, productive stack for the observation/control dashboard. `web/` (T-23). | — |
| **CI** | **GitHub Actions** | Lint, typecheck, unit + integration tests on every push. | — |

---

## 4. Domain model (the mental model that matters)

### 4.1 Account
An operational identity with **metadata only** — never a stored balance.

- Has a `normal_side` (`debit` or `credit`), which defines how entries affect its balance.
  - *Debit-normal* (assets: checking, savings, cash): debits **increase** the balance,
    credits **decrease** it.
  - *Credit-normal* (liabilities: credit card, loan): credits **increase** the balance owed,
    debits **decrease** it.
- Has an `overdraft_limit` (default `0`): the balance may not fall below `-overdraft_limit`.
  A limit of `0` means *no overdraft allowed* (a "non-credit account").

### 4.2 Entry = Event
One leg of a transaction. This is the **append-only event** — each entry row is one
immutable event in an account's history stream.

- Fields: `account_id`, `direction` (`debit` | `credit`), `amount` (always positive),
  `currency`, and a **per-account sequence number** `seq`.
- The per-account `seq` + unique constraint `(account_id, seq)` is what defeats concurrent
  lost updates: no two events can claim the same position in an account's history.

### 4.3 Transaction = Aggregate / Grouping
A business operation that groups ≥2 entries. Not itself an event — it is the aggregate
record that ties the event legs together and carries metadata.

- Invariant: **`sum(debit) = sum(credit)`** across its entries (a transfer's two legs always
  balance to zero).
- Carries `reference` (idempotency key), `type`, `status`, `description`, `metadata`.

### 4.4 Balance (derived)
```
balance(account) = Σ(entries where direction = normal_side) − Σ(entries where direction ≠ normal_side)
```
Computed by folding an account's entries in `seq` order. Point-in-time balance = fold only
entries with `created_at <= as_of`.

### 4.5 Design decision: entries-as-events
The `entries` table **is** the event log. We deliberately did not create a separate generic
`events` table *and* an `entries` table. Rationale:

- Every event in this system *is* a double-entry leg with exactly the fields above — there is
  no payload-only event that also needs a projection row.
- Writing one row per leg keeps replay trivial and per-account sequencing natural.
- Account *lifecycle* events (T-26) live in a separate `account_events` stream
  (`account_opened`, `account_frozen`, `account_closed`, `limit_changed`) with per-account
  seqs and a `version` field. The `accounts` row is the denormalized projection of that
  stream and can be rebuilt by replaying it (`GET /accounts/:id/status-history`).
- **Documented trade-off (two streams vs. one):** keeping `entries` (money legs) and
  `account_events` (lifecycle) separate means a money movement never carries lifecycle
  payloads and a status change never touches the double-entry log — each stream has a single,
  simple projection (balance vs. account state). The cost is two streams to replay for a
  complete aggregate picture. A single unified stream would interleave both kinds of events
  but complicate per-account money sequencing and the double-entry invariant checks.

---

## 5. Concurrency model (the part that keeps money safe)

### 5.1 The lost-update problem we are solving
Two concurrent transfers both read balance = 100, both pass "sufficient funds", both commit
→ the account is double-spent. Classic read-modify-write race.

### 5.2 Our approach: row locks + per-account sequence + unique constraint

Every mutating operation (deposit, withdrawal, transfer) runs inside **one DB transaction**:

1. **Acquire locks in deterministic order.** `SELECT ... FOR UPDATE` on the affected account
   rows, sorted by `id`. Sorting guarantees a global lock order, so two transfers between the
   *same pair* cannot deadlock (they request locks in the same order).
2. **Compute the current balance** by folding the account's entries (or from the latest
   snapshot, stretch).
3. **Validate invariants**: account is `active`, amount > 0, double-entry balances
   (debits = credits), sufficient funds (`balance_after >= -overdraft_limit`).
4. **Append entries** with `seq = current_sequence + 1`, and bump `accounts.current_sequence`.
5. **Write the transaction row**, then **commit**.

Because the lock serializes writers on an account, a second concurrent transfer cannot
observe a stale balance — it blocks until the first commits, then sees the new balance and
re-checks the invariant.

### 5.3 Belt-and-suspenders
- `UNIQUE (account_id, seq)` is the final arbiter: even if application logic ever
  misbehaved, two events can never occupy the same history position.
- Optional hardening: run the whole thing at `REPEATABLE READ`/`SERIALIZABLE` isolation and
  retry on serialization failure (code `40001`). The MVP relies on row locks; this is a
  documented upgrade path.

### 5.4 Atomicity of rejection
Step 3 failing means `ROLLBACK` before any insert — so a rejected overdraft writes **nothing**.
This satisfies PRD G5 (atomic invariant rejection).

---

## 6. File & folder structure

```
p03/
├── docs/                          # project documentation
│   ├── prd.md
│   ├── architecture.md
│   └── ticket.md
│
├── .env.example                   # documented env vars (see §9)
├── .gitignore
├── docker-compose.yml             # postgres + api (+ web, stretch)
├── package.json                   # workspace root / scripts
├── tsconfig.json
├── README.md                      # quickstart
│
├── db/
│   ├── schema.ts                  # Drizzle schema (source of truth)
│   └── migrations/                # generated SQL migrations (drizzle-kit)
│
├── src/
│   ├── main.ts                    # bootstrap
│   ├── app.module.ts              # root NestJS module
│   │
│   ├── common/                    # cross-cutting HTTP concerns
│   │   ├── errors/                # AppError, error filter, error codes
│   │   ├── validation/            # Zod schema → DTO pipes
│   │   └── logging/               # pino logger, request-id middleware
│   │
│   ├── domain/                    # PURE business logic — no Nest, no DB
│   │   ├── money.ts               # Money value object (BigInt minor units)
│   │   ├── account.ts             # account aggregate + rules
│   │   ├── transaction.ts         # build/validate double-entry transactions
│   │   ├── invariants.ts          # overdraft / account-status checks
│   │   ├── events.ts              # event types + versioning
│   │   └── errors.ts              # domain error types (INSUFFICIENT_FUNDS, …)
│   │
│   ├── application/               # use cases / services (orchestrates domain + infra)
│   │   ├── accounts/              # OpenAccount, GetAccountBalance, ListAccounts, …
│   │   ├── transactions/          # Deposit, Withdraw, Transfer, VoidTransaction
│   │   ├── audit/                 # BuildAuditTrail, PointInTimeBalance
│   │   └── (snapshots/            # stretch: SnapshotService
│   │
│   ├── infrastructure/            # adapters — DB, repos, event store
│   │   ├── db/
│   │   │   ├── connection.ts      # pg / Drizzle client
│   │   │   └── repositories/      # AccountRepository, EntryRepository,
│   │   │                          # TransactionRepository, AuditRepository
│   │   └── event-store/
│   │       └── postgres-event-store.ts   # append-with-locks, replay
│   │
│   └── interfaces/                # HTTP layer
│       ├── accounts/              # accounts.controller, accounts.dto
│       ├── transactions/          # deposits/withdrawals/transfers controllers
│       ├── audit/                 # audit.controller
│       └── health/                # health.controller
│
├── test/
│   ├── unit/                      # domain tests (Jest, no DB)
│   │   ├── money.spec.ts
│   │   ├── transaction.spec.ts
│   │   └── invariants.spec.ts
│   └── integration/               # API + real Postgres (TEST_DATABASE_URL harness)
│       ├── transfer.api.spec.ts
│       ├── concurrency.spec.ts    # the "no lost updates" stress test
│       ├── point-in-time.spec.ts
│       └── audit.spec.ts
│
└── web/                           # React + Vite + Tailwind dashboard (implemented — T-23)
    ├── src/
    │   ├── api/                   # fetch client + typed endpoints
    │   ├── components/            # ui primitives, layout, form modals
    │   ├── lib/                   # amount/date formatting
    │   └── pages/                 # Accounts list + Account detail/audit timeline
    ├── package.json
    ├── vite.config.ts             # dev proxy /api/v1 → localhost:3000
    ├── tailwind.config.js
    ├── Dockerfile + nginx.conf    # static build proxying the API
    └── nginx.conf
```

**Layer rules**

- `domain/` imports **nothing** from NestJS, Drizzle, or the HTTP layer. All money math and
  invariants live here and are 100% unit-testable.
- `application/` orchestrates: calls domain rules, then persists via
  `infrastructure/` repositories inside a transaction.
- `interfaces/` only maps HTTP ⇄ application calls; contains no business logic.
- Everything that touches money goes through `domain/money.ts` (see §7.2).

---

## 7. Database schema

All money columns are `NUMERIC(19,4)` (up to 9.99 trillion, 4 decimal places — enough for
fractional currencies like BTC in the stretch goal). Enum-like columns are PostgreSQL enums.

### 7.1 `accounts`

Operational metadata for an account. **No balance column — ever.**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `account_number` | `varchar(20)` UNIQUE NOT NULL | Human-friendly display number (e.g. `0001-2345-6789`) |
| `name` | `varchar(120)` NOT NULL | Display name |
| `type` | `enum(account_type)` NOT NULL DEFAULT `checking` | `checking` · `savings` · `credit_card` · `cash` · `investment` |
| `normal_side` | `enum(balance_side)` NOT NULL DEFAULT `debit` | `debit` (asset) or `credit` (liability); defines how entries affect balance |
| `currency` | `char(3)` NOT NULL DEFAULT `USD` | ISO 4217 |
| `overdraft_limit` | `numeric(19,4)` NOT NULL DEFAULT `0` CHECK (≥ 0) | Balance may not fall below `-overdraft_limit` |
| `status` | `enum(account_status)` NOT NULL DEFAULT `active` | `active` · `frozen` · `closed` |
| `current_sequence` | `bigint` NOT NULL DEFAULT `0` | Highest applied event seq; used for optimistic/lock-based writes |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | Metadata-only; never reflects balance |

### 7.2 `transactions`

The aggregate record that groups entries. One row per business operation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `reference` | `varchar(64)` UNIQUE NULL | Idempotency key (client-supplied) |
| `type` | `enum(transaction_type)` NOT NULL | `deposit` · `withdrawal` · `transfer` · `fee` · `reversal` |
| `status` | `enum(transaction_status)` NOT NULL DEFAULT `posted` | `posted` · `void` |
| `description` | `text` NULL | Human note |
| `metadata` | `jsonb` NOT NULL DEFAULT `{}` | Free-form: counterparty ids, `fx_rate`/`from_currency`/`to_currency` on cross-currency transfers, audit notes |
| `posted_at` | `timestamptz` NOT NULL DEFAULT `now()` | Effective business timestamp; used by point-in-time queries |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

### 7.3 `entries` — **the append-only event log**

One immutable event per ledger leg. **Application code only ever `INSERT`s here.**

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` IDENTITY PK | Global append order |
| `transaction_id` | `uuid` NOT NULL FK → `transactions.id` | Grouping |
| `account_id` | `uuid` NOT NULL FK → `accounts.id` | Stream |
| `seq` | `bigint` NOT NULL | Per-account sequence number |
| `direction` | `enum(entry_direction)` NOT NULL | `debit` or `credit` |
| `amount` | `numeric(19,4)` NOT NULL CHECK (`amount > 0`) | Always positive; direction carries the sign |
| `currency` | `char(3)` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Same for all legs of one transaction |

**Constraints & indexes**

- `UNIQUE (account_id, seq)` — the concurrency guarantee (no two events share a history slot).
- `UNIQUE (transaction_id, account_id)` — an account appears at most once per transaction
  (no double-leg bug).
- `INDEX (account_id, seq)` — primary access path for replay / point-in-time reads.
- `INDEX (transaction_id)` — join path for audit trail and transaction detail.
- **Append-only enforcement:** the application DB role has `INSERT`+`SELECT` only on
  `entries`; `UPDATE`/`DELETE` are not granted. (Documented role separation; belt and braces
  with code review.) A ready-to-apply provisioning script is shipped at `db/roles.sql`
  (creates a restricted `ledger_app` role; see §13 for the ops step).

**Double-entry invariant** (enforced in application logic at write time, §5.2 step 3):

```
for every transaction:  Σ(debit amount)  =  Σ(credit amount)
```

A reconciliation job/tests re-assert this over the whole table as a final audit.

### 7.4 `snapshots` (implemented — T-21)

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` IDENTITY PK | |
| `account_id` | `uuid` NOT NULL FK → `accounts.id` | |
| `seq` | `bigint` NOT NULL | Covers all entries with `seq <=` this value |
| `balance` | `numeric(19,4)` NOT NULL | Running balance at that seq |
| `currency` | `char(3)` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

`UNIQUE (account_id, seq)`. Balance read = latest snapshot with `seq <=` target (for
point-in-time reads, with `created_at <= as_of`), then replay only the trailing events.
Snapshot frequency driven by `SNAPSHOT_INTERVAL_EVENTS` (every N events) and
`SNAPSHOT_MAX_LAG_EVENTS` (forced catch-up when lag grows too large); scheduling runs
best-effort after each committed money movement via `SnapshotService` and is never allowed
to fail the transaction.

### 7.4b `account_events` — the account lifecycle stream (T-26)

Append-only lifecycle events. **Application code only ever INSERTs here.**

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` IDENTITY PK | |
| `account_id` | `uuid` NOT NULL FK → `accounts.id` | |
| `seq` | `bigint` NOT NULL | Per-account sequence (UNIQUE with account_id) |
| `type` | `enum(account_event_type)` NOT NULL | `account_opened` · `account_frozen` · `account_reactivated` · `account_closed` · `limit_changed` |
| `payload` | `jsonb` NOT NULL DEFAULT `{}` | `{ reason?, from?, to?, overdraftLimit?, … }` |
| `version` | `integer` NOT NULL DEFAULT `1` | Payload version; old events stay replayable after schema evolution |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

`UNIQUE (account_id, seq)`. The `accounts` row is a projection rebuilt by replaying this
stream (`GET /accounts/:id/status-history`).

### 7.5 Entity relationships (plain English)

```
accounts 1 ──── N entries  ──── N ──── 1 transactions
   └─────── 1 ──── N account_events  (lifecycle stream — T-26)
   └─────── 1 ──── N entries  (per-account stream, ordered by seq)
   └─────── 1 ──── N snapshots
```

- **An account** has many **entries** (its money-history stream), many **account_events**
  (its lifecycle stream: opened/frozen/reactivated/closed, each with a per-account `seq`,
  jsonb `payload`, and integer `version`), and many **snapshots**.
- **A transaction** has exactly ≥2 **entries** (its legs), spanning ≥1 accounts. A transfer
  has exactly 2 legs across 2 accounts; a deposit has 2 legs on the same account (the
  customer's account and the bank's internal cash/equity account for that currency — each
  currency gets its own vault account, e.g. `LE-INTERNAL-CASH-EUR`).
- Deleting an account or transaction is **forbidden**; closing is done via `status`, and the
  transition is recorded in `account_events`.

---

## 8. API surface (summary)

Base path: `/api/v1` (see `API_PREFIX`). Amounts are **decimal strings** (`"12.34"`), never
numbers, to preserve precision.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `POST` | `/accounts` | Create account → `201` |
| `GET` | `/accounts?status=&type=&cursor=&limit=` | List accounts (cursor pagination) + current balances; status/type filters |
| `GET` | `/accounts/:id` | Account detail + current balance |
| `GET` | `/accounts/:id/balance?as_of=` | Current or point-in-time balance |
| `GET` | `/accounts/:id/transactions` | Paginated transaction list for an account |
| `POST` | `/accounts/:id/deposits` | Post a deposit (balanced double-entry) |
| `POST` | `/accounts/:id/withdrawals` | Post a withdrawal |
| `GET` | `/accounts/:id/audit?as_of=` | Full audit trail / balance reconstruction |
| `GET` | `/accounts/:id/transactions.csv` | CSV export of an account's transactions (streaming) |
| `GET` | `/accounts/:id/audit.csv` | CSV export of the audit trail (streaming) |
| `POST` | `/transfers` | Atomic transfer between two accounts (same-currency, or cross-currency with `fx_rate`) |
| `GET` | `/transactions/:id` | Transaction detail incl. all legs |
| `POST` | `/transactions/:id/void` | Should-have: void with compensating entry |
| `PATCH` | `/accounts/:id/status` | Should-have: freeze / close |

**Error contract (F11):**

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "…", "details": { … } } }
```

Core codes: `INVALID_AMOUNT`, `ACCOUNT_NOT_FOUND`, `ACCOUNT_FROZEN`, `ACCOUNT_CLOSED`,
`INSUFFICIENT_FUNDS`, `UNBALANCED_TRANSACTION`, `INVALID_DIRECTION`, `DUPLICATE_REFERENCE`,
`CONFLICT_SEQUENCE` (rare lock contention).

> **Amount validation note:** malformed, zero, or negative amounts are rejected by the
> Zod validation layer *before* reaching the domain, so over HTTP they surface as
> `400 VALIDATION_ERROR` with readable `details`. The `INVALID_AMOUNT` (422) code is used
> for domain-level rejection paths (internal use); clients should key on the 400
> validation error for bad amounts.

---

## 9. Environment variables & configuration

Copy `.env.example` → `.env`. Nothing secret is committed.

| Variable | Default | Required | Notes |
|---|---|---|---|
| `NODE_ENV` | `development` | — | `development` · `test` · `production` |
| `PORT` | `3000` | — | API port |
| `API_PREFIX` | `/api/v1` | — | URL prefix |
| `DATABASE_URL` | — | **Yes** | `postgres://user:pass@host:5432/ledger` |
| `CORS_ORIGINS` | `http://localhost:5173` | — | Comma-separated allowlist (stretch UI) |
| `LOG_LEVEL` | `info` | — | `pino` level |
| `TX_MAX_RETRIES` | `5` | — | Retries on serialization/lock contention (code `40001`) |
| `SNAPSHOT_INTERVAL_EVENTS` | `1000` | stretch | Take snapshot after every N events per account |
| `SNAPSHOT_MAX_LAG_EVENTS` | `5000` | stretch | Force snapshot when history replay grows past this |
| `FX_PROVIDER` | `off` | stretch | `off` · `manual` · `external`. Cross-currency transfers currently take a caller-supplied `fx_rate`; an external feed is a future extension |
| `FX_BASE_URL` / `FX_API_KEY` | — | stretch | External rate provider credentials |
| `API_KEYS` | — | T-24 | Comma-separated static keys; enables `x-api-key` auth (401 otherwise). Unset = disabled |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `100` | T-24 | Per-key throttling window/limit; `X-RateLimit-*` headers + `429 Retry-After` |

**Config rules**

- Database credentials live **only** in env vars; the app has no hardcoded connection
  strings.
- The DB user for the app should be **separate** from the migration user; the app role gets
  `INSERT`/`SELECT` on `entries` (append-only enforcement), not `UPDATE`/`DELETE`.
- `TEST_DATABASE_URL` (pointing at the Testcontainers PG) is set by the test harness, not by
  hand.

---

## 10. Event/type reference

| Enum | Values |
|---|---|
| `account_type` | `checking`, `savings`, `credit_card`, `cash`, `investment` |
| `balance_side` | `debit`, `credit` |
| `account_status` | `active`, `frozen`, `closed` |
| `transaction_type` | `deposit`, `withdrawal`, `transfer`, `fee`, `reversal` |
| `transaction_status` | `posted`, `void` |
| `entry_direction` | `debit`, `credit` |
| `account_event_type` | `account_opened`, `account_frozen`, `account_reactivated`, `account_closed`, `limit_changed` |

Events carry a `version` field (integer, defaults to 1) so future payload changes are
migration-friendly — old events remain replayable after schema evolution.

---

## 11. Failure & edge-case behavior

| Case | Behavior |
|---|---|
| Overdraft attempt | Transaction aborts, HTTP 409/422 `INSUFFICIENT_FUNDS`, nothing written |
| Concurrent transfers, same pair | Serialized by row locks; second one sees post-first balance; no lost update |
| Lock contention / serialization failure | Retry up to `TX_MAX_RETRIES` with backoff; surface `CONFLICT_SEQUENCE` if persistent |
| Duplicate client `reference` | `UNIQUE(reference)` rejects second insert; API returns the *original* transaction (idempotent) |
| Frozen/closed account | All mutating ops rejected `ACCOUNT_FROZEN`/`ACCOUNT_CLOSED`; reads still allowed |
| Zero/negative amount | Rejected `INVALID_AMOUNT` |
| Transfer to same account (A→A) | Rejected as `UNBALANCED_TRANSACTION` / invalid (no self-payment) |
| Non-existent account | 404 `ACCOUNT_NOT_FOUND`; if one of two transfer legs is invalid, entire transfer aborts |
| `as_of` in the future | Balance as of now is returned (events `<= now`) |
| Outage mid-transfer | DB transaction guarantees all-or-nothing; no torn states |

---

## 12. Testing strategy

- **Unit (Jest, no DB):** Money math, double-entry builder, overdraft/invariant rules,
  account lifecycle. Target ≥ 80% coverage of `domain/`.
- **Integration (Supertest + real PostgreSQL):**
  - happy-path transfer + balance derivation
  - rejected overdraft leaves both accounts untouched
  - **concurrency stress test**: N parallel transfers between the same pair; assert final
    balances reconcile with history and no event seq is duplicated (F7/G7 proof)
  - point-in-time queries
  - audit trail reconstruction matches a replayed balance
- The test harness (`test/integration/db.ts`) connects to `TEST_DATABASE_URL`, creates the
  database if absent, applies migrations, and truncates between suites. CI runs it against a
  PostgreSQL 16 service container.
- **Reconciliation job** (test or script): assert for every transaction `Σ(debits) =
  Σ(credits)` and that replay reproduces all stored expectations.
- **CI (GitHub Actions):** `lint → typecheck → unit → integration (real Postgres) → build`.

---

## 13. Deployment / infrastructure

- **Local dev:** `docker compose up` → Postgres + API (and `web/` when the stretch UI lands).
- **Production-ish:** single Postgres instance + the NestJS API behind a reverse proxy;
  `NODE_ENV=production`, `DATABASE_URL` pointing at the real DB, migrations applied as a
  separate deploy step (`drizzle-kit migrate`).
- **Scaling levers (in order):** snapshotting (F18) → read replicas for audit/balance reads →
  per-account sharding later. The event-sourcing design keeps all of these additive, never a
  rewrite.
