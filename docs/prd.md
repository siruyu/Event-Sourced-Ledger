# PRD — Event-Sourced Ledger (Double-Entry Bank Core)

| | |
|---|---|
| **Project** | Event-Sourced Ledger (Double-Entry Bank Core) |
| **Status** | Draft — v1.0 |
| **Date** | 2026-08-09 |
| **Doc type** | Product Requirements Document |
| **Related docs** | [`architecture.md`](./architecture.md), [`ticket.md`](./ticket.md) |

---

## 1. What this product is

The Event-Sourced Ledger is a banking-core-style backend that models money the way real
banks do: as an **immutable stream of events**, never as a mutable balance.

Every movement of money (deposit, withdrawal, transfer, fee, reversal) is recorded as an
**append-only event**. Account balances are **always derived** by replaying that history —
they are never stored in a `balance` column and never `UPDATE`d in place.

The product enforces **true double-entry bookkeeping**: every transaction carries matching
debit and credit entries that sum to zero. It guarantees that no operation can corrupt the
ledger, that invariant-violating transactions (like an overdraft on a non-credit account)
are rejected **atomically** with zero partial writes, and that concurrent transfers between
the same two accounts can never lose updates or corrupt balances.

The core deliverable is a **REST API** plus a **PostgreSQL schema** (the ledger core). A
**web UI** to control and observe everything is a stretch goal.

---

## 2. Problem statement

Amateur financial systems store a `balance` column on an `accounts` table and run
`UPDATE accounts SET balance = balance - $x` on every transaction. This model is how bugs
happen. Specifically, it fails at:

1. **History.** The current balance is a single overwritten number. Reconstructing *how* an
   account reached that balance requires separate — usually incomplete — audit logs.
2. **Point-in-time queries.** "What was this balance last Tuesday?" is impossible, because
   the previous value was overwritten.
3. **Concurrency.** Two concurrent withdrawals read the same balance, both pass the
   "sufficient funds" check, and both commit → **lost update**, account goes negative. This
   is the classic read-modify-write race.
4. **Accounting integrity.** Nothing forces debits to equal credits. A transfer that moves
   money out of one account but never into another can silently "succeed."

Financial institutions, audit systems, and anything where *"how did we get here"* matters
cannot tolerate any of these. Event sourcing + double-entry + atomic invariant enforcement
are the industry answers, and building them is the entire point of this project.

---

## 3. Goals

- **G1.** Every balance change is recorded as an immutable, append-only event. Balances are
  never `UPDATE`d directly.
- **G2.** Enforce true double-entry bookkeeping: every transaction has matching debit and
  credit entries that sum to zero.
- **G3.** Current account balance is always a **derived** value, computed (replayed) from the
  account's event history.
- **G4.** Support point-in-time queries: *"what was this account's balance as of last
  Tuesday?"*
- **G5.** Reject any transaction that would violate invariants (e.g., overdraft on a
  non-credit account) **atomically** — no partial transfers, ever.
- **G6.** Provide a full **audit trail** endpoint that reconstructs and explains how an
  account reached its current balance.
- **G7.** Handle concurrent transfers between the same two accounts without corrupting
  balances (no lost updates).

---

## 4. Non-goals (explicitly out of scope for the MVP)

- Payment rails / network / card processing integration
- Customer-facing mobile or consumer banking app
- Regulatory features (KYC, AML, BSA reporting)
- Multi-currency ledgers and exchange-rate-aware transfers (stretch goal)
- Distributed / sharded ledger (single PostgreSQL instance)
- Ultra-high throughput (billions of events) — snapshotting is a stretch goal that extends
  practical scale, but this is not a performance project

---

## 5. Who it is for

| Persona | Description | Primary value |
|---|---|---|
| **Ledger engineer** (primary) | Developer or student building / integrating a fintech backend through the REST API | Correct-by-construction money model; clean domain logic; concurrency handled for them |
| **Ops / QA reviewer** (secondary) | Operations staff, testers, or auditors who inspect accounts, balances, and history | Read-only observation of balances, transactions, and full audit trails (esp. via the stretch UI) |
| **Architecture learner** | Anyone learning event sourcing, DDD, and financial correctness | A reference implementation of the patterns |

The product is **not** aimed at end consumers.

---

## 6. Core concepts (plain English)

These terms are used throughout the requirements and tickets.

