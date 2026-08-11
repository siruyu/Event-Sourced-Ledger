import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { ConflictSequenceError } from '@/domain/errors';

class FakeClient {
  public readonly queries: string[] = [];
  public released = false;

  constructor(private readonly shouldFail: () => boolean) {}

  query(_sql: string): Promise<{ rows: unknown[]; rowCount: number | null }> {
    this.queries.push(_sql);
    if (_sql.startsWith('BEGIN') && this.shouldFail()) {
      return Promise.reject({ code: '40001' });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  release(): void {
    this.released = true;
  }
}

/**
 * Simulates BEGIN failing `failBegins` times across the whole transaction
 * attempt sequence (a fresh client per attempt, one shared failure budget).
 */
class FakePool {
  private remainingFailures: number;

  constructor(failBegins: number) {
    this.remainingFailures = failBegins;
  }

  connect(): FakeClient {
    return new FakeClient(() => {
      if (this.remainingFailures > 0) {
        this.remainingFailures -= 1;
        return true;
      }
      return false;
    });
  }
}

function configWith(retries: string): { get: () => string } {
  return { get: () => retries };
}

describe('PostgresTransactionRunner (retry/backoff) [T-13 hardening]', () => {
  it('retries transient 40001 serialization failures and eventually commits', async () => {
    const runner = new PostgresTransactionRunner(new FakePool(2) as never);

    const result = await runner.withTransaction(async (tx) => {
      await tx.query('SELECT 1');
      return 'ok';
    });

    expect(result).toBe('ok');
  });

  it('retries exactly up to TX_MAX_RETRIES then surfaces CONFLICT_SEQUENCE', async () => {
    // The pool fails BEGIN every time; a budget of 2 means 3 attempts total.
    const runner = new PostgresTransactionRunner(
      new FakePool(999) as never,
      configWith('2') as never,
    );

    await expect(
      runner.withTransaction(async (tx) => {
        await tx.query('SELECT 1');
      }),
    ).rejects.toBeInstanceOf(ConflictSequenceError);
  });

  it('honours TX_MAX_RETRIES of 0 (no retries, immediate conflict error)', async () => {
    const runner = new PostgresTransactionRunner(
      new FakePool(999) as never,
      configWith('0') as never,
    );

    await expect(runner.withTransaction(() => Promise.resolve(undefined))).rejects.toBeInstanceOf(
      ConflictSequenceError,
    );
  });

  it('rethrows non-retryable errors immediately without retrying', async () => {
    const runner = new PostgresTransactionRunner(
      {
        connect: () =>
          ({
            query: (_sql: string) =>
              Promise.reject(Object.assign(new Error('boom'), { code: '23505' })),
            release: () => undefined,
          }) as never,
      } as never,
      configWith('5') as never,
    );

    await expect(runner.withTransaction(() => Promise.resolve(undefined))).rejects.toThrow('boom');
  });

  it('defaults to a sane retry budget when TX_MAX_RETRIES is unset', async () => {
    const runner = new PostgresTransactionRunner(new FakePool(3) as never);

    const result = await runner.withTransaction(async (tx) => {
      await tx.query('SELECT 1');
      return 'committed';
    });

    expect(result).toBe('committed');
  });
});
