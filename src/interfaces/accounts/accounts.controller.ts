import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccountsService } from '@/application/accounts/accounts.service';
import type { AccountView } from '@/application/accounts/account-view';
import { AccountEventService, type StatusHistoryItem } from '@/application/account-events/account-event.service';
import { AuditService, type AuditView } from '@/application/audit/audit.service';
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe';
import { asOfSchema, uuidSchema } from '@/common/validation/schemas';
import { listQuerySchema, type ListQuery } from '@/common/validation/pagination.dto';
import { decodeCursor, type Page } from '@/common/cursor';
import {
  balanceSchema,
  jsonSchema,
  pageRefSchema,
} from '@/common/swagger/contract';
import {
  createAccountSchema,
  updateStatusSchema,
  type CreateAccountDto,
  type UpdateStatusDto,
} from './accounts.dto';

const accountRef = '#/components/schemas/Account';
const apiErrorRef = '#/components/schemas/ApiError';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly accountEvents: AccountEventService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an account' })
  @ApiBody({ schema: jsonSchema(createAccountSchema) })
  @ApiResponse({ status: 201, description: 'Account created', schema: { $ref: accountRef } })
  @ApiResponse({ status: 400, description: 'Validation error', schema: { $ref: apiErrorRef } })
  create(
    @Body(new ZodValidationPipe(createAccountSchema)) dto: CreateAccountDto,
  ): Promise<AccountView> {
    return this.accounts.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List accounts with derived balances' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque pagination cursor' })
  @ApiResponse({ status: 200, description: 'Page of accounts', schema: pageRefSchema(accountRef) })
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
  @ApiOperation({ summary: 'Freeze, unfreeze, or close an account' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ schema: jsonSchema(updateStatusSchema) })
  @ApiResponse({ status: 200, description: 'Updated account', schema: { $ref: accountRef } })
  @ApiResponse({ status: 409, description: 'Account frozen/closed', schema: { $ref: apiErrorRef } })
  @ApiResponse({ status: 422, description: 'Cannot close a non-zero account', schema: { $ref: apiErrorRef } })
  updateStatus(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) dto: UpdateStatusDto,
  ): Promise<AccountView> {
    return this.accounts.updateStatus(id, dto.status);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get current or point-in-time balance' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'as_of', required: false, description: 'ISO-8601 timestamp for point-in-time balance' })
  @ApiResponse({ status: 200, description: 'Derived balance', schema: balanceSchema })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  balance(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query('as_of', new ZodValidationPipe(asOfSchema)) asOf?: Date,
  ): Promise<{ balance: string; currency: string; asOf?: string }> {
    return this.accounts.balance(id, asOf);
  }

  @Get(':id/audit')
  @ApiOperation({ summary: 'Audit trail reconstructing the balance history' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'as_of', required: false, description: 'ISO-8601 timestamp to trim the trail' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque pagination cursor' })
  @ApiResponse({ status: 200, description: 'Audit trail page', schema: pageRefSchema('#/components/schemas/AuditEvent') })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  auditTrail(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<AuditView> {
    const afterSeq = this.afterSeqFromCursor(query.cursor);
    return this.audit.get(id, query.as_of, afterSeq, query.limit ?? 20);
  }

  @Get(':id/status-history')
  @ApiOperation({ summary: 'Rebuild the account status history from its event stream' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Status history (projected from account_events)' })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  statusHistory(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<StatusHistoryItem[]> {
    return this.accountEvents.statusHistory(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single account' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Account detail', schema: { $ref: accountRef } })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<AccountView> {
    return this.accounts.get(id);
  }

  @Get(':id/transactions.csv')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export an account\'s transactions as CSV' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'as_of', required: false, description: 'ISO-8601 timestamp to trim the export' })
  @ApiResponse({ status: 200, description: 'CSV attachment' })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  async exportTransactions(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query('as_of', new ZodValidationPipe(asOfSchema)) asOf: Date | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.audit.writeCsv(res, id, asOf, 'transactions');
  }

  @Get(':id/audit.csv')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export an account\'s audit trail as CSV' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'as_of', required: false, description: 'ISO-8601 timestamp to trim the export' })
  @ApiResponse({ status: 200, description: 'CSV attachment' })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  async exportAudit(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query('as_of', new ZodValidationPipe(asOfSchema)) asOf: Date | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.audit.writeCsv(res, id, asOf, 'audit');
  }

  private afterSeqFromCursor(cursor?: string): number | null {
    const decoded = decodeCursor(cursor);
    return decoded && typeof decoded.seq === 'number' ? decoded.seq : null;
  }
}