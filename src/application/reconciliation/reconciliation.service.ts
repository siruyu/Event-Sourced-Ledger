import { Inject, Injectable } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { PG_POOL } from '@/infrastructure/db/providers';

export interface ReconciliationIssue {
  check: 'unbalanced_transaction' | 'sequence_gap_or_duplicate' | 'below_overdraft_limit';
  transactionId?: string;
  accountId?: string;
  details: Record<string, unknown>;
}

export interface ReconciliationReport {
  generatedAt: string;
  checked: { transactions: number; accounts: number };
  issues: ReconciliationIssue[];
  passed: boolean;
}

interface UnbalancedRow extends QueryResultRow {
  transactionId: string;
  debits: string;
  credits: string;
}

interface SequenceRow extends QueryResultRow {
  accountId: string;
  count: number;
  maxSeq: number;
  distinctSeq: number;
}

interface OverdraftRow extends QueryResultRow {
  accountId: string;
  balance: string;
  overdraftLimit: string;
}

/**
 * "Prove we're always right" job. Independently re-derives the ledger state from
 * raw SQL (not through the domain layer) and reports any drift:
 *   1. every transaction's debits equal credits
 *   2. every account's per-account sequences are contiguous (no gaps/dups)
 *   3. no account balance sits below its overdraft limit
 */
@Injectable()
export class ReconciliationService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async run(): Promise<ReconciliationReport> {
    const issues: ReconciliationIssue[] = [];

    const unbalanced = await this.pool.query<UnbalancedRow>(
      `SELECT t.id AS "transactionId",
              COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount END), 0)::numeric(19,4) AS debits,
              COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount END), 0)::numeric(19,4) AS credits
         FROM transactions t
         LEFT JOIN entries e ON e.transaction_id = t.id
        GROUP BY t.id
       HAVING COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount END), 0)
            <> COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount END), 0)`,
    );
    for (const row of unbalanced.rows) {
      issues.push({
        check: 'unbalanced_transaction',
        transactionId: row.transactionId,
        details: { debits: row.debits, credits: row.credits },
      });
    }

    const sequence = await this.pool.query<SequenceRow>(
      `SELECT account_id AS "accountId",
              COUNT(*)::int AS count,
              COALESCE(MAX(seq), 0)::int AS "maxSeq",
              COUNT(DISTINCT seq)::int AS "distinctSeq"
         FROM entries
        GROUP BY account_id
       HAVING COUNT(*) <> COALESCE(MAX(seq), 0) OR COUNT(DISTINCT seq) <> COUNT(*)`,
    );
    for (const row of sequence.rows) {
      issues.push({
        check: 'sequence_gap_or_duplicate',
        accountId: row.accountId,
        details: { count: row.count, maxSeq: row.maxSeq, distinctSeq: row.distinctSeq },
      });
    }

    const overdraft = await this.pool.query<OverdraftRow>(
      `SELECT e.account_id AS "accountId",
              COALESCE(SUM(CASE
                    WHEN (e.direction = 'debit'  AND a.normal_side = 'debit')
                      OR (e.direction = 'credit' AND a.normal_side = 'credit')
                    THEN e.amount ELSE -e.amount END), 0)::numeric(19,4) AS balance,
              a.overdraft_limit AS "overdraftLimit"
         FROM entries e
         JOIN accounts a ON a.id = e.account_id
        GROUP BY e.account_id, a.overdraft_limit
       HAVING COALESCE(SUM(CASE
                    WHEN (e.direction = 'debit'  AND a.normal_side = 'debit')
                      OR (e.direction = 'credit' AND a.normal_side = 'credit')
                    THEN e.amount ELSE -e.amount END), 0) < -a.overdraft_limit`,
    );
    for (const row of overdraft.rows) {
      issues.push({
        check: 'below_overdraft_limit',
        accountId: row.accountId,
        details: { balance: row.balance, overdraftLimit: row.overdraftLimit },
      });
    }

    const txCount = await this.pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM transactions',
    );
    const accountCount = await this.pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM accounts',
    );

    return {
      generatedAt: new Date().toISOString(),
      checked: {
        transactions: txCount.rows[0]?.n ?? 0,
        accounts: accountCount.rows[0]?.n ?? 0,
      },
      issues,
      passed: issues.length === 0,
    };
  }
}