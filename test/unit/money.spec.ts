import { Money } from '@/domain/money';
import { InvalidAmountError } from '@/domain/errors';

describe('Money [T-04]', () => {
  describe('parsing', () => {
    it('parses whole and fractional decimal strings exactly', () => {
      expect(Money.fromDecimalString('12.34').toDecimalString()).toBe('12.3400');
      expect(Money.fromDecimalString('12').toDecimalString()).toBe('12.0000');
      expect(Money.fromDecimalString('0.0001').toDecimalString()).toBe('0.0001');
      expect(Money.fromDecimalString('1000.00').toDecimalString()).toBe('1000.0000');
    });

    it('handles negative amounts', () => {
      expect(Money.fromDecimalString('-3.50').toDecimalString()).toBe('-3.5000');
    });

    it('rejects amounts with more than 4 decimal places', () => {
      expect(() => Money.fromDecimalString('1.12345')).toThrow(InvalidAmountError);
    });

    it('rejects malformed strings and non-strings', () => {
      for (const bad of ['', 'abc', '1.2.3', '--1', '1_000', '1e3', '   ', '.', '1.']) {
        expect(() => Money.fromDecimalString(bad)).toThrow(InvalidAmountError);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => Money.fromDecimalString(42 as any)).toThrow(InvalidAmountError);
    });

    it('rejects amounts exceeding the supported numeric(19,4) range', () => {
      expect(() => Money.fromDecimalString('1000000000000000.0000')).toThrow(InvalidAmountError);
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts without float drift', () => {
      const a = Money.fromDecimalString('0.1');
      const b = Money.fromDecimalString('0.2');
      expect(a.add(b).toDecimalString()).toBe('0.3000');

      const x = Money.fromDecimalString('1000.00');
      const y = Money.fromDecimalString('250.1234');
      expect(x.sub(y).toDecimalString()).toBe('749.8766');
    });

    it('negates and takes absolute values', () => {
      expect(Money.fromDecimalString('5.00').negate().toDecimalString()).toBe('-5.0000');
      expect(Money.fromDecimalString('-5.00').abs().toDecimalString()).toBe('5.0000');
    });
  });

  describe('comparison', () => {
    it('compares and checks equality/positivity', () => {
      const a = Money.fromDecimalString('10.00');
      const b = Money.fromDecimalString('10.0000');
      const c = Money.fromDecimalString('9.99');

      expect(a.equals(b)).toBe(true);
      expect(a.gt(c)).toBe(true);
      expect(c.lt(a)).toBe(true);
      expect(a.gte(b)).toBe(true);
      expect(a.compareTo(c)).toBe(1);
      expect(c.compareTo(a)).toBe(-1);
      expect(Money.zero().isZero()).toBe(true);
      expect(a.isPositive()).toBe(true);
      expect(Money.fromDecimalString('-1').isNegative()).toBe(true);
    });
  });

  describe('boundary behaviour', () => {
    it('supports sub-decimal rounding-adjacent values', () => {
      expect(Money.fromDecimalString('0.9999').toDecimalString()).toBe('0.9999');
      expect(Money.fromDecimalString('0.9999').add(Money.fromDecimalString('0.0001')).toDecimalString()).toBe('1.0000');
    });

    it('round-trips arbitrary values through the DB numeric format', () => {
      for (const v of ['0', '0.0001', '123456789012345.1234', '-987654321.0001']) {
        expect(Money.fromDecimalString(v).toDecimalString()).toBe(
          v.includes('.') ? v.padEnd(v.indexOf('.') + 5, '0') : `${v}.0000`,
        );
      }
    });
  });
});