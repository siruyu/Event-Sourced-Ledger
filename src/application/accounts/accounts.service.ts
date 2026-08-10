import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DEFAULT_NORMAL_SIDE, generateAccountNumber } from '@/domain/account';
import { AccountNotFoundError, InvalidTransactionError } from '@/domain/errors';
import { Money } from '@/domain/money';
import type { NewAccount } from '../../../db/schema';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';
import type { CreateAccountDto } from '@/interfaces/accounts/accounts.dto';
import { toAccountView, type AccountView } from './account-view';

@Injectable()
export class AccountsService {
  constructor(
    private readonly runner: PostgresTransactionRunner,
    private readonly accounts: AccountRepository,
    private readonly store: LedgerStore,
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
    await this.runner.withTransaction((tx) => this.accounts.insert(tx, account));
    return this.get(id);
  }

  async list(): Promise<AccountView[]> {
    const accounts = await this.accounts.list();
    const balances = await this.store.balancesFor(accounts.map((a) => a.id));
    return accounts.map((a) => toAccountView(a, balances.get(a.id) ?? '0'));
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
    });

    return this.get(id);
  }
}