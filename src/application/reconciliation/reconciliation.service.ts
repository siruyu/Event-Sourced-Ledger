import { Inject, Injectable } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { PG_POOL } from '@/infrastructure/db/providers';
import { Money } from '@/domain/money';

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

interface CrossCurrencyRow extends QueryResultRow {
  transactionId: string;
  metadata: Record<string, unknown> | null;
  direction: string;
  amount: string;
  currency: string;
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
       HAVING COUNT(DISTINCT e.currency) <= 1
          AND COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount END), 0)
            <> COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount END), 0)`,
    );
    for (const row of unbalanced.rows) {
      issues.push({
        check: 'unbalanced_transaction',
        transactionId: row.transactionId,
        details: { debits: row.debits, credits: row.credits },
      });
    }

    // Cross-currency transactions: debits and credits live in different
    // currencies, so the raw-sum comparison cannot apply. Validate the
    // double-entry invariant in a common currency instead: the quote leg must
    // equal the base leg converted at the recorded fx_rate.
    const crossCurrency = await this.pool.query<CrossCurrencyRow>(
      `SELECT t.id AS "transactionId", t.metadata,
              e.direction, e.amount, e.currency
         FROM transactions t
         JOIN entries e ON e.transaction_id = t.id
        WHERE t.id IN (
          SELECT transaction_id FROM entries
           GROUP BY transaction_id HAVING COUNT(DISTINCT currency) > 1
        )
        ORDER BY t.id, e.id`,
    );
    const byTx = new Map<string, CrossCurrencyRow[]>();
    for (const row of crossCurrency.rows) {
      const list = byTx.get(row.transactionId) ?? [];
      list.push(row);
      byTx.set(row.transactionId, list);
    }
    for (const [transactionId, rows] of byTx) {
      const fxRate = rows[0]?.metadata?.fxRate;
      const fromCurrency = rows[0]?.metadata?.fromCurrency;
      const toCurrency = rows[0]?.metadata?.toCurrency;
      if (
        typeof fxRate !== 'string' ||
        typeof fromCurrency !== 'string' ||
        typeof toCurrency !== 'string'
      ) {
        issues.push({
          check: 'unbalanced_transaction',
          transactionId,
          details: { reason: 'cross-currency transaction missing fx_rate metadata' },
        });
        continue;
      }
      const baseLeg = rows.find((r) => r.currency === fromCurrency);
      const quoteLeg = rows.find((r) => r.currency === toCurrency);
      if (!baseLeg || !quoteLeg) {
        issues.push({
          check: 'unbalanced_transaction',
          transactionId,
          details: { reason: 'cross-currency transaction missing a base/quote leg' },
        });
        continue;
      }
      const expected = Money.fromDecimalString(baseLeg.amount).convertAt(fxRate);
      if (!expected.equals(Money.fromDecimalString(quoteLeg.amount))) {
        issues.push({
          check: 'unbalanced_transaction',
          transactionId,
          details: {
            baseCurrency: fromCurrency,
            quoteCurrency: toCurrency,
            fxRate,
            baseAmount: baseLeg.amount,
            quoteAmount: quoteLeg.amount,
            expectedQuote: expected.toDecimalString(),
          },
        });
      }
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