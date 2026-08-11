import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '@/infrastructure/db/database.module';
import { LoggingModule } from '@/infrastructure/logging/logging.module';
import { ApiKeyGuard } from '@/common/security/api-key.guard';
import { ApiKeyThrottlerGuard } from '@/common/security/api-key-throttler.guard';
import { HealthModule } from './interfaces/health/health.module';
import { AccountsModule } from './interfaces/accounts/accounts.module';
import { TransactionsModule } from './interfaces/transactions/transactions.module';
import { ReconciliationModule } from './interfaces/reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: Number(config.get('RATE_LIMIT_WINDOW_MS', 60_000)),
            limit: Number(config.get('RATE_LIMIT_MAX', 100)),
          },
        ],
      }),
    }),
    LoggingModule,
    DatabaseModule,
    HealthModule,
    AccountsModule,
    TransactionsModule,
    ReconciliationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard },
  ],
})
export class AppModule {}
