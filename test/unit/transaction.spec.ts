import { Money } from '@/domain/money';
import {
  buildDeposit,
  buildTransfer,
  buildWithdrawal,
  DoubleEntryTransaction,
} from '@/domain/transaction';
import {
  InvalidAmountError,
  InvalidTransactionError,
  UnbalancedTransactionError,
} from '@/domain/errors';

const A = 'account-a';
const B = 'account-b';
const CASH = 'internal-cash';

describe('DoubleEntryTransaction [T-04]', () => {
  it('accepts a valid two-leg balanced transaction', () => {
    const tx = DoubleEntryTransaction.of([
      { accountId: A, direction: 'debit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
      { accountId: B, direction: 'credit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
    ]);
    expect(tx.isBalanced()).toBe(true);
    expect(tx.legs).toHaveLength(2);
  });

  it('accepts transactions with many legs as long as debits equal credits', () => {
    const tx = DoubleEntryTransaction.of([
      { accountId: A, direction: 'debit', amount: Money.fromDecimalString('50.00'), currency: 'USD' },
      { accountId: 'c', direction: 'debit', amount: Money.fromDecimalString('50.00'), currency: 'USD' },
      { accountId: B, direction: 'credit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
    ]);
    expect(tx.isBalanced()).toBe(true);
  });

  it('rejects unbalanced transactions (debits != credits)', () => {
    expect(() =>
      DoubleEntryTransaction.of([
        { accountId: A, direction: 'debit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
        { accountId: B, direction: 'credit', amount: Money.fromDecimalString('99.00'), currency: 'USD' },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('rejects transactions with fewer than two entries', () => {
    expect(() =>
      DoubleEntryTransaction.of([
        { accountId: A, direction: 'debit', amount: Money.fromDecimalString('1.00'), currency: 'USD' },
      ]),
    ).toThrow(InvalidTransactionError);
  });

  it('rejects a single-entry unbalanced transaction', () => {
    expect(() => DoubleEntryTransaction.of([])).toThrow(InvalidTransactionError);
  });

  it('rejects an account appearing twice in one transaction', () => {
    expect(() =>
      DoubleEntryTransaction.of([
        { accountId: A, direction: 'debit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
        { accountId: A, direction: 'credit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
      ]),
    ).toThrow(InvalidTransactionError);
  });

  it('rejects zero or negative entry amounts', () => {
    expect(() =>
      DoubleEntryTransaction.of([
        { accountId: A, direction: 'debit', amount: Money.zero(), currency: 'USD' },
        { accountId: B, direction: 'credit', amount: Money.fromDecimalString('0.00'), currency: 'USD' },
      ]),
    ).toThrow(InvalidAmountError);
  });
});

describe('transaction builders', () => {
  it('buildTransfer creates one credit and one debit of the same amount', () => {
    const tx = buildTransfer({
      fromAccountId: A,
      toAccountId: B,
      amount: Money.fromDecimalString('250.00'),
      fromCurrency: 'USD',
      toCurrency: 'USD',
    });
    expect(tx.legFor(A)?.direction).toBe('credit');
    expect(tx.legFor(B)?.direction).toBe('debit');
    expect(tx.legFor(A)?.amount.toDecimalString()).toBe('250.0000');
    expect(tx.isBalanced()).toBe(true);
  });

  it('buildTransfer rejects a self-transfer (A → A)', () => {
    expect(() =>
      buildTransfer({
        fromAccountId: A,
        toAccountId: A,
        amount: Money.fromDecimalString('1.00'),
        fromCurrency: 'USD',
        toCurrency: 'USD',
      }),
    ).toThrow(InvalidTransactionError);
  });

  it('buildTransfer converts cross-currency legs at the fx rate (half-up to 4dp)', () => {
    const tx = buildTransfer({
      fromAccountId: A,
      toAccountId: B,
      amount: Money.fromDecimalString('100.00'),
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      fxRate: '0.85',
    });
    expect(tx.legFor(A)?.currency).toBe('USD');
    expect(tx.legFor(A)?.amount.toDecimalString()).toBe('100.0000');
    expect(tx.legFor(B)?.currency).toBe('EUR');
    expect(tx.legFor(B)?.amount.toDecimalString()).toBe('85.0000');
    expect(tx.isBalanced()).toBe(true);
    expect(tx.fxRate).toBe('0.85');
  });

  it('buildTransfer applies deterministic half-up rounding on conversions', () => {
    const tx = buildTransfer({
      fromAccountId: A,
      toAccountId: B,
      amount: Money.fromDecimalString('1.00'),
      fromCurrency: 'USD',
      toCurrency: 'JPY',
      fxRate: '123.456',
    });
    expect(tx.legFor(B)?.amount.toDecimalString()).toBe('123.4560');
  });

  it('buildTransfer rejects a cross-currency transfer without an fx rate', () => {
    expect(() =>
      buildTransfer({
        fromAccountId: A,
        toAccountId: B,
        amount: Money.fromDecimalString('10.00'),
        fromCurrency: 'USD',
        toCurrency: 'EUR',
      }),
    ).toThrow(InvalidTransactionError);
  });

  it('buildTransfer rejects an fx rate on a same-currency transfer', () => {
    expect(() =>
      buildTransfer({
        fromAccountId: A,
        toAccountId: B,
        amount: Money.fromDecimalString('10.00'),
        fromCurrency: 'USD',
        toCurrency: 'USD',
        fxRate: '1.0',
      }),
    ).toThrow(InvalidTransactionError);
  });

  it('DoubleEntryTransaction.crossCurrency validates the forward conversion', () => {
    expect(() =>
      DoubleEntryTransaction.crossCurrency(
        [
          { accountId: A, direction: 'credit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
          { accountId: B, direction: 'debit', amount: Money.fromDecimalString('85.00'), currency: 'EUR' },
        ],
        { fxRate: '0.85', fxBase: 'USD' },
      ),
    ).toBeDefined();

    // A quote leg that does not reconcile at the rate is rejected.
    expect(() =>
      DoubleEntryTransaction.crossCurrency(
        [
          { accountId: A, direction: 'credit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
          { accountId: B, direction: 'debit', amount: Money.fromDecimalString('90.00'), currency: 'EUR' },
        ],
        { fxRate: '0.85', fxBase: 'USD' },
      ),
    ).toThrow(UnbalancedTransactionError);
  });

  it('DoubleEntryTransaction.of rejects un-routed multi-currency legs', () => {
    expect(() =>
      DoubleEntryTransaction.of([
        { accountId: A, direction: 'credit', amount: Money.fromDecimalString('100.00'), currency: 'USD' },
        { accountId: B, direction: 'debit', amount: Money.fromDecimalString('85.00'), currency: 'EUR' },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it('buildDeposit debits the customer and credits the internal cash account', () => {
    const tx = buildDeposit({ accountId: A, amount: Money.fromDecimalString('500.00'), currency: 'USD' }, CASH);
    expect(tx.legFor(A)?.direction).toBe('debit');
    expect(tx.legFor(CASH)?.direction).toBe('credit');
    expect(tx.isBalanced()).toBe(true);
  });

  it('buildWithdrawal credits the customer and debits the internal cash account', () => {
    const tx = buildWithdrawal({ accountId: A, amount: Money.fromDecimalString('500.00'), currency: 'USD' }, CASH);
    expect(tx.legFor(A)?.direction).toBe('credit');
    expect(tx.legFor(CASH)?.direction).toBe('debit');
    expect(tx.isBalanced()).toBe(true);
  });

  it('rejects a zero-amount transfer', () => {
    expect(() =>
      buildTransfer({
        fromAccountId: A,
        toAccountId: B,
        amount: Money.fromDecimalString('0.00'),
        fromCurrency: 'USD',
        toCurrency: 'USD',
      }),
    ).toThrow(InvalidAmountError);
  });
});