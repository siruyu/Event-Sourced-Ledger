# Feature Tickets — Event-Sourced Ledger (Double-Entry Bank Core)

| | |
|---|---|
| **Status** | Draft — v1.0 |
| **Date** | 2026-08-09 |
| **Related docs** | [`prd.md`](./prd.md), [`architecture.md`](./architecture.md) |

---

## How to read this document

Each ticket contains:

- **Feature name** — what is being built
- **Description** — what needs to be built, in plain English
- **Acceptance criteria** — the definition of "done" (checkboxes; all must pass)
- **Dependencies** — features that must be completed first (ticket IDs)
- **Priority** — one of:
  - **Must-have** — blocks launch (MVP = T-01 … T-14)
  - **Should-have** — important; launch-adjacent
  - **Nice-to-have** — stretch goals

Tickets are ordered within each priority tier as they should be **built**.

---

# MUST-HAVE (MVP — required for launch)

---

## T-01 — Project scaffolding & local infrastructure

**Priority:** Must-have
**Dependencies:** none

**Description**
Set up the repository skeleton: package.json / tsconfig / NestJS app boot, Docker Compose
with PostgreSQL 16, Drizzle + drizzle-kit wired up, `.env.example`, `/health` endpoint, and a
README quickstart. The goal is a developer who clones the repo can `docker compose up` and
hit a healthy API in minutes.

**Acceptance criteria**
- [ ] `docker compose up` starts Postgres and the API without manual steps
- [ ] `GET /api/v1/health` returns `200 { "status": "ok" }`
- [ ] TypeScript strict mode passes `tsc --noEmit`
- [ ] Drizzle client + `drizzle-kit` migrations pipeline runs against the local DB
- [ ] `.env.example` documents every variable used by the app (§9 of architecture.md)
- [ ] `npm run lint` and `npm run test` scripts exist and run green on a fresh checkout
- [ ] No secrets or hardcoded connection strings in the repo

---

## T-02 — Database schema & migrations

**Priority:** Must-have
**Dependencies:** T-01

**Description**
Implement the full schema from architecture.md §7: `accounts`, `transactions`, and `entries`
as PostgreSQL enums + tables. The `entries` table is the append-only event log with
`UNIQUE (account_id, seq)` and `UNIQUE (transaction_id, account_id)`. `accounts` must have
**no balance column**. Include an `updated_at` trigger helper and correct indexes.

**Acceptance criteria**
- [ ] Migrations create `accounts`, `transactions`, `entries` with all columns/types from §7
- [ ] `entries.amount` is `numeric(19,4)` with `CHECK (amount > 0)`
- [ ] `UNIQUE (account_id, seq)` and `UNIQUE (transaction_id, account_id)` constraints exist
- [ ] Indexes on `(account_id, seq)` and `(transaction_id)` exist
- [ ] `accounts` has no balance column
- [ ] Enums `account_type`, `balance_side`, `account_status`, `transaction_type`, `transaction_status`, `entry_direction` exist
- [ ] Migrations are idempotent-safe and runnable from scratch (fresh DB)
- [ ] DB role separation documented: app role has no `UPDATE`/`DELETE` on `entries`

---

## T-03 — Event store core (append-only + sequencing + replay)

**Priority:** Must-have
**Dependencies:** T-02

**Description**
Build the infrastructure for the event log: a repository/event-store that appends entries
inside a DB transaction with correct per-account sequence numbers, enforces append-only
(no update/delete path), and can replay an account's history in `seq` order. This is the
foundation every feature below writes through.

**Acceptance criteria**
- [ ] `appendEntries(transactionId, entries)` writes entries with `seq = current_sequence + 1`
- [ ] `accounts.current_sequence` is advanced in the same transaction as the inserts
- [ ] Replay returns an account's entries ordered by `seq` with no gaps or duplicates
- [ ] Duplicate `(account_id, seq)` attempts fail at the DB constraint level (verified by test)
- [ ] No public API path can `UPDATE` or `DELETE` an entry
- [ ] Appending the two legs of one transaction is atomic (both or neither visible)

