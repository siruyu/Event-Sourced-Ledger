import { z } from 'zod';

/** Keyset pagination query params shared by list endpoints. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().max(256).optional(),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/** Query schema for list endpoints that also support point-in-time (`as_of`). */
export const listQuerySchema = z.object({
  as_of: z
    .string()
    .optional()
    .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'as_of must be a valid ISO timestamp')
    .transform((v) => (v === undefined ? undefined : new Date(v))),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  cursor: z.string().max(256).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
