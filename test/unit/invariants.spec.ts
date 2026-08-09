import { Money } from '@/domain/money';
import { balanceAfterEntry, assertPostAllowed } from '@/domain/invariants';
import {
  AccountClosedError,
  AccountFrozenError,
  InsufficientFundsError,
} from '@/domain/errors';

describe('invariants [T-04]', () => {
  describe('balanceAfterEntry', () => {
    it('increases a debit-normal account on a debit, decreases it on a credit', () => {
      const balance = Money.fromDecimalString('100.00');
      expect(balanceAfterEntry(balance, 'debit', 'debit', Money.fromDecimalString('25.00')).toDecimalString()).toBe('125.0000');
      expect(balanceAfterEntry(balance, 'debit', 'credit', Money.fromDecimalString('25.00')).toDecimalString()).toBe('75.0000');
    });

    it('applies the reverse sign rule for credit-normal accounts', () => {
      const balance = Money.fromDecimalString('100.00');
      expect(balanceAfterEntry(balance, 'credit', 'credit', Money.fromDecimalString('25.00')).toDecimalString()).toBe('125.0000');
      expect(balanceAfterEntry(balance, 'credit', 'debit', Money.fromDecimalString('25.00')).toDecimalString()).toBe('75.0000');
    });
  });

  describe('assertPostAllowed', () => {
    const noOverdraft = Money.zero();

    it('allows a posting that keeps the balance within the limit', () => {
      expect(() => assertPostAllowed('active', Money.fromDecimalString('50.00'), noOverdraft)).not.toThrow();
    });

    it('rejects a posting that would go below -overdraftLimit (non-credit account)', () => {
      expect(() => assertPostAllowed('active', Money.fromDecimalString('-0.01'), noOverdraft)).toThrow(InsufficientFundsError);
    });

    it('allows balance down to exactly -overdraftLimit', () => {
      const limit = Money.fromDecimalString('500.00');
      expect(() => assertPostAllowed('active', Money.fromDecimalString('-500.00'), limit)).not.toThrow();
      expect(() => assertPostAllowed('active', Money.fromDecimalString('-500.01'), limit)).toThrow(InsufficientFundsError);
    });

    it('rejects postings to frozen accounts', () => {
      expect(() => assertPostAllowed('frozen', Money.fromDecimalString('10.00'), noOverdraft)).toThrow(AccountFrozenError);
    });

    it('rejects postings to closed accounts', () => {
      expect(() => assertPostAllowed('closed', Money.fromDecimalString('10.00'), noOverdraft)).toThrow(AccountClosedError);
    });
  });
});