import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { encodeCursor, type Page } from '@/common/cursor';
import { Money } from '@/domain/money';
import {
  buildDeposit,
  buildTransfer,
  buildWithdrawal,
  DoubleEntryTransaction,
} from '@/domain/transaction';
import { balanceAfterEntry, assertPostAllowed } from '@/domain/invariants';
import {
  AccountNotFoundError,
  CurrencyMismatchError,
  InvalidTransactionError,
  NotFoundError,
} from '@/domain/errors';
import type { TransactionType } from '@/domain/account';
import { PostgresTransactionRunner, type SqlExecutor } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore, type AppendEntryInput } from '@/infrastructure/event-store/ledger.store';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { SnapshotService } from '@/application/snapshot/snapshot.service';
import { toTransactionView, type TransactionView } from './transaction-view';

export interface PostTransactionOptions {
  type: TransactionType;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface MovementDto {
  amount: string;
  reference?: string;
  description?: string;
}

export interface TransferDto {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  reference?: string;
  description?: string;
  /** Units of the destination currency per one source-currency unit (cross-currency only). */
  fxRate?: string;
}

export interface AccountTransactionItem {
  seq: number;
  transactionId: string;
  type: string;
  status: string;
  reference: string | null;
  description: string | null;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
  postedAt: string;
}

export interface GlobalTransactionLegView {
  accountId: string;
  accountNumber: string;
  accountName: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
}

export interface GlobalTransactionView {
  id: string;
  type: string;
  status: string;
  reference: string | null;
  description: string | null;
  postedAt: string;
  legs: GlobalTransactionLegView[];
}

/**
 * Posts all money movements. Every operation is a validated double-entry
 * transaction written to the append-only event log inside a single database
 * transaction, under row locks held in deterministic order, with all
 * invariants checked before anything is committed.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly runner: PostgresTransactionRunner,
    private readonly accounts: AccountRepository,
    private readonly store: LedgerStore,
    private readonly internal: InternalAccountsService,
    private readonly snapshot: SnapshotService,
    private readonly logger: Logger,
  ) {}

  async deposit(accountId: string, dto: MovementDto): Promise<TransactionView> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();
    const cashId = await this.internal.getInternalCashAccountId(account.currency);
    const tx = buildDeposit(
      { accountId, amount: Money.fromDecimalString(dto.amount), currency: account.currency },
      cashId,
    );
    const id = await this.postTransaction(tx, {
      type: 'deposit',
      reference: dto.reference,
      description: dto.description,
    });
    return this.view(id);
  }

  async withdraw(accountId: string, dto: MovementDto): Promise<TransactionView> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();
    const cashId = await this.internal.getInternalCashAccountId(account.currency);
    const tx = buildWithdrawal(
      { accountId, amount: Money.fromDecimalString(dto.amount), currency: account.currency },
      cashId,
    );
    const id = await this.postTransaction(tx, {
      type: 'withdrawal',
      reference: dto.reference,
      description: dto.description,
    });
    return this.view(id);
  }

  async transfer(dto: TransferDto): Promise<TransactionView> {
    const from = await this.accounts.findById(dto.fromAccountId);
    if (!from) throw new AccountNotFoundError();
    const to = await this.accounts.findById(dto.toAccountId);
    if (!to) throw new AccountNotFoundError();

    const tx = buildTransfer({
      fromAccountId: dto.fromAccountId,
      toAccountId: dto.toAccountId,
      amount: Money.fromDecimalString(dto.amount),
      fromCurrency: from.currency,
      toCurrency: to.currency,
      fxRate: dto.fxRate,
    });
    const metadata =
      from.currency !== to.currency
        ? { fxRate: dto.fxRate, fromCurrency: from.currency, toCurrency: to.currency }
        : undefined;
    const id = await this.postTransaction(tx, {
      type: 'transfer',
      reference: dto.reference,
      description: dto.description,
      metadata,
    });
    return this.view(id);
  }

  async get(id: string): Promise<TransactionView> {
    const row = await this.store.findTransaction(id);
    if (!row) throw new NotFoundError('Transaction not found');
    return this.view(id);
  }

  /**
   * Looks up a transaction by its client reference (idempotency key). Lets a
   * client resolve the original transaction for a retried request.
   */
  async findByReference(reference: string): Promise<TransactionView> {
    const row = await this.store.findTransactionByReference(reference);
    if (!row) throw new NotFoundError(`No transaction found for reference "${reference}"`);
    return this.view(row.id);
  }

  async listForAccount(
    accountId: string,
    afterSeq: number | null,
    limit: number,
  ): Promise<Page<AccountTransactionItem>> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();

