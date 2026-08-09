import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from '@/application/accounts/accounts.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
