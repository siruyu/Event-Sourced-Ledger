import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from '@/application/reconciliation/reconciliation.service';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}