import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';

/**
 * Snapshotting (architecture.md §7.4 / T-21).
 *
 * Periodically records a running balance for an account so balance reads only
 * replay the events trailing the snapshot instead of the full history.
 * Scheduling is driven by `SNAPSHOT_INTERVAL_EVENTS` (snapshot every N events)
 * with a `SNAPSHOT_MAX_LAG_EVENTS` safety net that forces a snapshot when the
 * gap since the last snapshot grows too large. Writes are idempotent and
 * concurrency-safe via `UNIQUE(account_id, seq)`.
 */
@Injectable()
export class SnapshotService {
  constructor(
    private readonly store: LedgerStore,
    private readonly config: ConfigService,
  ) {}

  /**
   * Called after a money movement commits. Takes a snapshot for an account
   * when its new sequence hits an interval boundary, or when the lag since the
   * latest snapshot exceeds the configured maximum.
   */
  async maybeSnapshot(accountId: string, currency: string, newSeq: number): Promise<void> {
    const interval = this.int('SNAPSHOT_INTERVAL_EVENTS', 1000);
    if (interval > 0 && newSeq % interval === 0) {
      await this.takeSnapshot(accountId, currency, newSeq);
      return;
    }

    const maxLag = this.int('SNAPSHOT_MAX_LAG_EVENTS', 5000);
    if (maxLag <= 0) return;
    const last = await this.store.latestSnapshotSeq(accountId);
    const lag = last === null ? newSeq : newSeq - last;
    if (lag >= maxLag) {
      await this.takeSnapshot(accountId, currency, newSeq);
    }
  }

  /**
   * Records a snapshot at a given seq (defaults to the account's current
   * sequence) with the exact derived balance up to that point.
   */
  async takeSnapshot(accountId: string, currency: string, seq?: number): Promise<void> {
    const targetSeq = seq ?? (await this.store.currentSequence(accountId));
    if (targetSeq <= 0) return;
    const balance = await this.store.balanceUpToSeq(accountId, targetSeq);
    await this.store.insertSnapshot({ accountId, seq: targetSeq, balance, currency });
  }

  private int(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  }
}
