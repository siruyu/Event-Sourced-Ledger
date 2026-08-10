import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { AccountsService } from '@/application/accounts/accounts.service';
import type { AccountView } from '@/application/accounts/account-view';
import { AuditService, type AuditView } from '@/application/audit/audit.service';
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe';
import { asOfSchema, uuidSchema } from '@/common/validation/schemas';
import { createAccountSchema, type CreateAccountDto } from './accounts.dto';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createAccountSchema)) dto: CreateAccountDto,
  ): Promise<AccountView> {
    return this.accounts.create(dto);
  }

  @Get()
  list(): Promise<AccountView[]> {
    return this.accounts.list();
  }

  @Get(':id/balance')
  balance(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query('as_of', new ZodValidationPipe(asOfSchema)) asOf?: Date,
  ): Promise<{ balance: string; currency: string; asOf?: string }> {
    return this.accounts.balance(id, asOf);
  }

  @Get(':id/audit')
  auditTrail(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query('as_of', new ZodValidationPipe(asOfSchema)) asOf?: Date,
  ): Promise<AuditView> {
    return this.audit.get(id, asOf);
  }

  @Get(':id')
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<AccountView> {
    return this.accounts.get(id);
  }
}