| Term | Meaning |
|---|---|
| **Event** | An immutable record of a single change — one leg (debit or credit) of a transaction, appended to an account's history stream. Events are never edited or deleted. |
| **Ledger / event log** | The append-only, ordered collection of all events. The single source of truth for every balance. |
| **Transaction** | A business operation that groups ≥2 events (entries). Examples: deposit, withdrawal, transfer, fee, reversal. |
| **Double-entry** | The rule that every transaction's **total debits equal total credits**. A transfer posts one debit leg and one credit leg that cancel out. |
| **Derived balance** | A value computed by replaying an account's events, never stored on the account. |
| **Invariant** | A rule the ledger may never violate (e.g., a non-credit account may not go below `-overdraft_limit`). Violations cause the whole transaction to be rejected atomically. |
| **Snapshot** (stretch) | A stored running balance at a given point in history, used to avoid replaying the full event log. |

---

## 7. Features and priorities

Legend: **Must** = required for launch · **Should** = strongly recommended shortly after /
during launch · **Nice** = stretch / nice-to-have.

| ID | Feature | Description | Priority |
|---|---|---|---|
| F1 | **Append-only event log** | Every balance change is an immutable, append-only event. No `UPDATE` of balances, no `DELETE` of events. | Must |
| F2 | **Double-entry enforcement** | Every transaction has matching debit + credit entries summing to zero; unbalanced transactions are rejected. | Must |
| F3 | **Derived balances** | Account balance is computed (replayed) from event history, never stored. | Must |
| F4 | **Point-in-time balance** | Query an account's balance as of an arbitrary timestamp. | Must |
| F5 | **Atomic invariant rejection** | Overdraft on a non-credit account (and similar violations) reject the whole transaction atomically — no partial state. | Must |
| F6 | **Audit trail** | Endpoint that reconstructs and explains how an account reached its current balance. | Must |
| F7 | **Concurrency safety** | Concurrent transfers between the same accounts never lose updates or corrupt balances. | Must |
| F8 | **Account management** | Create / list / view accounts (with account type, currency, overdraft limit, status). | Must |
| F9 | **Deposit / withdrawal** | Single-account balance movements as balanced double-entry transactions. | Must |
| F10 | **Transfer** | Move money between two accounts as one atomic double-entry transaction. | Must |
| F11 | **Error contract** | Consistent, structured API errors with stable error codes (e.g. `INSUFFICIENT_FUNDS`). | Must |
| F12 | **Idempotency** | Client-supplied reference keys prevent duplicate transactions on retry. | Should |
| F13 | **Reversal / void** | Void a posted transaction with a compensating (offsetting) entry. | Should |
| F14 | **Freeze / close accounts** | Account lifecycle: freeze (block new transactions) and close. | Should |
| F15 | **Pagination & filtering** | Cursor pagination and filters on list endpoints. | Should |
| F16 | **OpenAPI docs** | Machine-readable API documentation / Swagger UI. | Should |
| F17 | **Observability** | Structured logging, request IDs, basic metrics, health endpoint. | Should |
| F18 | **Snapshotting** | Periodic snapshots so balance recomputation doesn't replay full history. | Nice |
| F19 | **Multi-currency + FX** | Accounts in different currencies; exchange-rate-aware transfers. | Nice |
| F20 | **Web UI** | Dashboard to create accounts, run transfers, and inspect audit trails. | Nice |
| F21 | **Auth + rate limiting** | API key auth and rate limiting before exposing publicly. | Nice |
| F22 | **CSV export** | Export transaction history / audit trail to CSV. | Nice |

---

## 8. User flows (start to finish)

### Flow 1 — First money movement (happy path)
1. Developer boots the service (`docker compose up`), DB migrations apply automatically.
2. `POST /api/v1/accounts` `{ "name": "Alicia Checking", "type": "checking", "currency": "USD" }`
   → `201` with an `id` and human-friendly `account_number`.
3. `POST /api/v1/accounts/{id}/deposits` `{ "amount": "1000.00", "reference": "payroll-1" }`
   → `201`; a balanced deposit transaction is posted as an event.
4. `GET /api/v1/accounts/{id}/balance` → `{ "balance": "1000.00" }` — derived by replay, not
   read from a column.

### Flow 2 — Transfer between two accounts
1. Create a second account (Flow 1, step 2).
2. `POST /api/v1/transfers` `{ "from_account_id": "A", "to_account_id": "B", "amount": "250.00", "reference": "rent-jan" }`
   → `201`; one atomic transaction with a debit leg on A and a credit leg on B, summing to zero.
3. `GET /api/v1/accounts/{A}/balance` and `{B}` → `750.00` and `250.00` respectively.
4. **If the same request is re-sent** (network retry), the `reference` is recognized and the
   original transaction is returned — no double-charge.

