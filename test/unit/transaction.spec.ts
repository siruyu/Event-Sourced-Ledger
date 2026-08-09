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
    const tx = buildTransfer({ fromAccountId: A, toAccountId: B, amount: Money.fromDecimalString('250.00'), currency: 'USD' });
    expect(tx.legFor(A)?.direction).toBe('credit');
    expect(tx.legFor(B)?.direction).toBe('debit');
    expect(tx.legFor(A)?.amount.toDecimalString()).toBe('250.0000');
    expect(tx.isBalanced()).toBe(true);
  });

  it('buildTransfer rejects a self-transfer (A → A)', () => {
    expect(() =>
      buildTransfer({ fromAccountId: A, toAccountId: A, amount: Money.fromDecimalString('1.00'), currency: 'USD' }),
    ).toThrow(InvalidTransactionError);
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
      buildTransfer({ fromAccountId: A, toAccountId: B, amount: Money.fromDecimalString('0.00'), currency: 'USD' }),
    ).toThrow(InvalidAmountError);
  });
});