---

## T-04 — Domain layer: Money & double-entry invariants

**Priority:** Must-have
**Dependencies:** T-01 (pure domain, no DB)

**Description**
Write the pure, database-free domain rules in `src/domain/`: a `Money` value object that
never touches IEEE-754 floats, and a double-entry transaction builder that guarantees every
transaction's debits sum to credits. Include domain error types (matching the error contract
codes). This is the most test-critical code in the project.

**Acceptance criteria**
- [ ] `Money` parses decimal strings, stores integer minor units, and does add/sub/compare without float drift
- [ ] Zero or negative amounts are rejected with `INVALID_AMOUNT`
- [ ] Transaction builder rejects transactions whose `Σ debits ≠ Σ credits` (`UNBALANCED_TRANSACTION`)
- [ ] Transaction builder rejects transactions with fewer than 2 entries
- [ ] Builder rejects a transfer to the same account (A→A)
- [ ] `INSUFFICIENT_FUNDS`, `ACCOUNT_FROZEN`, `ACCOUNT_CLOSED` domain errors exist and carry stable codes
- [ ] 100% of this file's branch logic is unit-tested

---

## T-05 — Account API (create, list, get)

**Priority:** Must-have
**Dependencies:** T-02, T-03

**Description**
Expose `POST /accounts`, `GET /accounts`, `GET /accounts/:id`. Creating an account writes
the account row (metadata only) and issues a human-friendly unique `account_number`. List/detail
responses include the account's **current derived balance** (computed via T-03 replay; a
helper that will be reused everywhere).

**Acceptance criteria**
- [ ] `POST /accounts` validates name/type/currency/overdraft_limit and returns `201` with `id` + `account_number`
- [ ] `account_number` is unique and human-friendly
- [ ] `GET /accounts` returns accounts with their derived balances
- [ ] `GET /accounts/:id` returns detail + derived balance; unknown id → `404 ACCOUNT_NOT_FOUND`
- [ ] Invalid input → `400` with structured error body (F11 shape)
- [ ] A freshly created account reports balance `0.00`

---

## T-06 — Deposit & withdrawal (single-account transactions)

**Priority:** Must-have
**Dependencies:** T-03, T-04, T-05

**Description**
Implement `POST /accounts/:id/deposits` and `POST /accounts/:id/withdrawals`. Each posts a
**balanced double-entry** transaction (the customer's account leg + the bank's internal
asset leg) as append-only events, in one DB transaction. Withdrawal must fail atomically if
the account cannot cover it (T-08 rules). Amounts are decimal strings.

**Acceptance criteria**
- [ ] Deposit increases the account's derived balance by the amount
- [ ] Withdrawal decreases it; overdraft on a non-credit account → `409/422 INSUFFICIENT_FUNDS`, no entries written
- [ ] Each operation produces ≥2 entries whose debits = credits (verified via the transaction endpoint)
- [ ] Zero/negative/`"0.00000"` amounts rejected with `INVALID_AMOUNT`
- [ ] Unknown account → `404`; frozen/closed account → `ACCOUNT_FROZEN`/`ACCOUNT_CLOSED`
- [ ] Balance after N operations equals replay of the event stream (reconciliation check in tests)

---

## T-07 — Transfers (atomic double-entry)

**Priority:** Must-have
**Dependencies:** T-03, T-04, T-05, T-06

**Description**
Implement `POST /transfers { from_account_id, to_account_id, amount, description? }`. This is
the heart of the project: one atomic transaction with a debit leg on `from` and a credit leg
on `to`, using the **row-lock + unique-seq** concurrency algorithm from architecture.md §5 —
locks acquired in sorted id order (no deadlock), invariants validated under lock, both
entries committed together or not at all.

