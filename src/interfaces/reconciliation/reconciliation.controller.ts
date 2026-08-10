import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ReconciliationService,
  type ReconciliationReport,
} from '@/application/reconciliation/reconciliation.service';

@ApiTags('reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  @ApiOperation({ summary: 'Audit the whole ledger: unbalanced, gapped, or overdrawn rows' })
  @ApiResponse({
    status: 200,
    description: 'Reconciliation report (passed true when zero issues)',
    schema: {
      type: 'object',
      properties: {
        generatedAt: { type: 'string', format: 'date-time' },
        checked: { type: 'object', properties: { transactions: { type: 'integer' }, accounts: { type: 'integer' } } },
        issues: { type: 'array', items: { type: 'object' } },
        passed: { type: 'boolean' },
      },
    },
  })
  run(): Promise<ReconciliationReport> {
    return this.reconciliation.run();
  }
}