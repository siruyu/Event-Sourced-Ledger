import { Global, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import './pg-types';
import * as schema from '../../../db/schema';
import { DRIZZLE_DB, PG_POOL, type Database } from './providers';
import { PostgresTransactionRunner } from './tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';

const poolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Pool => {
    const url = config.getOrThrow<string>('DATABASE_URL');
    const poolConfig: PoolConfig = {
      connectionString: url,
      max: Number(config.get('DB_POOL_MAX', '20')),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
    return new Pool(poolConfig);
  },
};

const drizzleProvider: Provider = {
  provide: DRIZZLE_DB,
  inject: [PG_POOL],
  useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
};

@Global()
@Module({
  providers: [
    poolProvider,
    drizzleProvider,
    PostgresTransactionRunner,
    AccountRepository,
    LedgerStore,
  ],
  exports: [
    PG_POOL,
    DRIZZLE_DB,
    PostgresTransactionRunner,
    AccountRepository,
    LedgerStore,
  ],
})
export class DatabaseModule {}