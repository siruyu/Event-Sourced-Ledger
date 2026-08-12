import { z } from 'zod';
import {
  accountTypeSchema,
  balanceSideSchema,
  currencySchema,
  nonNegativeMoneySchema,
} from '@/common/validation/schemas';
import { paginationSchema } from '@/common/validation/pagination.dto';

export const createAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name is too long'),
  type: accountTypeSchema.default('checking'),
  normalSide: balanceSideSchema.optional(),
  currency: currencySchema.default('USD'),
  overdraftLimit: nonNegativeMoneySchema.default('0'),
});

export type CreateAccountDto = z.infer<typeof createAccountSchema>;

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'frozen', 'closed'], {
    errorMap: () => ({ message: 'Status must be "active", "frozen", or "closed"' }),
  }),
});
export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;

/** List query for accounts: pagination + status/type filters (T-18). */
export const accountsListQuerySchema = paginationSchema.extend({
  status: z.enum(['active', 'frozen', 'closed']).optional(),
  type: accountTypeSchema.optional(),
});
export type AccountsListQuery = z.infer<typeof accountsListQuerySchema>;