**Acceptance criteria**
- [ ] Successful transfer: `from` decreases, `to` increases by the same amount, in one transaction
- [ ] Transfer produces exactly 2 entries, `Σ debits = Σ credits`
- [ ] Insufficient funds on `from` → `INSUFFICIENT_FUNDS`, and **neither** account changes (no partial transfer)
- [ ] Either account frozen/closed/not-found → whole transfer aborts
- [ ] Transfer to the same account → rejected
- [ ] **Concurrent transfers between the same pair never lose updates** (see T-12 stress test)
- [ ] A transfer's balance effect is identical whether queried via balance endpoint or full replay

---

## T-08 — Invariant enforcement (atomic rejection)

**Priority:** Must-have
**Dependencies:** T-03, T-04, T-06

**Description**
Centralize the invariant checks evaluated under lock before any event is written:
sufficient funds (`balance_after >= -overdraft_limit`), account status `active`, positive
amount, balanced double-entry. Guarantee rejection is **atomic** — a failed check rolls back
the entire transaction with a stable error code. This ticket makes the "no partial
transfers" guarantee explicit and testable.

**Acceptance criteria**
- [ ] Overdraft beyond `overdraft_limit` rejected for debit-normal accounts with `INSUFFICIENT_FUNDS`
- [ ] Accounts with `overdraft_limit > 0` may carry a balance down to `-overdraft_limit` but no lower
- [ ] Credit-normal (liability) accounts apply the symmetric balance-direction rule correctly
- [ ] Frozen / closed accounts reject all mutating operations, but reads still work
- [ ] Rejection paths leave the event log byte-for-byte unchanged (asserted in tests)
- [ ] Every rejection returns the F11 structured error body with a stable code

---

## T-09 — Derived balance + point-in-time queries

**Priority:** Must-have
**Dependencies:** T-03, T-05

**Description**
Expose `GET /accounts/:id/balance` (current, derived by replay) and the point-in-time variant
`GET /accounts/:id/balance?as_of=<ISO timestamp>` (replay of events with
`posted_at <= as_of`). Add a `BalanceProjector`/query helper in the application layer so
every read path uses the same derivation logic.

**Acceptance criteria**
- [ ] Current balance equals full replay of the account's events (never a stored column)
- [ ] `?as_of` returns the balance exactly as of that time, excluding later events
- [ ] An `as_of` between two events yields the state after the earlier one only
- [ ] A transfer's two legs share a timestamp, so `as_of` can never show a half-transfer
- [ ] Future `as_of` returns the current balance
- [ ] Malformed `as_of` → `400` with validation error

---

## T-10 — Audit trail endpoint

**Priority:** Must-have
**Dependencies:** T-03, T-04, T-05, T-09

