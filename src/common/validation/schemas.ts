import { z } from 'zod';
import { Money, parseFxRate, type FxRate } from '@/domain/money';
import { ACCOUNT_TYPES, BALANCE_SIDES } from '@/domain/account';

/** A decimal string that `Money` can parse (at most 4 decimal places). */
function tryParseMoney(value: string): Money | null {
  try {
    return Money.fromDecimalString(value);
  } catch {
    return null;
  }
}

/** A strictly positive FX rate (`quote units per one base unit`), ≤ 10 dp. */
function tryParseFxRate(value: string): FxRate | null {
  try {
    return parseFxRate(value);
  } catch {
    return null;
  }
}

const invalidAmountMessage = 'Amount must be a decimal string with up to 4 decimal places';

/** Strictly positive amount (deposits, withdrawals, transfers). */
export const positiveMoneySchema = z.string().superRefine((v, ctx) => {
  const money = tryParseMoney(v);
  if (!money) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: invalidAmountMessage });
    return;
  }
  if (!money.isPositive()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be greater than zero' });
  }
});

/** Strictly positive FX rate for cross-currency transfers. */
export const fxRateSchema = z
  .string()
  .superRefine((v, ctx) => {
    const rate = tryParseFxRate(v);
    if (!rate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fx_rate must be a positive decimal with up to 10 decimal places',
      });
    }
  })
  .optional();

/** Non-negative amount (overdraft limits, balances). */
export const nonNegativeMoneySchema = z.string().superRefine((v, ctx) => {
  const money = tryParseMoney(v);
  if (!money) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: invalidAmountMessage });
    return;
  }
  if (money.isNegative()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be zero or greater' });
  }
});

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const balanceSideSchema = z.enum(BALANCE_SIDES);

export const uuidSchema = z.string().uuid();

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code (e.g. USD)');

/** Optional ISO-8601 timestamp used by point-in-time queries. */
export const asOfSchema = z
  .string()
  .optional()
  .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'as_of must be a valid ISO timestamp')
  .transform((v) => (v === undefined ? undefined : new Date(v)));

/** Optional client idempotency key for money operations. */
export const referenceSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/, 'Reference may only contain letters, digits, . - _')
  .optional();

/** Required reference, e.g. for `GET /transactions?reference=`. */
export const referenceParamSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/, 'Reference may only contain letters, digits, . - _');