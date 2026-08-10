import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { Money } from '@/domain/money';
import {
  buildDeposit,
  buildTransfer,
  buildWithdrawal,
  type DoubleEntryTransaction,
} from '@/domain/transaction';
import { balanceAfterEntry, assertPostAllowed } from '@/domain/invariants';
import {
  AccountNotFoundError,
  CurrencyMismatchError,
  NotFoundError,
} from '@/domain/errors';
import type { TransactionType } from '@/domain/account';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore, type AppendEntryInput } from '@/infrastructure/event-store/ledger.store';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { toTransactionView, type TransactionView } from './transaction-view';

export interface PostTransactionOptions {
  type: TransactionType;
  reference?: string;
  description?: string;
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
    private readonly logger: Logger,
  ) {}

  async deposit(accountId: string, dto: MovementDto): Promise<TransactionView> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();
    const cashId = await this.internal.getInternalCashAccountId();
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
    const cashId = await this.internal.getInternalCashAccountId();
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
    const tx = buildTransfer({
      fromAccountId: dto.fromAccountId,
      toAccountId: dto.toAccountId,
      amount: Money.fromDecimalString(dto.amount),
      currency: await this.currencyFor(dto.fromAccountId),
    });
    const id = await this.postTransaction(tx, {
      type: 'transfer',
      reference: dto.reference,
      description: dto.description,
    });
    return this.view(id);
  }

  async get(id: string): Promise<TransactionView> {
    const row = await this.store.findTransaction(id);
    if (!row) throw new NotFoundError('Transaction not found');
    return this.view(id);
  }

  private async currencyFor(accountId: string): Promise<string> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();
    return account.currency;
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

    try {
      await this.runner.withTransaction(async (sql) => {
        const accountIds = [...new Set(domainTx.legs.map((l) => l.accountId))];

        // Deterministic (id-sorted) lock acquisition — deadlock-free and the
        // serialization point that prevents lost updates.
        const locked = await this.accounts.lockForUpdate(sql, accountIds);
        if (locked.length !== accountIds.length) {
          const found = new Set(locked.map((a) => a.id));
          const missing = accountIds.find((id) => !found.has(id));
          throw new AccountNotFoundError(`Account not found: ${missing}`);
        }
        const byId = new Map(locked.map((a) => [a.id, a]));

        for (const leg of domainTx.legs) {
          const account = byId.get(leg.accountId);
          if (account && account.currency !== leg.currency) {
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

        await this.store.insertTransaction(sql, {
          id: txId,
          type: opts.type,
          reference: opts.reference ?? null,
          description: opts.description ?? null,
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

  private async view(id: string): Promise<TransactionView> {
    const row = await this.store.findTransaction(id);
    if (!row) throw new NotFoundError('Transaction not found');
    const entries = await this.store.entriesForTransaction(id);
    return toTransactionView(row, entries);
  }
}