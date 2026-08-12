import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { encodeCursor, type Page } from '@/common/cursor';
import { Money } from '@/domain/money';
import { balanceEffect } from '@/domain/invariants';
import { AccountNotFoundError } from '@/domain/errors';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { LedgerStore, type AuditRow } from '@/infrastructure/event-store/ledger.store';

export interface AuditEventView {
  seq: number;
  transactionId: string;
  type: string;
  reference: string | null;
  description: string | null;
  direction: 'debit' | 'credit';
  amount: string;
  /** Signed balance change for this account, e.g. "+250.0000" or "-200.0000". */
  effect: string;
  runningBalance: string;
  postedAt: string;
  /** FX rate applied on cross-currency transactions (quote per source unit). */
  fxRate?: string;
  counterparty: { accountId: string; accountNumber: string; name: string } | null;
  explanation: string;
}

export interface AuditView extends Page<AuditEventView> {
  accountId: string;
  accountNumber: string;
  balance: string;
  asOf?: string;
}

function humanType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function signed(value: Money): string {
  return value.isNegative() ? `-${value.abs().toDecimalString()}` : `+${value.toDecimalString()}`;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly store: LedgerStore,
  ) {}

  async get(
    accountId: string,
    asOf?: Date,
    afterSeq?: number | null,
    limit = 20,
    range?: { from?: Date; to?: Date },
  ): Promise<AuditView> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();

    // Seed the running balance at the cursor instead of replaying the full
    // history: only the requested page is read from the DB per request. For a
    // statement window the base is the balance strictly before `from`, so the
    // running balance at each row reflects the whole history, not just the page.
    const base =
      range?.from && afterSeq == null
        ? ((await this.store.balancesFor([accountId], new Date(range.from.getTime() - 1))).get(accountId) ?? '0')
        : await this.store.balanceUpToSeq(accountId, afterSeq ?? 0, asOf);
    let running = Money.fromDecimalString(base);

    const rows = await this.store.rawAudit(accountId, asOf, afterSeq, limit + 1, range);
    const counterpartyIds = [...new Set(rows.flatMap((r) => r.counterpartyIds))];
    const accountInfo = await this.accounts.accountInfoFor(counterpartyIds);

    const allEvents: AuditEventView[] = rows.map((row) => {
      const delta =
        balanceEffect(account.normalSide, row.direction) === 1
          ? Money.fromDecimalString(row.amount)
          : Money.fromDecimalString(row.amount).negate();
      running = running.add(delta);

      const counterpartyId = row.counterpartyIds[0];
      const info = counterpartyId ? accountInfo.get(counterpartyId) : undefined;
      const label = info ? `${info.name} (${info.accountNumber})` : undefined;

      return {
        seq: row.seq,
        transactionId: row.transactionId,
        type: row.type,
        reference: row.reference,
        description: row.description,
        direction: row.direction,
        amount: Money.fromDecimalString(row.amount).toDecimalString(),
        effect: signed(delta),
        runningBalance: running.toDecimalString(),
        postedAt: row.postedAt.toISOString(),
        ...(this.fxRateOf(row) ? { fxRate: this.fxRateOf(row) } : {}),
        counterparty: info && counterpartyId ? { accountId: counterpartyId, accountNumber: info.accountNumber, name: info.name } : null,
        explanation: this.explain(row, delta, label, running),
      };
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? allEvents.slice(0, limit) : allEvents;
    const last = page[page.length - 1];

    // The account-level balance is the full derived balance at the window end
    // (as_of > to > now), independent of which page is being viewed.
    const full = await this.store.balancesFor([accountId], range?.to ?? asOf);
    const balance = Money.fromDecimalString(full.get(accountId) ?? '0').toDecimalString();

    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      balance,
      ...(asOf ? { asOf: asOf.toISOString() } : {}),
      ...(range?.from ? { from: range.from.toISOString() } : {}),
      ...(range?.to ? { to: range.to.toISOString() } : {}),
      items: page,
      ...(hasMore && last ? { nextCursor: encodeCursor({ seq: last.seq }) } : {}),
    };
  }

  private fxRateOf(row: AuditRow): string | undefined {
    const rate = row.metadata?.fxRate;
    return typeof rate === 'string' ? rate : undefined;
  }

  private explain(row: AuditRow, delta: Money, counterpartyLabel: string | undefined, running: Money): string {
    const directionWord = row.direction === 'debit' ? 'from' : 'to';
    const clause = counterpartyLabel ? ` ${directionWord} ${counterpartyLabel}` : '';
    const rateClause = this.fxRateOf(row) ? ` @ fx ${this.fxRateOf(row)}` : '';
    return `${humanType(row.type)} ${signed(delta)}${clause}${rateClause} — balance ${running.toDecimalString()}`;
  }

  /**
   * Streams an account's history as CSV (T-25). Rows are fetched in bounded
   * pages and streamed to the response, so arbitrarily large histories never
   * load fully into memory. Amounts are decimal strings (never scientific
   * notation); a UTF-8 BOM + CRLF line endings keep Excel happy.
   */
  async writeCsv(
    res: Response,
    accountId: string,
    asOf?: Date,
    variant: 'transactions' | 'audit' = 'transactions',
  ): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();

    const columns =
      variant === 'audit'
        ? ['seq', 'date', 'transaction_id', 'type', 'direction', 'amount', 'currency', 'counterparty_account', 'running_balance', 'reference', 'fx_rate', 'explanation']
        : ['date', 'transaction_id', 'type', 'direction', 'amount', 'currency', 'counterparty_account', 'running_balance', 'reference'];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${variant}-${account.accountNumber}.csv"`);
    res.write('\uFEFF'); // UTF-8 BOM for Excel
    res.write(csvRow(columns));

    const pageSize = 500;
    let afterSeq: number | null = null;
    let running = Money.fromDecimalString(await this.store.balanceUpToSeq(accountId, 0, asOf));

    for (;;) {
      const rows = await this.store.rawAudit(accountId, asOf, afterSeq, pageSize);
      if (rows.length === 0) break;

      const counterpartyIds = [...new Set(rows.flatMap((r) => r.counterpartyIds))];
      const info = await this.accounts.accountInfoFor(counterpartyIds);

      for (const row of rows) {
        const delta =
          balanceEffect(account.normalSide, row.direction) === 1
            ? Money.fromDecimalString(row.amount)
            : Money.fromDecimalString(row.amount).negate();
        running = running.add(delta);

        const counterpartyId = row.counterpartyIds[0];
        const cp = counterpartyId ? info.get(counterpartyId) : undefined;

        const base = [
          row.postedAt.toISOString(),
          row.transactionId,
          row.type,
          row.direction,
          Money.fromDecimalString(row.amount).toDecimalString(),
          row.currency,
          cp?.accountNumber ?? '',
          running.toDecimalString(),
          row.reference ?? '',
        ];
        const values =
          variant === 'audit'
            ? [String(row.seq), ...base, this.fxRateOf(row) ?? '', this.explain(row, delta, cp ? `${cp.name} (${cp.accountNumber})` : undefined, running)]
            : base;
        res.write(csvRow(values));
      }

      (res as Response & { flush?: () => void }).flush?.();
      if (rows.length < pageSize) break;
      afterSeq = rows[rows.length - 1].seq;
    }

    res.end();
  }
}

/** RFC-4180-ish CSV cell: quotes fields containing comma/quote/newline. */
export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvRow(values: string[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}