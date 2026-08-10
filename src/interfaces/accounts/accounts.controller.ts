import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { AccountsService } from '@/application/accounts/accounts.service';
import type { AccountView } from '@/application/accounts/account-view';
import { AuditService, type AuditView } from '@/application/audit/audit.service';
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe';
import { asOfSchema, uuidSchema } from '@/common/validation/schemas';
import { listQuerySchema, type ListQuery } from '@/common/validation/pagination.dto';
import { decodeCursor, type Page } from '@/common/cursor';
import {
  createAccountSchema,
  updateStatusSchema,
  type CreateAccountDto,
  type UpdateStatusDto,
} from './accounts.dto';

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
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery): Promise<Page<AccountView>> {
    const decoded = decodeCursor(query.cursor);
    const cursor =
      decoded && typeof decoded.createdAt === 'string' && typeof decoded.id === 'string'
        ? { createdAt: decoded.createdAt, id: decoded.id }
        : null;
    return this.accounts.listPage(cursor, query.limit ?? 20);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  updateStatus(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) dto: UpdateStatusDto,
  ): Promise<AccountView> {
    return this.accounts.updateStatus(id, dto.status);
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
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<AuditView> {
    const afterSeq = this.afterSeqFromCursor(query.cursor);
    return this.audit.get(id, query.as_of, afterSeq, query.limit ?? 20);
  }

  private afterSeqFromCursor(cursor?: string): number | null {
    const decoded = decodeCursor(cursor);
    return decoded && typeof decoded.seq === 'number' ? decoded.seq : null;
  }

  @Get(':id')
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<AccountView> {
    return this.accounts.get(id);
  }
}