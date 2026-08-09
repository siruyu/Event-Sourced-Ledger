import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/infrastructure/db/database.module';
import { HealthModule } from './interfaces/health/health.module';
import { AccountsModule } from './interfaces/accounts/accounts.module';
import { TransactionsModule } from './interfaces/transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    DatabaseModule,
    HealthModule,
    AccountsModule,
    TransactionsModule,
  ],
})
export class AppModule {}