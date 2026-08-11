import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';

export const INTERNAL_CASH_ACCOUNT_NUMBER = 'LE-INTERNAL-CASH';
export const INTERNAL_CASH_ACCOUNT_NAME = 'Bank Vault';

/**
 * Owns the bank's internal cash/asset account. Every deposit credits it and
 * every withdrawal debits it, which keeps each movement a true double-entry
 * transaction with a real second leg.
 */
@Injectable()
export class InternalAccountsService {
  private cachedInternalId: string | null = null;

  constructor(
    private readonly runner: PostgresTransactionRunner,
    private readonly accounts: AccountRepository,
  ) {}

  async getInternalCashAccountId(): Promise<string> {
    if (this.cachedInternalId) return this.cachedInternalId;

    const existing = await this.accounts.findByAccountNumber(INTERNAL_CASH_ACCOUNT_NUMBER);
    if (existing) {
      this.cachedInternalId = existing.id;
      return existing.id;
    }

    const id = randomUUID();
    const insertedId = await this.runner.withTransaction((tx) =>
      this.accounts.insertIfAbsent(tx, {
        id,
        accountNumber: INTERNAL_CASH_ACCOUNT_NUMBER,
        name: INTERNAL_CASH_ACCOUNT_NAME,
        type: 'cash',
        normalSide: 'debit',
        currency: 'USD',
        overdraftLimit: '999999999999.9999',
        status: 'active',
      }),
    );

    // A concurrent first call may have won the race (ON CONFLICT DO NOTHING
    // returned no row): resolve to the surviving row instead of erroring.
    const resolvedId = insertedId ?? (await this.accounts.findByAccountNumber(INTERNAL_CASH_ACCOUNT_NUMBER))?.id;
    if (!resolvedId) {
      throw new Error('Internal cash account could not be created or resolved');
    }
    this.cachedInternalId = resolvedId;
    return resolvedId;
  }

  clearCache(): void {
    this.cachedInternalId = null;
  }
}