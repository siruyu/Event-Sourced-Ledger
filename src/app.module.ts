import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/infrastructure/db/database.module';
import { LoggingModule } from '@/infrastructure/logging/logging.module';
import { HealthModule } from './interfaces/health/health.module';
import { AccountsModule } from './interfaces/accounts/accounts.module';
import { TransactionsModule } from './interfaces/transactions/transactions.module';
import { ReconciliationModule } from './interfaces/reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    LoggingModule,
    DatabaseModule,
    HealthModule,
    AccountsModule,
    TransactionsModule,
    ReconciliationModule,
  ],
})
export class AppModule {}