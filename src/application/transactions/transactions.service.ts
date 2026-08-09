import { Injectable } from '@nestjs/common';
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
  DuplicateReferenceError,
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
   * Returns the new transaction id. The single DB transaction guarantees:
   * no partial writes, atomic invariant rejection, and no lost updates.
   */
  private async postTransaction(
    domainTx: DoubleEntryTransaction,
    opts: PostTransactionOptions,
  ): Promise<string> {
    const txId = randomUUID();

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

      try {
        await this.store.insertTransaction(sql, {
          id: txId,
          type: opts.type,
          reference: opts.reference ?? null,
          description: opts.description ?? null,
          postedAt: new Date(),
        });
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') {
          throw new DuplicateReferenceError();
        }
        throw err;
      }

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
    });

    return txId;
  }

  private async view(id: string): Promise<TransactionView> {
    const row = await this.store.findTransaction(id);
    if (!row) throw new NotFoundError('Transaction not found');
    const entries = await this.store.entriesForTransaction(id);
    return toTransactionView(row, entries);
  }
}