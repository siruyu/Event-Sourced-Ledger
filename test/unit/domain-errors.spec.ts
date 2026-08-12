import {
  AccountClosedError,
  AccountFrozenError,
  AccountNotFoundError,
  ConflictSequenceError,
  CurrencyMismatchError,
  DomainError,
  DuplicateReferenceError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidTransactionError,
  NotFoundError,
  UnbalancedTransactionError,
} from '@/domain/errors';

const CASES: { ctor: new (msg?: string) => DomainError; code: string; defaultMessage: string }[] = [
  { ctor: AccountNotFoundError, code: 'ACCOUNT_NOT_FOUND', defaultMessage: 'Account not found' },
  { ctor: AccountFrozenError, code: 'ACCOUNT_FROZEN', defaultMessage: 'Account is frozen' },
  { ctor: AccountClosedError, code: 'ACCOUNT_CLOSED', defaultMessage: 'Account is closed' },
  { ctor: InsufficientFundsError, code: 'INSUFFICIENT_FUNDS', defaultMessage: 'Insufficient funds' },
  { ctor: InvalidAmountError, code: 'INVALID_AMOUNT', defaultMessage: 'Invalid amount' },
  { ctor: UnbalancedTransactionError, code: 'UNBALANCED_TRANSACTION', defaultMessage: 'Transaction debits and credits are not balanced' },
  { ctor: InvalidTransactionError, code: 'INVALID_TRANSACTION', defaultMessage: 'Invalid transaction' },
  { ctor: DuplicateReferenceError, code: 'DUPLICATE_REFERENCE', defaultMessage: 'Transaction reference already used' },
  { ctor: ConflictSequenceError, code: 'CONFLICT_SEQUENCE', defaultMessage: 'Concurrent write conflict, retry the operation' },
  { ctor: CurrencyMismatchError, code: 'CURRENCY_MISMATCH', defaultMessage: 'Entry currency does not match the account currency' },
  { ctor: NotFoundError, code: 'NOT_FOUND', defaultMessage: 'Resource not found' },
];

describe('Domain errors (T-11 contract)', () => {
  for (const { ctor, code, defaultMessage } of CASES) {
    describe(ctor.name, () => {
      it('carries the stable code and name with the default message', () => {
        const err = new ctor();
        expect(err.code).toBe(code);
        expect(err.name).toBe(ctor.name);
        expect(err.message).toBe(defaultMessage);
        expect(err).toBeInstanceOf(DomainError);
        expect(err).toBeInstanceOf(Error);
      });

      it('accepts a custom message', () => {
        const err = new ctor('custom detail');
        expect(err.code).toBe(code);
        expect(err.message).toBe('custom detail');
      });
    });
  }
});