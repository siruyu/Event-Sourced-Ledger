import { z } from 'zod';
import {
  accountTypeSchema,
  balanceSideSchema,
  currencySchema,
  nonNegativeMoneySchema,
} from '@/common/validation/schemas';

export const createAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name is too long'),
  type: accountTypeSchema.default('checking'),
  normalSide: balanceSideSchema.optional(),
  currency: currencySchema.default('USD'),
  overdraftLimit: nonNegativeMoneySchema.default('0'),
});

export type CreateAccountDto = z.infer<typeof createAccountSchema>;
