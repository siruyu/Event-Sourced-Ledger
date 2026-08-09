import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DEFAULT_NORMAL_SIDE, generateAccountNumber } from '@/domain/account';
import { AccountNotFoundError } from '@/domain/errors';
import type { NewAccount } from '../../../db/schema';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';
import type { CreateAccountDto } from '@/interfaces/accounts/accounts.dto';
import { toAccountView, type AccountView } from './account-view';

export const INTERNAL_CASH_ACCOUNT_NUMBER = 'LE-INTERNAL-CASH';
export const INTERNAL_CASH_ACCOUNT_NAME = 'Bank Vault';

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
}