import { Money } from './money';
import { InvalidAmountError, InvalidTransactionError, UnbalancedTransactionError } from './errors';

export interface TransactionLeg {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: Money;
  currency: string;
}

export interface CrossCurrencyMeta {
  /** Rate expressed as units of quote currency per one base-currency unit. */
  fxRate: string;
  /** The currency the fx rate is denominated from (the source/base leg). */
  fxBase: string;
}

/**
 * An immutable, validated double-entry transaction. The invariants enforced at
 * construction mirror the ledger's rules exactly:
 *   - at least two legs
 *   - every amount positive
 *   - an account appears at most once per transaction
 *   - for same-currency transactions: total debits equal total credits
 *   - for cross-currency transactions: the quote leg equals the base leg
 *     converted at the transaction's fx rate (the double-entry invariant
 *     validated in a common currency)
 */
export class DoubleEntryTransaction {
  readonly legs: readonly TransactionLeg[];
  readonly fxRate?: string;
  readonly fxBase?: string;

  private constructor(legs: readonly TransactionLeg[], crossCurrency?: CrossCurrencyMeta) {
    this.legs = legs;
    this.fxRate = crossCurrency?.fxRate;
    this.fxBase = crossCurrency?.fxBase;
  }

  static of(legs: readonly TransactionLeg[]): DoubleEntryTransaction {
    validateLegs(legs);
    const currencies = new Set(legs.map((l) => l.currency));
    if (currencies.size > 1) {
      throw new UnbalancedTransactionError(
        'Cross-currency transactions require an explicit fx rate',
      );
    }
    const transaction = new DoubleEntryTransaction([...legs]);
    if (!transaction.isBalanced()) {
      throw new UnbalancedTransactionError(
        `Debits (${transaction.debitsTotal()}) do not match credits (${transaction.creditsTotal()})`,
      );
    }
    return transaction;
  }

  /**
   * A multi-currency transaction (e.g. a cross-currency transfer). The
   * double-entry invariant is validated in the base currency: every quote leg
   * must equal its base counterpart converted at `fxRate`.
   */
  static crossCurrency(legs: readonly TransactionLeg[], meta: CrossCurrencyMeta): DoubleEntryTransaction {
    validateLegs(legs);
    const transaction = new DoubleEntryTransaction([...legs], meta);
    if (!transaction.isBalanced()) {
      throw new UnbalancedTransactionError(
        'Cross-currency legs do not reconcile at the supplied fx rate',
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
    const currencies = new Set(this.legs.map((l) => l.currency));
    if (currencies.size === 1) {
      return this.debitsTotal().equals(this.creditsTotal());
    }
    if (!this.fxRate || !this.fxBase) return false;

    const baseLeg = this.legs.find((l) => l.currency === this.fxBase);
    if (!baseLeg) return false;

    for (const leg of this.legs) {
      if (leg.currency === this.fxBase) continue;
      // The quote leg must be the opposite direction and exactly equal to the
      // base leg converted into the quote currency at the transaction's rate.
      if (leg.direction === baseLeg.direction) return false;
      if (!baseLeg.amount.convertAt(this.fxRate).equals(leg.amount)) return false;
    }
    return true;
  }

  /**
   * Returns the legs affecting a given account (zero or one, by construction).
   */
  legFor(accountId: string): TransactionLeg | undefined {
    return this.legs.find((l) => l.accountId === accountId);
  }
}

function validateLegs(legs: readonly TransactionLeg[]): void {
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
}

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amount: Money;
  fromCurrency: string;
  toCurrency: string;
  /** Required when `fromCurrency !== toCurrency`; units of `toCurrency` per 1 `fromCurrency`. */
  fxRate?: string;
}

/**
 * A transfer: credit the source, debit the destination. Same-currency legs are
 * posted in the shared currency unchanged. Cross-currency transfers require an
 * `fxRate`; the destination leg is the source amount converted exactly (half-up
 * to 4 dp), and the double-entry invariant is validated in the source currency.
 */
export function buildTransfer(req: TransferRequest): DoubleEntryTransaction {
  if (req.fromAccountId === req.toAccountId) {
    throw new InvalidTransactionError('Source and destination accounts must differ');
  }
  if (req.fromCurrency === req.toCurrency) {
    if (req.fxRate) {
      throw new InvalidTransactionError('fx_rate is not applicable to same-currency transfers');
    }
    return DoubleEntryTransaction.of([
      { accountId: req.fromAccountId, direction: 'credit', amount: req.amount, currency: req.fromCurrency },
      { accountId: req.toAccountId, direction: 'debit', amount: req.amount, currency: req.toCurrency },
    ]);
  }

  if (!req.fxRate) {
    throw new InvalidTransactionError('fx_rate is required for cross-currency transfers');
  }
  const converted = req.amount.convertAt(req.fxRate);
  return DoubleEntryTransaction.crossCurrency(
    [
      { accountId: req.fromAccountId, direction: 'credit', amount: req.amount, currency: req.fromCurrency },
      { accountId: req.toAccountId, direction: 'debit', amount: converted, currency: req.toCurrency },
    ],
    { fxRate: req.fxRate, fxBase: req.fromCurrency },
  );
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
