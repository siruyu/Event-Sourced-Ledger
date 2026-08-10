import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Concurrency — no lost updates [T-12]', () => {
  let app: INestApplication;
  let pool: Pool;
  let internal: InternalAccountsService;

  beforeAll(async () => {
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    internal = app.get(InternalAccountsService);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    internal.clearCache();
    await internal.getInternalCashAccountId();
  });

  const http = () => app.getHttpServer();

  async function createAccount() {
    const res = await request(http()).post('/api/v1/accounts').send({ name: 'Acct' }).expect(201);
    return res.body;
  }

  async function balanceOf(id: string): Promise<string> {
    const res = await request(http()).get(`/api/v1/accounts/${id}/balance`).expect(200);
    return res.body.balance;
  }

  async function transfersConcurrently(requests: { fromAccountId: string; toAccountId: string; amount: string }[]) {
    return Promise.all(
      requests.map((r) =>
        request(http()).post('/api/v1/transfers').send(r).then((res) => ({ status: res.status, body: res.body })),
      ),
    );
  }

  async function seqIntegrity(accountId: string) {
    const { rows } = await pool.query('SELECT seq FROM entries WHERE account_id = $1 ORDER BY seq', [accountId]);
    const seqs = rows.map((r) => Number(r.seq));
    const unique = new Set(seqs);
    return {
      count: seqs.length,
      uniqueCount: unique.size,
      max: seqs.length ? Math.max(...seqs) : 0,
      contiguous: seqs.every((s, i) => s === i + 1),
    };
  }

  it('20 concurrent transfers between the same pair lose no updates', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '2000.00' }).expect(201);

    const results = await transfersConcurrently(
      Array.from({ length: 20 }, () => ({ fromAccountId: a.id, toAccountId: b.id, amount: '100.00' })),
    );

    const succeeded = results.filter((r) => r.status === 201);
    expect(succeeded).toHaveLength(20);

    expect(await balanceOf(a.id)).toBe('0.0000');
    expect(await balanceOf(b.id)).toBe('2000.0000');

    const aSeq = await seqIntegrity(a.id);
    expect(aSeq.uniqueCount).toBe(aSeq.count);
    expect(aSeq.contiguous).toBe(true);
    expect(aSeq.max).toBe(21); // 1 deposit + 20 transfer legs
  });

  it('double-spend is impossible: only one of two racing withdrawals can succeed', async () => {
    const a = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '100.00' }).expect(201);

    const [r1, r2] = await Promise.all([
      request(http()).post(`/api/v1/accounts/${a.id}/withdrawals`).send({ amount: '100.00' }),
      request(http()).post(`/api/v1/accounts/${a.id}/withdrawals`).send({ amount: '100.00' }),
    ]);

    const ok = [r1, r2].filter((r) => r.status === 201);
    const rejected = [r1, r2].filter((r) => r.status === 422 && r.body.error.code === 'INSUFFICIENT_FUNDS');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await balanceOf(a.id)).toBe('0.0000');
  });

  it('concurrent deposits all apply and sum exactly', async () => {
    const a = await createAccount();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '10.00' }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(a.id)).toBe('100.0000');

    const seq = await seqIntegrity(a.id);
    expect(seq.uniqueCount).toBe(seq.count);
    expect(seq.contiguous).toBe(true);
  });

  it('opposing transfers (A→B and B→A) do not deadlock', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '1000.00' }).expect(201);
    await request(http()).post(`/api/v1/accounts/${b.id}/deposits`).send({ amount: '1000.00' }).expect(201);

    const results = await transfersConcurrently(
      Array.from({ length: 10 }, (_, i) => ({
        fromAccountId: i % 2 === 0 ? a.id : b.id,
        toAccountId: i % 2 === 0 ? b.id : a.id,
        amount: '50.00',
      })),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(a.id)).toBe('1000.0000');
    expect(await balanceOf(b.id)).toBe('1000.0000');
  });

  it('event history always reconciles with derived balances after a burst of activity', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '500.00' }).expect(201);

    await transfersConcurrently(
      Array.from({ length: 10 }, () => ({ fromAccountId: a.id, toAccountId: b.id, amount: '10.00' })),
    );

    const { rows } = await pool.query(
      `SELECT e.account_id AS id,
              SUM(CASE WHEN (e.direction = 'debit' AND ac.normal_side = 'debit')
                        OR (e.direction = 'credit' AND ac.normal_side = 'credit')
                       THEN e.amount ELSE -e.amount END)::numeric(19,4) AS replayed
         FROM entries e JOIN accounts ac ON ac.id = e.account_id
        WHERE e.account_id = ANY($1::uuid[])
        GROUP BY e.account_id`,
      [[a.id, b.id]],
    );
    const replayed = new Map(rows.map((r) => [r.id, Number(r.replayed)]));
    expect(replayed.get(a.id)).toBe(Number(await balanceOf(a.id)));
    expect(replayed.get(b.id)).toBe(Number(await balanceOf(b.id)));
  });
});