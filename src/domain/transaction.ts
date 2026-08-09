import { Money } from './money';
import { InvalidAmountError, InvalidTransactionError, UnbalancedTransactionError } from './errors';

export interface TransactionLeg {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: Money;
  currency: string;
}

/**
 * An immutable, validated double-entry transaction. The invariants enforced at
 * construction mirror the ledger's rules exactly:
 *   - at least two legs
 *   - every amount positive
 *   - an account appears at most once per transaction
 *   - total debits equal total credits (the double-entry invariant)
 */
export class DoubleEntryTransaction {
  readonly legs: readonly TransactionLeg[];

  private constructor(legs: readonly TransactionLeg[]) {
    this.legs = legs;
  }

  static of(legs: readonly TransactionLeg[]): DoubleEntryTransaction {
    if (legs.length < 2) {
      throw new InvalidTransactionError('A transaction requires at least two entries');
    }

    const seen = new Set<string>();
    for (const leg of legs) {
      if (seen.has(leg.accountId)) {
        throw new InvalidTransactionError(
          `Account ${leg.accountId} may appear at most once per transaction`,
        );
      }
      seen.add(leg.accountId);
      if (!leg.amount.isPositive()) {
        throw new InvalidAmountError('Entry amounts must be positive');
      }
    }

    const transaction = new DoubleEntryTransaction([...legs]);
    if (!transaction.isBalanced()) {
      throw new UnbalancedTransactionError(
        `Debits (${transaction.debitsTotal()}) do not match credits (${transaction.creditsTotal()})`,
      );
    }
    return transaction;
  }

  debitsTotal(): Money {
    return this.legs
      .filter((l) => l.direction === 'debit')
      .reduce((sum, l) => sum.add(l.amount), Money.zero());
  }

  creditsTotal(): Money {
    return this.legs
      .filter((l) => l.direction === 'credit')
      .reduce((sum, l) => sum.add(l.amount), Money.zero());
  }

  isBalanced(): boolean {
    return this.debitsTotal().equals(this.creditsTotal());
  }

  /**
   * Returns the legs affecting a given account (zero or one, by construction).
   */
  legFor(accountId: string): TransactionLeg | undefined {
    return this.legs.find((l) => l.accountId === accountId);
  }
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: Money;
  currency: string;
}

/** A transfer: credit the source, debit the destination, by the same amount. */
export function buildTransfer(req: TransferRequest): DoubleEntryTransaction {
  if (req.fromAccountId === req.toAccountId) {
    throw new InvalidTransactionError('Source and destination accounts must differ');
  }
  return DoubleEntryTransaction.of([
    { accountId: req.fromAccountId, direction: 'credit', amount: req.amount, currency: req.currency },
    { accountId: req.toAccountId, direction: 'debit', amount: req.amount, currency: req.currency },
  ]);
}

export interface SingleAccountMovement {
  accountId: string;
  amount: Money;
  currency: string;
}

/**
 * A deposit into a customer account: debit the customer's account, credit the
 * bank's internal cash/asset account. Both legs are real ledger entries.
 */
export function buildDeposit(req: SingleAccountMovement, internalCashAccountId: string): DoubleEntryTransaction {
  return DoubleEntryTransaction.of([
    { accountId: req.accountId, direction: 'debit', amount: req.amount, currency: req.currency },
    { accountId: internalCashAccountId, direction: 'credit', amount: req.amount, currency: req.currency },
  ]);
}

/** A withdrawal: credit the customer's account, debit the bank's cash account. */
export function buildWithdrawal(req: SingleAccountMovement, internalCashAccountId: string): DoubleEntryTransaction {
  return DoubleEntryTransaction.of([
    { accountId: req.accountId, direction: 'credit', amount: req.amount, currency: req.currency },
    { accountId: internalCashAccountId, direction: 'debit', amount: req.amount, currency: req.currency },
  ]);
}
