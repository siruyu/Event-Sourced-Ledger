/**
 * Domain errors carry a stable machine-readable code used verbatim in API
 * responses (see the error contract, T-11).
 */
export abstract class DomainError extends Error {
  readonly code: string;

  protected constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(message = 'Account not found') {
    super('ACCOUNT_NOT_FOUND', message);
  }
}

export class AccountFrozenError extends DomainError {
  constructor(message = 'Account is frozen') {
    super('ACCOUNT_FROZEN', message);
  }
}

export class AccountClosedError extends DomainError {
  constructor(message = 'Account is closed') {
    super('ACCOUNT_CLOSED', message);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(message = 'Insufficient funds') {
    super('INSUFFICIENT_FUNDS', message);
  }
}

export class InvalidAmountError extends DomainError {
  constructor(message = 'Invalid amount') {
    super('INVALID_AMOUNT', message);
  }
}

export class UnbalancedTransactionError extends DomainError {
  constructor(message = 'Transaction debits and credits are not balanced') {
    super('UNBALANCED_TRANSACTION', message);
  }
}

export class InvalidTransactionError extends DomainError {
  constructor(message = 'Invalid transaction') {
    super('INVALID_TRANSACTION', message);
  }
}

export class DuplicateReferenceError extends DomainError {
  constructor(message = 'Transaction reference already used') {
    super('DUPLICATE_REFERENCE', message);
  }
}

export class ConflictSequenceError extends DomainError {
  constructor(message = 'Concurrent write conflict, retry the operation') {
    super('CONFLICT_SEQUENCE', message);
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(message = 'Entry currency does not match the account currency') {
    super('CURRENCY_MISMATCH', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message);
  }
}
