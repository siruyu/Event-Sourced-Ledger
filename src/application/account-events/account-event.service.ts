import { Injectable } from '@nestjs/common';
import { AccountNotFoundError } from '@/domain/errors';
import { Money } from '@/domain/money';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { AccountEventStore, type AccountEventView } from './account-event.store';

export type ProjectedStatus = 'active' | 'frozen' | 'closed';

export interface StatusHistoryItem {
  seq: number;
  type: string;
  createdAt: string;
  reason?: string;
  resultingStatus: ProjectedStatus;
}

export interface AccountProjection {
  status: ProjectedStatus;
  overdraftLimit: string;
  statusHistory: StatusHistoryItem[];
}

/**
 * Rebuilds the account aggregate from its lifecycle event stream (T-26).
 * `projectAccount` replays `account_events` to derive current status and
 * overdraft limit — the `accounts` row is the denormalized projection of this
 * fold, and the projection honours the event `version` for forward-compat.
 */
@Injectable()
export class AccountEventService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: AccountEventStore,
  ) {}

  /** Replays the stream and folds it into current state + status history. */
  async projectAccount(accountId: string): Promise<AccountProjection> {
    await this.requireAccount(accountId);
    return fold(await this.events.replay(accountId));
  }

  /** The ordered "when was it frozen, and why" history, with resulting status. */
  async statusHistory(accountId: string): Promise<StatusHistoryItem[]> {
    await this.requireAccount(accountId);
    return fold(await this.events.replay(accountId)).statusHistory;
  }

  private async requireAccount(accountId: string): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new AccountNotFoundError();
  }
}

function fold(events: AccountEventView[]): AccountProjection {
  let status: ProjectedStatus = 'active';
  let overdraftLimit = '0';
  const statusHistory: StatusHistoryItem[] = [];

  const setLimit = (value: unknown): void => {
    if (typeof value !== 'string') return;
    try {
      overdraftLimit = Money.fromDecimalString(value).toDecimalString();
    } catch {
      /* ignore malformed payloads for forward-compat */
    }
  };

  for (const event of events) {
    const reason = typeof event.payload?.reason === 'string' ? event.payload.reason : undefined;
    switch (event.type) {
      case 'account_opened':
        status = 'active';
        setLimit(event.payload?.overdraftLimit);
        statusHistory.push({ seq: event.seq, type: event.type, createdAt: event.createdAt, reason, resultingStatus: status });
        break;
      case 'account_frozen':
        status = 'frozen';
        statusHistory.push({ seq: event.seq, type: event.type, createdAt: event.createdAt, reason, resultingStatus: status });
        break;
      case 'account_reactivated':
        status = 'active';
        statusHistory.push({ seq: event.seq, type: event.type, createdAt: event.createdAt, reason, resultingStatus: status });
        break;
      case 'account_closed':
        status = 'closed';
        statusHistory.push({ seq: event.seq, type: event.type, createdAt: event.createdAt, reason, resultingStatus: status });
        break;
      case 'limit_changed':
        setLimit(event.payload?.overdraftLimit);
        break;
    }
  }

  return { status, overdraftLimit, statusHistory };
}
