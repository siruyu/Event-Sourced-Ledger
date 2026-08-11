import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';

export const INTERNAL_CASH_ACCOUNT_NAME = 'Bank Vault';

/** Well-known account number for a currency's internal cash/vault account. */
export function internalCashAccountNumber(currency: string): string {
  return `LE-INTERNAL-CASH-${currency}`;
}

/**
 * Owns the bank's internal cash/asset accounts — one per currency. Every
 * deposit credits the vault of the deposit's currency and every withdrawal
 * debits it, which keeps each movement a true double-entry transaction with a
 * real second leg in the same currency.
 */
@Injectable()
export class InternalAccountsService {
  private readonly cachedInternalIds = new Map<string, string>();

  constructor(
    private readonly runner: PostgresTransactionRunner,
    private readonly accounts: AccountRepository,
  ) {}

  async getInternalCashAccountId(currency = 'USD'): Promise<string> {
    const cached = this.cachedInternalIds.get(currency);
    if (cached) return cached;

    const accountNumber = internalCashAccountNumber(currency);
    const existing = await this.accounts.findByAccountNumber(accountNumber);
    if (existing) {
      this.cachedInternalIds.set(currency, existing.id);
      return existing.id;
    }

    const id = randomUUID();
    const insertedId = await this.runner.withTransaction((tx) =>
      this.accounts.insertIfAbsent(tx, {
        id,
        accountNumber,
        name: INTERNAL_CASH_ACCOUNT_NAME,
        type: 'cash',
        normalSide: 'debit',
        currency,
        overdraftLimit: '999999999999.9999',
        status: 'active',
      }),
    );

    // A concurrent first call may have won the race (ON CONFLICT DO NOTHING
    // returned no row): resolve to the surviving row instead of erroring.
    const resolvedId = insertedId ?? (await this.accounts.findByAccountNumber(accountNumber))?.id;
    if (!resolvedId) {
      throw new Error(`Internal cash account for ${currency} could not be created or resolved`);
    }
    this.cachedInternalIds.set(currency, resolvedId);
    return resolvedId;
  }

  clearCache(): void {
    this.cachedInternalIds.clear();
  }
}