    const rows = await this.store.paginateAccountTransactions(accountId, afterSeq, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = page.map((r) => ({
      seq: r.seq,
      transactionId: r.transactionId,
      type: r.type,
      status: r.status,
      reference: r.reference,
      description: r.description,
      direction: r.direction,
      amount: Money.fromDecimalString(r.amount).toDecimalString(),
      currency: r.currency,
      postedAt: r.postedAt.toISOString(),
    }));

    const last = page[page.length - 1];
    return {
      items,
      ...(hasMore && last ? { nextCursor: encodeCursor({ seq: last.seq }) } : {}),
    };
  }

  /**
   * Global transaction feed across all accounts, newest first (T-29). Cursor is
   * `(postedAt, id)` so two transactions sharing a timestamp never overlap.
   */
  async listGlobal(
    cursor: { postedAt: string; id: string } | null,
    limit: number,
    filters?: { type?: string; status?: string },
  ): Promise<Page<GlobalTransactionView>> {
    const rows = await this.store.paginateGlobalTransactions(cursor, limit + 1, filters);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: GlobalTransactionView[] = page.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      reference: r.reference,
      description: r.description,
      postedAt: r.postedAt.toISOString(),
      legs: r.legs.map((l) => ({
        accountId: l.accountId,
        accountNumber: l.accountNumber,
        accountName: l.accountName,
        direction: l.direction,
        amount: Money.fromDecimalString(l.amount).toDecimalString(),
        currency: l.currency,
      })),
    }));

    const last = page[page.length - 1];
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: encodeCursor({ postedAt: last.postedAt.toISOString(), id: last.id }) }
        : {}),
    };
  }

  /**
   * The core atomic write path shared by deposits, withdrawals, and transfers.
   * Returns the new transaction id (or the already-existing one when an
   * idempotency reference is repeated). The single DB transaction guarantees:
   * no partial writes, atomic invariant rejection, and no lost updates.
   */
  private async postTransaction(
    domainTx: DoubleEntryTransaction,
    opts: PostTransactionOptions,
  ): Promise<string> {
    // Idempotency fast path: a repeated reference resolves to the original
    // transaction instead of creating a duplicate money movement.
    if (opts.reference) {
      const existing = await this.store.findTransactionByReference(opts.reference);
      if (existing) return existing.id;
    }

    const txId = randomUUID();
    let committedSeqs: Map<string, number> | undefined;

    try {
      await this.runner.withTransaction(async (sql) => {
        const entrySeq = await this.collectEntrySeqs(sql, domainTx);
        committedSeqs = entrySeq;

        await this.store.insertTransaction(sql, {
          id: txId,
          type: opts.type,
          reference: opts.reference ?? null,
          description: opts.description ?? null,
          metadata: opts.metadata,
          postedAt: new Date(),
        });

        const entries: AppendEntryInput[] = domainTx.legs.map((leg) => ({
          transactionId: txId,
          accountId: leg.accountId,
          seq: entrySeq.get(leg.accountId) as number,
          direction: leg.direction,
          amount: leg.amount.toDecimalString(),
          currency: leg.currency,
        }));
        await this.store.appendEntries(sql, entries);
        await this.accounts.bumpSequences(
          sql,
          [...entrySeq].map(([id, seq]) => ({ id, seq })),
        );

        // Everything above happened atomically; this line can only be reached
        // when the insert genuinely committed a new row.
        if (opts.reference) {
          this.logger.log(
            { transactionId: txId, reference: opts.reference },
            'transaction created (reference committed atomically)',
          );
        }
      });

      this.logger.log(
        {
          transactionId: txId,
          type: opts.type,
          amount: domainTx.debitsTotal().toDecimalString(),
          accountIds: domainTx.legs.map((l) => l.accountId),
          reference: opts.reference ?? null,
        },
        'transaction posted',
      );

      await this.snapshotAfterCommit(domainTx, committedSeqs);
    } catch (err) {
      // A unique violation on the reference column means another concurrent
      // request won the race for this reference: resolve to that transaction.
      const pgErr = err as { code?: string; constraint?: string };
      if (
        pgErr.code === '23505' &&
        pgErr.constraint === 'transactions_reference_unique' &&
        opts.reference
      ) {
        const existing = await this.store.findTransactionByReference(opts.reference);
        if (existing) {
          this.logger.log(
            { transactionId: existing.id, reference: opts.reference },
            'duplicate reference resolved to existing transaction',
          );
          return existing.id;
        }
      }
      throw err;
    }

    return txId;
  }

  /**
   * Best-effort snapshot scheduling after a commit. Snapshot failures are
   * logged and swallowed — they must never fail an already-committed money
   * movement (reads stay correct either way; they just lose the optimization).
   */
  private async snapshotAfterCommit(
    domainTx: DoubleEntryTransaction,
    committedSeqs: Map<string, number> | undefined,
  ): Promise<void> {
    if (!committedSeqs) return;
    for (const leg of domainTx.legs) {
      const seq = committedSeqs.get(leg.accountId);
      if (typeof seq !== 'number') continue;
      try {
        await this.snapshot.maybeSnapshot(leg.accountId, leg.currency, seq);
      } catch (err) {
        this.logger.error(
          { accountId: leg.accountId, seq, error: err instanceof Error ? err.message : err },
          'snapshot scheduling failed (non-fatal)',
        );
      }
    }
  }

  /**
   * Voids a posted transaction by appending a compensating (reversal)
   * transaction that mirrors every leg with its direction flipped, then marks
   * the original void. Everything happens atomically and the event log stays
   * append-only — events are never deleted.
   */
  async voidTransaction(transactionId: string): Promise<TransactionView> {
    const original = await this.store.findTransaction(transactionId);
    if (!original) throw new NotFoundError('Transaction not found');
    if (original.status === 'void') {
      throw new InvalidTransactionError('Transaction is already void');
    }

    const originalEntries = await this.store.entriesForTransaction(transactionId);
    const reversalLegs = originalEntries.map((e) => ({
      accountId: e.accountId,
      direction: (e.direction === 'debit' ? 'credit' : 'debit') as 'debit' | 'credit',
      amount: Money.fromDecimalString(e.amount),
      currency: e.currency,
    }));
    const reversalTx = DoubleEntryTransaction.of(reversalLegs);

    const reversalId = randomUUID();
    let committedSeqs: Map<string, number> | undefined;
    await this.runner.withTransaction(async (sql) => {
      const entrySeq = await this.collectEntrySeqs(sql, reversalTx);
      committedSeqs = entrySeq;

      await this.store.insertTransaction(sql, {
        id: reversalId,
        type: 'reversal',
        reference: null,
        description: `Reversal of ${transactionId}`,
        metadata: { originalTransactionId: transactionId },
        postedAt: new Date(),
      });

      const entries: AppendEntryInput[] = reversalTx.legs.map((leg) => ({
        transactionId: reversalId,
        accountId: leg.accountId,
        seq: entrySeq.get(leg.accountId) as number,
        direction: leg.direction,
        amount: leg.amount.toDecimalString(),
        currency: leg.currency,
      }));
      await this.store.appendEntries(sql, entries);
      await this.accounts.bumpSequences(
        sql,
        [...entrySeq].map(([id, seq]) => ({ id, seq })),
      );

      const marked = await this.store.markTransactionVoid(sql, transactionId);
      if (!marked) {
        throw new InvalidTransactionError('Transaction was already voided');
      }
    });

    this.logger.log(
      { transactionId: reversalId, originalTransactionId: transactionId, type: 'reversal' },
      'transaction voided via compensating reversal',
    );

    await this.snapshotAfterCommit(reversalTx, committedSeqs);
    return this.view(reversalId);
  }

  /**
   * Serialization + invariant gate shared by every write path. Acquires row
   * locks in deterministic (id-sorted) order (deadlock-free, no lost updates),
   * validates currency and balance invariants under lock, and returns the
   * per-account sequence number each entry must receive.
   */
  private async collectEntrySeqs(
    sql: SqlExecutor,
    domainTx: DoubleEntryTransaction,
  ): Promise<Map<string, number>> {
    const accountIds = [...new Set(domainTx.legs.map((l) => l.accountId))];

    const locked = await this.accounts.lockForUpdate(sql, accountIds);
    if (locked.length !== accountIds.length) {
      const found = new Set(locked.map((a) => a.id));
      const missing = accountIds.find((id) => !found.has(id));
      throw new AccountNotFoundError(`Account not found: ${missing}`);
    }
    const byId = new Map(locked.map((a) => [a.id, a]));

    for (const leg of domainTx.legs) {
      const account = byId.get(leg.accountId)!;
      if (account.currency !== leg.currency) {
        throw new CurrencyMismatchError(
          `Entry currency ${leg.currency} does not match account currency ${account.currency}`,
        );
      }
    }

    const balances = await this.store.balancesFor(accountIds, undefined, sql);
    const entrySeq = new Map<string, number>();
    for (const leg of domainTx.legs) {
      const account = byId.get(leg.accountId)!;
      const current = Money.fromDecimalString(balances.get(leg.accountId) ?? '0');
      const after = balanceAfterEntry(current, account.normalSide, leg.direction, leg.amount);
      assertPostAllowed(account.status, after, Money.fromDecimalString(account.overdraftLimit));
      entrySeq.set(leg.accountId, account.currentSequence + 1);
    }
    return entrySeq;
  }

  private async view(id: string): Promise<TransactionView> {
    const row = await this.store.findTransaction(id);
    if (!row) throw new NotFoundError('Transaction not found');
    const entries = await this.store.entriesForTransaction(id);
    return toTransactionView(row, entries);
  }
}