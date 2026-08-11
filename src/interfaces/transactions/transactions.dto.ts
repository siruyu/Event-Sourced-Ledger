import { z } from 'zod';
import { positiveMoneySchema, referenceSchema, uuidSchema, fxRateSchema } from '@/common/validation/schemas';

export const movementSchema = z.object({
  amount: positiveMoneySchema,
  reference: referenceSchema,
  description: z.string().max(255, 'Description is too long').optional(),
});
export type MovementDto = z.infer<typeof movementSchema>;

export const transferSchema = z
  .object({
    fromAccountId: uuidSchema,
    toAccountId: uuidSchema,
    amount: positiveMoneySchema,
    reference: referenceSchema,
    description: z.string().max(255, 'Description is too long').optional(),
    fxRate: fxRateSchema,
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    path: ['toAccountId'],
    message: 'Source and destination accounts must differ',
  });
export type TransferDto = z.infer<typeof transferSchema>;

export const transactionIdSchema = uuidSchema;