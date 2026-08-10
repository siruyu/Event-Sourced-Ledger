import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from '@/application/accounts/accounts.service';
import { AuditService } from '@/application/audit/audit.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, AuditService],
})
export class AccountsModule {}
