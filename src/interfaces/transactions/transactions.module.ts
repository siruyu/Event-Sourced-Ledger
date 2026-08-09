import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from '@/application/transactions/transactions.service';
import { InternalAccountsService } from '@/application/internal-accounts.service';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, InternalAccountsService],
  exports: [TransactionsService, InternalAccountsService],
})
export class TransactionsModule {}