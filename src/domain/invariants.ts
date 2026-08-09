import { Money } from './money';
import {
  AccountClosedError,
  AccountFrozenError,
  InsufficientFundsError,
} from './errors';
import type { BalanceSide, AccountStatus, EntryDirection } from './account';

/**
 * Whether an entry moves an account's balance up (+amount) or down (-amount).
 * Entries in the account's normal direction add; opposite entries subtract.
 */
export function balanceEffect(normalSide: BalanceSide, direction: EntryDirection): 1 | -1 {
  return direction === normalSide ? 1 : -1;
}

/** Balance after posting a single entry to an account with the given current balance. */
export function balanceAfterEntry(
  currentBalance: Money,
  normalSide: BalanceSide,
  direction: EntryDirection,
  amount: Money,
): Money {
  const effect = balanceEffect(normalSide, direction);
  return effect === 1 ? currentBalance.add(amount) : currentBalance.sub(amount);
}

/**
 * Atomic-enforcement gate, checked under lock before any entry is written.
 * The account must be active and, for debit-normal accounts, may not fall
 * below -overdraftLimit.
 */
export function assertPostAllowed(
  status: AccountStatus,
  balanceAfter: Money,
  overdraftLimit: Money,
): void {
  if (status === 'frozen') throw new AccountFrozenError();
  if (status === 'closed') throw new AccountClosedError();
  if (balanceAfter.lt(overdraftLimit.negate())) {
    throw new InsufficientFundsError(
      `Insufficient funds: post would leave balance ${balanceAfter.toDecimalString()}`,
    );
  }
}