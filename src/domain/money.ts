import { InvalidAmountError } from './errors';

/**
 * Money value object. Amounts are stored as integer minor units of 1/10,000
 * (4 decimal places) in a BigInt — never as an IEEE-754 float. Parsing and
 * formatting happen only at the API boundary; every internal operation is
 * exact.
 */
const SCALE = 4n;
const SCALE_FACTOR = 10n ** SCALE;
/** NUMERIC(19,4) in Postgres: up to 15 integer digits. */
const MAX_INTEGER_DIGITS = 15n;
const MAX_UNITS = 10n ** (MAX_INTEGER_DIGITS + SCALE) - 1n;

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,4}))?$/;

/** FX rate: strictly positive decimal, up to 10 decimal places. */
const FX_RATE_PATTERN = /^(\d+)(?:\.(\d{1,10}))?$/;

/** Parsed FX rate: BigInt-scaled units plus the number of decimal places. */
export type FxRate = { units: bigint; scale: number };

/**
 * Parses an FX rate (units of quote currency per one base unit) into a
 * BigInt-scaled representation so conversions are exact under integer math.
 */
export function parseFxRate(rate: string): FxRate {
  const match = FX_RATE_PATTERN.exec(rate.trim());
  if (!match) throw new InvalidAmountError(`Invalid fx rate: "${rate}"`);
  const integer = BigInt(match[1]);
  const frac = match[2] ?? '';
  const scale = frac.length;
  const units = scale === 0 ? integer : integer * 10n ** BigInt(scale) + BigInt(frac);
  if (units <= 0n) throw new InvalidAmountError('fx rate must be positive');
  return { units, scale };
}

/**
 * Rounds `numer/denom` to `scale` decimal places using half-up rounding
 * (ties round away from zero). Deterministic under BigInt — no floats.
 */
export function roundHalfUp(numer: bigint, denom: bigint, scale: number): bigint {
  const factor = 10n ** BigInt(scale);
  const abs = numer < 0n ? -numer : numer;
  const quotient = (abs * factor + denom / 2n) / denom;
  return numer < 0n ? -quotient : quotient;
}

export class Money {
  private constructor(readonly units: bigint) {}

  static readonly DECIMAL_PLACES = 4;

  static zero(): Money {
    return new Money(0n);
  }

  static fromUnits(units: bigint): Money {
    if (units > MAX_UNITS || units < -MAX_UNITS) {
      throw new InvalidAmountError('Amount exceeds the supported range');
    }
    return new Money(units);
  }

  /**
   * Parses a decimal string such as "12.34", "-5", "0.0001". Amounts with more
   * than 4 decimal places are rejected to protect ledger precision.
   */
  static fromDecimalString(value: string): Money {
    if (typeof value !== 'string') {
      throw new InvalidAmountError('Amount must be a decimal string');
    }
    const match = DECIMAL_PATTERN.exec(value.trim());
    if (!match) {
      throw new InvalidAmountError(`Invalid amount format: "${value}"`);
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const integerPart = BigInt(match[2]);
    const fraction = (match[3] ?? '').padEnd(4, '0');
    const units = integerPart * SCALE_FACTOR + BigInt(fraction || '0');
    return Money.fromUnits(sign * units);
  }

  toDecimalString(): string {
    const negative = this.units < 0n;
    const abs = negative ? -this.units : this.units;
    const integerPart = abs / SCALE_FACTOR;
    const fraction = (abs % SCALE_FACTOR).toString().padStart(4, '0');
    return `${negative ? '-' : ''}${integerPart}.${fraction}`;
  }

  add(other: Money): Money {
    return new Money(this.units + other.units);
  }

  sub(other: Money): Money {
    return new Money(this.units - other.units);
  }

  negate(): Money {
    return new Money(-this.units);
  }

  abs(): Money {
    return this.units < 0n ? this.negate() : this;
  }

  /**
   * Scales this amount by an FX rate (`rate` = units of quote currency per one
   * base unit), returning a new Money rounded to 4 decimal places with
   * deterministic half-up rounding. Currency semantics are the caller's
   * responsibility; this only performs the exact numeric conversion.
   */
  convertAt(rate: string): Money {
    const { units: rateUnits, scale } = parseFxRate(rate);
    const denom = 10n ** BigInt(scale);
    const units = roundHalfUp(this.units * rateUnits, denom, 0);
    return Money.fromUnits(units);
  }

  compareTo(other: Money): -1 | 0 | 1 {
    if (this.units === other.units) return 0;
    return this.units < other.units ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.units === other.units;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  gt(other: Money): boolean {
    return this.units > other.units;
  }

  gte(other: Money): boolean {
    return this.units >= other.units;
  }

  lt(other: Money): boolean {
    return this.units < other.units;
  }

  lte(other: Money): boolean {
    return this.units <= other.units;
  }

  toString(): string {
    return this.toDecimalString();
  }
}
