import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  TransactionsService,
  type AccountTransactionItem,
  type TransferDto,
} from '@/application/transactions/transactions.service';
import type { TransactionView } from '@/application/transactions/transaction-view';
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe';
import { uuidSchema } from '@/common/validation/schemas';
import { listQuerySchema, type ListQuery } from '@/common/validation/pagination.dto';
import { decodeCursor, type Page } from '@/common/cursor';
import {
  movementSchema,
  transferSchema,
  type MovementDto,
} from './transactions.dto';

@Controller()
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('accounts/:id/deposits')
  @HttpCode(HttpStatus.CREATED)
  deposit(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(movementSchema)) dto: MovementDto,
  ): Promise<TransactionView> {
    return this.transactions.deposit(id, dto);
  }

  @Post('accounts/:id/withdrawals')
  @HttpCode(HttpStatus.CREATED)
  withdraw(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(movementSchema)) dto: MovementDto,
  ): Promise<TransactionView> {
    return this.transactions.withdraw(id, dto);
  }

  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  transfer(
    @Body(new ZodValidationPipe(transferSchema)) dto: TransferDto,
  ): Promise<TransactionView> {
    return this.transactions.transfer(dto);
  }

  @Get('accounts/:id/transactions')
  listForAccount(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<Page<AccountTransactionItem>> {
    const decoded = decodeCursor(query.cursor);
    const afterSeq = decoded && typeof decoded.seq === 'number' ? decoded.seq : null;
    return this.transactions.listForAccount(id, afterSeq, query.limit ?? 20);
  }

  @Get('transactions/:id')
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<TransactionView> {
    return this.transactions.get(id);
  }

  @Post('transactions/:id/void')
  @HttpCode(HttpStatus.CREATED)
  voidTransaction(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<TransactionView> {
    return this.transactions.voidTransaction(id);
  }
}