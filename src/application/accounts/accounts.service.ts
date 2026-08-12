import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { encodeCursor, type Page } from '@/common/cursor';
import { DEFAULT_NORMAL_SIDE, generateAccountNumber, type AccountType } from '@/domain/account';
import { AccountClosedError, AccountNotFoundError, InvalidTransactionError } from '@/domain/errors';
import { Money } from '@/domain/money';
import type { NewAccount } from '../../../db/schema';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';
import { AccountEventStore } from '@/application/account-events/account-event.store';
import type { CreateAccountDto } from '@/interfaces/accounts/accounts.dto';
import { toAccountView, type AccountView } from './account-view';

@Injectable()
export class AccountsService {
  constructor(
    private readonly runner: PostgresTransactionRunner,
    private readonly accounts: AccountRepository,
    private readonly store: LedgerStore,
    private readonly events: AccountEventStore,
  ) {}

  async create(dto: CreateAccountDto): Promise<AccountView> {
    const id = randomUUID();
    const normalSide = dto.normalSide ?? DEFAULT_NORMAL_SIDE[dto.type];
    const account: NewAccount = {
      id,
      accountNumber: generateAccountNumber(),
      name: dto.name,
      type: dto.type,
      normalSide,
      currency: dto.currency,
      overdraftLimit: dto.overdraftLimit,
      status: 'active',
    };
    await this.runner.withTransaction(async (tx) => {
      await this.accounts.insert(tx, account);
      // The lifecycle is book-ended by an account_opened event so the
      // aggregate is fully replayable (T-26).
      await this.events.appendWithin(tx, id, 'account_opened', {
        name: account.name,
        type: account.type,
        normalSide,
        currency: account.currency,
        overdraftLimit: account.overdraftLimit,
      });
    });
    return this.get(id);
  }

  async listPage(
    cursor: { createdAt: string; id: string } | null,
    limit: number,
    filters?: { status?: 'active' | 'frozen' | 'closed'; type?: AccountType },
  ): Promise<Page<AccountView>> {
    const rows = await this.accounts.paginate(cursor, limit, filters);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const balances = await this.store.balancesFor(pageRows.map((a) => a.id));
    const items = pageRows.map((a) => toAccountView(a, balances.get(a.id) ?? '0'));

    const last = pageRows[pageRows.length - 1];
    let nextCursor: string | undefined;
    if (hasMore && last) {
      const rawCreatedAt = await this.accounts.rawCreatedAt(last.id);
      nextCursor = encodeCursor({ createdAt: rawCreatedAt, id: last.id });
    }
    return {
      items,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async get(id: string): Promise<AccountView> {
    const account = await this.accounts.findById(id);
    if (!account) throw new AccountNotFoundError();
    const balances = await this.store.balancesFor([id]);
    return toAccountView(account, balances.get(id) ?? '0');
  }

  async balance(id: string, asOf?: Date): Promise<{ balance: string; currency: string; asOf?: string }> {
    const account = await this.accounts.findById(id);
    if (!account) throw new AccountNotFoundError();
    const balances = await this.store.balancesFor([id], asOf);
    const balance = balances.get(id) ?? '0';
    return {
      balance: toAccountView(account, balance).balance,
      currency: account.currency,
      ...(asOf ? { asOf: asOf.toISOString() } : {}),
    };
  }

  /**
   * Freezes or closes an account. Closing requires a zero balance. Status
   * transitions are recorded in the account's metadata status history.
   */
  async updateStatus(id: string, status: 'active' | 'frozen' | 'closed'): Promise<AccountView> {
    const existing = await this.accounts.findById(id);
    if (!existing) throw new AccountNotFoundError();
    if (existing.status === 'closed') {
      throw new InvalidTransactionError('Account is already closed');
    }
    if (existing.status === status) {
      return this.get(id); // idempotent no-op
    }

    await this.runner.withTransaction(async (sql) => {
      const locked = await this.accounts.lockForUpdate(sql, [id]);
      if (locked.length === 0) throw new AccountNotFoundError();
      const current = locked[0];
      if (current.status === 'closed') {
        throw new InvalidTransactionError('Account is already closed');
      }
      if (current.status === status) return;

      if (status === 'closed') {
        const balances = await this.store.balancesFor([id], undefined, sql);
        const balance = Money.fromDecimalString(balances.get(id) ?? '0');
        if (!balance.isZero()) {
          throw new InvalidTransactionError('Cannot close an account with a non-zero balance');
        }
      }

      const metadata = current.metadata ?? {};
      const history = Array.isArray(metadata.statusHistory) ? metadata.statusHistory : [];
      const nextHistory = [
        ...history,
        { at: new Date().toISOString(), from: current.status, to: status },
      ];

      await sql.query(
        'UPDATE accounts SET status = $2, metadata = $3, updated_at = now() WHERE id = $1',
        [id, status, JSON.stringify({ ...metadata, statusHistory: nextHistory })],
      );

      // Mirror the lifecycle change onto the append-only aggregate stream.
      const eventType =
        status === 'closed'
          ? ('account_closed' as const)
          : status === 'frozen'
            ? ('account_frozen' as const)
            : ('account_reactivated' as const);
      await this.events.appendWithin(sql, id, eventType, {
        from: current.status,
        to: status,
        reason: 'Account status changed via API',
      });
    });

    return this.get(id);
  }

  /** Changes the overdraft limit; recorded on the account event stream. */
  async updateLimit(id: string, overdraftLimit: string): Promise<AccountView> {
    const normalized = Money.fromDecimalString(overdraftLimit).toDecimalString();

    await this.runner.withTransaction(async (sql) => {
      const locked = await this.accounts.lockForUpdate(sql, [id]);
      if (locked.length === 0) throw new AccountNotFoundError();
      const account = locked[0];
      if (account.status === 'closed') throw new AccountClosedError('Cannot change the limit of a closed account');

      await this.events.appendWithin(sql, id, 'limit_changed', {
        from: account.overdraftLimit,
        to: normalized,
        overdraftLimit: normalized,
      });
      await sql.query('UPDATE accounts SET overdraft_limit = $2, updated_at = now() WHERE id = $1', [id, normalized]);
    });

    return this.get(id);
  }
}