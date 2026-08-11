import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from '@/application/accounts/accounts.service';
import { AuditService } from '@/application/audit/audit.service';
import { AccountEventService } from '@/application/account-events/account-event.service';
import { AccountEventStore } from '@/application/account-events/account-event.store';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, AuditService, AccountEventService, AccountEventStore],
  exports: [AccountEventStore],
})
export class AccountsModule {}
