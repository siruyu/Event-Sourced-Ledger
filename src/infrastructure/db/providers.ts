import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../../db/schema';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');
export type Database = NodePgDatabase<typeof schema>;