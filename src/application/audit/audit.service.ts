import { Injectable } from '@nestjs/common';
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

  async get(accountId: string, asOf?: Date, afterSeq?: number | null, limit = 20): Promise<AuditView> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();

    const rows = await this.store.rawAudit(accountId, asOf);
    const counterpartyIds = [...new Set(rows.flatMap((r) => r.counterpartyIds))];
    const accountInfo = await this.accounts.accountInfoFor(counterpartyIds);

    let running = Money.zero();
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
        counterparty: info && counterpartyId ? { accountId: counterpartyId, accountNumber: info.accountNumber, name: info.name } : null,
        explanation: this.explain(row, delta, label, running),
      };
    });

    const from = afterSeq ?? 0;
    const pageCandidates = allEvents.filter((e) => e.seq > from);
    const hasMore = pageCandidates.length > limit;
    const page = hasMore ? pageCandidates.slice(0, limit) : pageCandidates;
    const last = page[page.length - 1];

    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      balance: running.toDecimalString(),
      ...(asOf ? { asOf: asOf.toISOString() } : {}),
      items: page,
      ...(hasMore && last ? { nextCursor: encodeCursor({ seq: last.seq }) } : {}),
    };
  }

  private explain(row: AuditRow, delta: Money, counterpartyLabel: string | undefined, running: Money): string {
    const directionWord = row.direction === 'debit' ? 'from' : 'to';
    const clause = counterpartyLabel ? ` ${directionWord} ${counterpartyLabel}` : '';
    return `${humanType(row.type)} ${signed(delta)}${clause} — balance ${running.toDecimalString()}`;
  }
}