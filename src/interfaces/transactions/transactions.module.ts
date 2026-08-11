import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from '@/application/transactions/transactions.service';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { SnapshotService } from '@/application/snapshot/snapshot.service';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, InternalAccountsService, SnapshotService],
  exports: [TransactionsService, InternalAccountsService, SnapshotService],
})
export class TransactionsModule {}