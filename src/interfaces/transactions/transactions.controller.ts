import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  TransactionsService,
  type AccountTransactionItem,
  type GlobalTransactionView,
  type TransferDto,
} from '@/application/transactions/transactions.service';
import type { TransactionView } from '@/application/transactions/transaction-view';
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe';
import { uuidSchema } from '@/common/validation/schemas';
import {
  listQuerySchema,
  transactionsFeedQuerySchema,
  type ListQuery,
  type TransactionsFeedQuery,
} from '@/common/validation/pagination.dto';
import { decodeCursor, type Page } from '@/common/cursor';
import { jsonSchema, pageRefSchema } from '@/common/swagger/contract';
import {
  movementSchema,
  transferSchema,
  type MovementDto,
} from './transactions.dto';

const transactionRef = '#/components/schemas/Transaction';
const apiErrorRef = '#/components/schemas/ApiError';

@ApiTags('transactions')
@Controller()
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('accounts/:id/deposits')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Deposit money into an account' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ schema: jsonSchema(movementSchema) })
  @ApiResponse({ status: 201, description: 'Posted deposit', schema: { $ref: transactionRef } })
  @ApiResponse({ status: 422, description: 'Balance/invariant violation', schema: { $ref: apiErrorRef } })
  deposit(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(movementSchema)) dto: MovementDto,
  ): Promise<TransactionView> {
    return this.transactions.deposit(id, dto);
  }

  @Post('accounts/:id/withdrawals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Withdraw money from an account' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ schema: jsonSchema(movementSchema) })
  @ApiResponse({ status: 201, description: 'Posted withdrawal', schema: { $ref: transactionRef } })
  @ApiResponse({ status: 422, description: 'Insufficient funds / invariant violation', schema: { $ref: apiErrorRef } })
  withdraw(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(movementSchema)) dto: MovementDto,
  ): Promise<TransactionView> {
    return this.transactions.withdraw(id, dto);
  }

  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Transfer money between two accounts (atomic double-entry)' })
  @ApiBody({ schema: jsonSchema(transferSchema) })
  @ApiResponse({ status: 201, description: 'Posted transfer', schema: { $ref: transactionRef } })
  @ApiResponse({ status: 422, description: 'Insufficient funds / invariant violation', schema: { $ref: apiErrorRef } })
  @ApiResponse({ status: 404, description: 'Account not found', schema: { $ref: apiErrorRef } })
  transfer(
    @Body(new ZodValidationPipe(transferSchema)) dto: TransferDto,
  ): Promise<TransactionView> {
    return this.transactions.transfer(dto);
  }

  @Get('accounts/:id/transactions')
  @ApiOperation({ summary: 'List an account\'s transactions (paginated)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque pagination cursor' })
  @ApiResponse({ status: 200, description: 'Page of transaction legs', schema: pageRefSchema('#/components/schemas/TransactionLeg') })
  listForAccount(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<AccountTransactionItem>> {
    const decoded = decodeCursor(query.cursor);
    const afterSeq = decoded && typeof decoded.seq === 'number' ? decoded.seq : null;
    return this.transactions.listForAccount(id, afterSeq, query.limit ?? 20);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get a transaction with all its legs' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Transaction detail', schema: { $ref: transactionRef } })
  @ApiResponse({ status: 404, description: 'Transaction not found', schema: { $ref: apiErrorRef } })
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<TransactionView> {
    return this.transactions.get(id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get a transaction by reference, or the global activity feed' })
  @ApiQuery({ name: 'reference', required: false, description: 'Client idempotency key (returns the single matching transaction)' })
  @ApiQuery({ name: 'type', required: false, enum: ['deposit', 'withdrawal', 'transfer', 'reversal', 'fee'] })
  @ApiQuery({ name: 'status', required: false, enum: ['posted', 'void'] })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque pagination cursor' })
  @ApiResponse({ status: 200, description: 'A transaction (with reference) or a page of the feed' })
  @ApiResponse({ status: 404, description: 'No transaction for reference', schema: { $ref: apiErrorRef } })
  async feed(
    @Query(new ZodValidationPipe(transactionsFeedQuerySchema)) query: TransactionsFeedQuery,
  ): Promise<TransactionView | Page<GlobalTransactionView>> {
    if (query.reference) return this.transactions.findByReference(query.reference);

    const decoded = decodeCursor(query.cursor);
    const cursor =
      decoded && typeof decoded.postedAt === 'string' && typeof decoded.id === 'string'
        ? { postedAt: decoded.postedAt, id: decoded.id }
        : null;
    return this.transactions.listGlobal(cursor, query.limit ?? 20, {
      type: query.type,
      status: query.status,
    });
  }

  @Post('transactions/:id/void')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Void a transaction via a compensating reversal' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Reversal transaction', schema: { $ref: transactionRef } })
  @ApiResponse({ status: 422, description: 'Already void / invalid', schema: { $ref: apiErrorRef } })
  voidTransaction(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<TransactionView> {
    return this.transactions.voidTransaction(id);
  }
}