### Flow 3 — Rejected overdraft (atomicity)
1. Account A has `0.00`.
2. `POST /api/v1/transfers` `{ from: A, to: B, amount: "100.00" }` → `409/422` with code
   `INSUFFICIENT_FUNDS` (account A is a non-credit account, `overdraft_limit = 0`).
3. `GET /api/v1/accounts/{A}/balance` and `{B}` → both unchanged. **No partial transfer** —
   nothing was written.

### Flow 4 — Historical audit ("as of" + explain)
1. Account has received deposits and made transfers over several days.
2. `GET /api/v1/accounts/{id}/balance?as_of=2026-08-02T23:59:59Z` → balance exactly as it
   stood that Tuesday, ignoring all later events.
3. `GET /api/v1/accounts/{id}/audit` → the ordered event history with each entry's
   counterparty, direction, amount, running balance, and a plain-English explanation of how
   the current balance was reached.

### Flow 5 — Concurrent transfers (no lost updates)
1. Account A has `1000.00`. Two clients fire `transfer(A → B, 600)` and `transfer(A → C, 600)`
   at the same moment.
2. Both serialize correctly: one succeeds, the other fails with `INSUFFICIENT_FUNDS` (or both
   succeed if the balance covers both — never do both succeed against the same insufficient
   funds).
3. Final balances are exactly consistent with history; the event log contains no duplicates
   or gaps.

### Flow 6 (stretch) — Web UI
1. Operator opens the dashboard, sees all accounts with live derived balances.
2. Creates accounts, posts deposits, runs transfers from a form.
3. Clicks into any account to see its audit timeline rendered as a visual event stream.

---

## 9. Non-functional requirements

| Category | Requirement |
|---|---|
| **Financial correctness** | Money is never represented as IEEE-754 floats. Amounts travel as decimal strings over the API and are stored as `NUMERIC(19,4)`. |
| **Atomicity** | A transaction's entries are committed in a single DB transaction or not at all. Invariant violations abort the entire operation. |
| **Immutability** | Events are append-only. Application code performs no `UPDATE`/`DELETE` on the event/entry stream. |
| **Concurrency** | Correct under concurrent transfers between the same account pair (row-level locking with deterministic lock order + unique per-account sequence numbers). |
| **Idempotency** | Client `reference` keys are unique; retries return the original result. |
| **Observability** | Structured JSON logs, correlation/request IDs, `/health` endpoint. |
| **Recoverability** | Full ledger can be replayed from the event log to rebuild any state. |
| **Performance (MVP)** | Balance reads by replay are acceptable at MVP scale; snapshotting (F18) is the scaling lever. P95 API latency for a transfer < 100 ms on local Postgres. |
| **Security** | No secrets in code; DB credentials via env vars; parameterized SQL everywhere. |

---

## 10. MVP scope (definition of launch)

The MVP = every **Must** feature (F1–F11). Concretely, launch delivers:

- PostgreSQL schema with `accounts`, `transactions`, `entries` (append-only event stream),
  and migrations.
- REST API: account create/list/get, deposit, withdrawal, transfer, balance (current +
  point-in-time), audit trail, structured errors.
- Atomic invariant enforcement (overdraft rejection), double-entry validation, and
  concurrency-safe transfers (no lost updates).
- Automated test suite proving the core invariants (including a concurrent-transfer stress
  test) and a CI pipeline.

Not in MVP: idempotency UX polish, reversals, freeze/close, pagination, OpenAPI, UI, FX,
snapshots, auth. These land as **Should**/**Nice** tickets immediately after.

---

## 11. Success metrics

| Metric | Target |
|---|---|
| Balance corruption in concurrency stress tests | **0** incidents (no lost updates, no double-spends) |
| Partial-state transactions observed | **0** (all-or-nothing, always) |
| Unbalanced transactions posted | **0** (double-entry invariant holds for every row) |
| Audit trails that fail to reproduce a balance | **0** (replay always reconciles to stored-elsewhere truth) |
| Invariant-violating operations that slip through | **0** |
| Automated test coverage (domain + integration) | ≥ 80% |
| Events ever mutated/deleted in production | **0** (append-only enforced) |

---

## 12. Out of scope / future roadmap

| Horizon | Work |
|---|---|
| **Post-MVP (Should)** | Idempotency keys, reversals/voiding, freeze/close lifecycle, pagination + filters, OpenAPI docs, observability |
| **Stretch (Nice)** | Snapshots, multi-currency + FX transfers, web UI, auth + rate limiting, CSV export |
| **Beyond** | Regulatory reporting, payment-rail integrations, consumer app, horizontal sharding |