**Description**
Implement `GET /accounts/:id/audit` (optional `?as_of=`). It reconstructs the account's full
history: each event with direction, amount, running balance, the transaction it belongs to,
the **counterparty** (the other leg(s) of the same transaction), and a plain-English
explanation (e.g. *"Deposit +500.00 — balance 500.00"*, *"Transfer −250.00 to
Savings-0002 — balance 250.00"*). The final running balance must equal the current balance.

**Acceptance criteria**
- [ ] Audit returns events ordered by `seq`, oldest → newest
- [ ] Each row shows direction, amount, running balance, transaction type, and counterparty account
- [ ] Final running balance equals `GET /balance` for the same `as_of`
- [ ] Replaying the audit rows independently reproduces the same running balances (reconciliation in test)
- [ ] Audit of an account with zero events returns an empty, well-formed list
- [ ] `?as_of` trims the trail to that point in time

---

## T-11 — Error contract & API consistency

**Priority:** Must-have
**Dependencies:** T-04, T-05

**Description**
Standardize HTTP errors across all endpoints: a global exception filter that maps domain
errors to the F11 shape `{ error: { code, message, details } }`, Zod-based DTO validation
for every body/query param, and a documented, stable set of error codes. This is what makes
the API usable by clients before anything else.

**Acceptance criteria**
- [ ] Every endpoint returns errors in the exact F11 JSON shape
- [ ] Error codes are stable and documented (list in README or OpenAPI)
- [ ] Validation failures return `400`; domain failures return `404/409/422` as defined in architecture.md §8
- [ ] Zod schemas validate every request body/query and produce readable `details`
- [ ] `INSUFFICIENT_FUNDS`, `ACCOUNT_NOT_FOUND`, `ACCOUNT_FROZEN`, `INVALID_AMOUNT`, `UNBALANCED_TRANSACTION` all covered by tests
- [ ] No uncaught internal errors escape as raw 500 stacks — logged, wrapped as `500 INTERNAL`

---

## T-12 — Concurrency & invariant integration tests

**Priority:** Must-have
**Dependencies:** T-07, T-08

**Description**
Write the tests that *prove* requirements G5 and G7: atomic rejection and no lost updates
under concurrency. The centerpiece is a stress test firing many parallel transfers between
the same two accounts (and into the same account) against a real Postgres
(Testcontainers), then asserting the final balances reconcile exactly with the event log.

**Acceptance criteria**
- [ ] Stress test: 2 accounts, N (≥ 20) concurrent transfers between them → final balances reconcile with history; no `(account_id, seq)` duplicates
- [ ] Concurrent withdrawals can never drive a non-credit account below zero
- [ ] Concurrent identical transfers cannot double-spend the same funds
- [ ] Test asserts zero partial-state observations (a failed transfer leaves both accounts untouched)
- [ ] Same suite covers overdraft, frozen-account, and double-entry rejections
- [ ] Tests run against a real Postgres database via the test harness (`TEST_DATABASE_URL`), auto-created, applied migrations, in CI (not mocked)

---

## T-13 — Observable logging & request tracing

**Priority:** Must-have
**Dependencies:** T-01

**Description**
Wire structured JSON logging (pino) with a request/correlation id propagated through every
log line, per-endpoint latency, and a consistent transaction log when money moves (tx id,
type, amount, accounts). Audit-critical events must be identifiable in logs.

**Acceptance criteria**
- [ ] Every HTTP request logs a unique `requestId` echoed in responses (header) and all logs
- [ ] Money movements log the transaction id, type, amount, and both account ids
- [ ] Logs are structured JSON at `info`+ in production, with `debug` switchable
- [ ] Errors log with stack + correlation id; no secrets/amounts accidentally redacted incorrectly
- [ ] `LOG_LEVEL` env var controls verbosity

---

## T-14 — CI pipeline (lint → typecheck → tests → build)

**Priority:** Must-have
**Dependencies:** T-12

**Description**
Set up GitHub Actions that run lint, `tsc --noEmit`, unit tests, integration tests (with a
Postgres service/container), and a production build on every push/PR. This locks in the
financial-correctness guarantees so regressions are caught automatically.

**Acceptance criteria**
- [ ] CI runs: lint → typecheck → unit → integration (real Postgres) → build
- [ ] Integration tests use Testcontainers or a CI Postgres service, never an in-memory fake
- [ ] A failing test or type error blocks the pipeline
- [ ] Pipeline completes in a reasonable time (< ~10 min) and is reliable (no flaky sleeps)

---

# SHOULD-HAVE (strongly recommended for launch)

---

## T-15 — Idempotency via client references

**Priority:** Should-have
**Dependencies:** T-07

**Description**
Accept an optional client `reference` on deposits, withdrawals, and transfers. Enforce
`UNIQUE (reference)`; on duplicate, return the original transaction (HTTP 200/201) instead of
creating a second one. This makes network retries safe.

**Acceptance criteria**
- [ ] First request with `reference` creates the transaction; response includes the reference
- [ ] Retrying the same `reference` returns the original transaction — no duplicate money movement
- [ ] Concurrent duplicate references: exactly one transaction is created, the other resolves to it (no `DUPLICATE_REFERENCE` race leaks)
- [ ] Different accounts/amounts with the same reference are treated as a duplicate (reference is global)
- [ ] Missing `reference` still works (transaction created as before)

---

## T-16 — Reversal / void transactions

**Priority:** Should-have
**Dependencies:** T-07, T-15

**Description**
Implement `POST /transactions/:id/void` (and a `GET /transactions?reference=` lookup).
Voiding posts a **compensating** transaction (offsetting entries) rather than deleting
events — the log stays append-only, and the net effect is zero while full history remains.

**Acceptance criteria**
- [ ] Voiding a posted transaction creates a new `reversal` transaction with offsetting entries
- [ ] Original transaction marked `void`; its events are never deleted
- [ ] Post-void balances equal the pre-original balances (net zero effect)
- [ ] Voiding a transaction twice, or a void/unknown transaction, → clear error
- [ ] Audit trail shows the original and its reversal with a plain-English link

---

## T-17 — Account lifecycle: freeze & close

**Priority:** Should-have
**Dependencies:** T-05, T-08

**Description**
Add `PATCH /accounts/:id/status` supporting `frozen` (blocks all mutating ops) and `closed`
(permanent; blocks everything except reads). Enforce status rules in the invariant layer so
T-08 keeps rejecting appropriately.

**Acceptance criteria**
- [ ] Freezing an account blocks deposits/withdrawals/transfers (both as sender and receiver)
- [ ] Closed accounts reject all writes permanently; reads still return detail/history
- [ ] Closing an account with a non-zero balance is rejected (must be zeroed first) — documented behavior
- [ ] Status transitions are recorded (metadata note on the account) and visible in the audit context
- [ ] Re-opening a closed account is not possible

---

## T-18 — Pagination & filtering on list endpoints

**Priority:** Should-have
**Dependencies:** T-05, T-09

**Description**
Add cursor-based pagination to `GET /accounts`, `GET /accounts/:id/transactions`, and
`GET /accounts/:id/audit`, plus filtering (by status/type) and a stable `nextCursor`.

**Acceptance criteria**
- [ ] List endpoints return `{ items, nextCursor }`; cursor is opaque and stable
- [ ] Pagination is consistent under concurrent appends (no skipped/duplicated rows)
- [ ] Filters for account status and transaction type work and combine with pagination
- [ ] Default page size documented and configurable

---

## T-19 — OpenAPI documentation / Swagger UI

**Priority:** Should-have
**Dependencies:** T-11

**Description**
Expose OpenAPI 3 (NestJS swagger) describing every endpoint, schema, error code, and the
amounts-as-strings convention, served at `/docs`.

**Acceptance criteria**
- [ ] `/docs` (Swagger UI) and `/docs-json` are served
- [ ] Every endpoint documented with request/response schemas and error responses
- [ ] Error codes table included; amounts documented as decimal strings
- [ ] Contract stays in sync with code (schemas generated from Zod/DTOs, not hand-edited drift)

---

## T-20 — Financial reconciliation job

**Priority:** Should-have
**Dependencies:** T-09, T-10

**Description**
Ship a script/endpoint that audits the whole ledger: for every transaction assert
`Σ debits = Σ credits`, and for every account assert the derived balance reconciles with its
event stream. Runs on demand (and in CI). This is the "prove we're always right" tool.

**Acceptance criteria**
- [ ] Job reports every unbalanced transaction, if any (expect zero)
- [ ] Job reports any account whose replayed balance differs from expected (expect zero)
- [ ] Returns a machine-readable report (JSON) with counts and any findings
- [ ] Runnability in CI after integration tests

---

# NICE-TO-HAVE (stretch goals)

---

## T-21 — Snapshotting

**Priority:** Nice-to-have
**Dependencies:** T-09, T-03

**Description**
Add the `snapshots` table and a `SnapshotService` (architecture.md §7.4). Balance reads load
the latest snapshot then replay only trailing events, so recomputation stops replaying the
entire history. Policies via `SNAPSHOT_INTERVAL_EVENTS` / `SNAPSHOT_MAX_LAG_EVENTS`.

**Acceptance criteria**
- [x] Snapshot taken per account after N events (or forced when lag exceeds threshold)
- [x] Balance reads use snapshot + trailing events; result identical to full replay
- [x] Point-in-time reads use the newest snapshot with `seq`/time ≤ target, then replay the remainder
- [x] Snapshot writes are idempotent and safe under concurrency (`UNIQUE (account_id, seq)`)
- [x] A regression test asserts snapshot-backed reads equal full-replay reads on a history with thousands of events

---

## T-22 — Multi-currency ledger with FX

**Priority:** Nice-to-have
**Dependencies:** T-07, T-21 (long-term)

**Description**
Support accounts in different currencies and exchange-rate-aware transfers. Entries already
carry `currency`; add a conversion leg or store `fx_rate` in transaction metadata, validate
conversions in a common/ledger currency so the double-entry invariant still holds
globally, and add FX sources (manual or external provider).

**Acceptance criteria**
- [x] Accounts can be created in multiple ISO currencies
- [x] Same-currency transfers unchanged; cross-currency transfers record `fx_rate` and convert exactly
- [x] Double-entry invariant holds across currencies (validated in a common currency)
- [x] Rounding is deterministic (documented half-up rule), no silent dust
- [x] FX rate is captured at transfer time and visible in audit trail

> **Implementation notes:** cross-currency transfers pass a client-supplied `fx_rate`
> (units of destination currency per one source unit); the destination leg is converted
> with deterministic half-up rounding to 4 dp (`Money.convertAt`). Each currency gets its
> own internal cash vault account so deposits/withdrawals stay single-currency balanced.
> The reconciliation job validates cross-currency transactions by conversion instead of
> raw debit/credit sums. External FX feeds (`FX_PROVIDER`) remain a documented future
> extension — rates are supplied by the caller today.

---

## T-23 — Web UI

**Priority:** Nice-to-have
**Dependencies:** T-05, T-07, T-10, T-18 (for a usable surface)

**Description**
Build the React + Vite + Tailwind dashboard (stretch goal from the project brief): observe
accounts with live derived balances, create accounts, post deposits and transfers, and view
each account's audit trail as a visual event timeline.

**Acceptance criteria**
- [x] Dashboard lists accounts with current balances; selecting one shows details + history
- [x] Create account, deposit, and transfer forms work against the API (incl. error surfacing)
- [x] Audit trail rendered as a timeline with counterparty and running balance
- [x] Point-in-time balance picker on the audit screen
- [x] Responsive; uses the API's amount-as-string convention

> **Implementation notes:** `web/` is a React 18 + Vite + Tailwind (v3) app using
> TanStack Query, React Router, and `lucide-react` icons. It runs against the API via a dev
> proxy (`/api/v1` → `localhost:3000`) and ships a containerized build (nginx) in
> docker-compose. Designed per `ui-ux-pro-max` guidance: semantic tokens, tabular figures
> for money, visible focus states, ≥44px touch targets, per-field form errors, and
> loading/empty/error states.

---

## T-24 — API auth & rate limiting

**Priority:** Nice-to-have
**Dependencies:** T-11

**Description**
Add API-key auth (static keys from `API_KEYS`) and per-key rate limiting before any public
exposure. Kept off by default for local dev.

**Acceptance criteria**
- [x] Requests without a valid key → `401` when auth enabled
- [x] Rate limits enforced per key and window; limits documented via headers
- [x] Auth/rate limiting disabled when `API_KEYS` is unset (dev mode)
- [x] No key material logged or stored in the DB

> **Implementation notes:** global `ApiKeyGuard` (static keys via `x-api-key`,
> constant-time comparison) + `ApiKeyThrottlerGuard` (`@nestjs/throttler`, keyed by API key,
> `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`, `X-RateLimit-*` headers and `429 Retry-After`).
> Both are no-ops when `API_KEYS` is unset. The health probe is `@Public()` + `@SkipThrottle()`
> so orchestrators can poll without keys. Request logs redact `x-api-key`/`Authorization`.

---

## T-25 — CSV export

**Priority:** Nice-to-have
**Dependencies:** T-10

**Description**
Add `GET /accounts/:id/transactions.csv` (and audit export) returning a well-formed CSV of
the account's history.

**Acceptance criteria**
- [x] CSV columns: date, transaction id, type, direction, amount, counterparty, running balance, reference
- [x] Amounts are decimal strings (no scientific notation)
- [x] Streaming-friendly for large histories; headers correct; Excel-compatible

> **Implementation notes:** `GET /accounts/:id/transactions.csv` and
> `GET /accounts/:id/audit.csv` stream rows in bounded pages (500/page) directly to the
> response with a running balance folded from a snapshot base — large histories never load
> fully into memory. UTF-8 BOM + CRLF line endings for Excel; RFC-4180-style escaping;
> `as_of` trims the window. Optional `reference`/description carry commas safely.

---

## T-26 — Full account-aggregate event sourcing

**Priority:** Nice-to-have
**Dependencies:** T-03

**Description**
Extend event sourcing from *money movements only* to the account aggregate itself: append
events for `account_opened`, `account_frozen`, `account_closed`, `limit_changed`, and derive
the `accounts` table (and status history) as a projection. This is the "purest" event-sourced
extension and rounds out the learning goals.

**Acceptance criteria**
- [x] Account lifecycle actions append events; the `accounts` row is rebuilt by replay
- [x] Status history queryable (when was it frozen, and why)
- [x] Old events remain replayable (version field honored)
- [x] Documented trade-off: two streams (`account_events` + `entries`) vs. a single stream

> **Implementation notes:** new `account_events` append-only table (per-account seq,
> `UNIQUE(account_id, seq)`, jsonb payload, integer `version`). Account creation appends
> `account_opened`; freeze/reactivate/close append the matching event inside the same
> transaction that updates the `accounts` row (the row is the denormalized projection).
> `GET /accounts/:id/status-history` rebuilds the history by replaying the stream, and
> `AccountEventService.projectAccount` proves the stored row is reproducible from events.
> `limit_changed` is a reserved event type for the (future) limit-change endpoint.

---

# Sequencing & dependency graph

```
T-01 Scaffolding
  └─► T-02 Schema ──► T-03 Event store ──► T-05 Account API ──► T-09 Derived/PIT balance
                      │  └─► T-04 Domain rules ──► T-06 Deposit/Withdraw ──► T-07 Transfers ──► T-08 Invariants
                      │                                              │         │             │
                      │                                              └───► T-12 Concurrency tests ──► T-14 CI
                      └─► T-11 Error contract ──► T-13 Logging ──► T-10 Audit

Should-have:  T-15 (needs T-07) → T-16 (needs T-15) → T-17 (needs T-08) → T-18 → T-19 → T-20
Nice-to-have: T-21 → T-22 (long-term) · T-23 (needs core) · T-24 · T-25 · T-26
```

**Suggested build order (MVP):**
1. T-01 → T-02 → T-03 → T-04 (foundation)
2. T-05 → T-06 → T-07 (money moves)
3. T-08 → T-09 → T-10 (invariants + reads + audit)
4. T-11 → T-13 (contract + ops)
5. T-12 → T-14 (proof + CI) — T-12 can start in parallel once T-07 lands

**Definition of done for the whole project (MVP):** T-01 … T-14 all green; the T-12
concurrency stress test passes against a real Postgres; every balance on the ledger can be
explained by its audit trail; zero events are ever mutated.
