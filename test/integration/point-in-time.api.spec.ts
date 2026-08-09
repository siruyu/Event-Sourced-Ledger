import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Point-in-time balance [T-09]', () => {
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

  async function balanceAt(id: string, asOf?: string): Promise<string> {
    const url = asOf ? `/api/v1/accounts/${id}/balance?as_of=${encodeURIComponent(asOf)}` : `/api/v1/accounts/${id}/balance`;
    const res = await request(http()).get(url).expect(200);
    return res.body.balance;
  }

  async function backdateTransaction(transactionId: string, at: Date) {
    await pool.query('UPDATE entries SET created_at = $1 WHERE transaction_id = $2', [at, transactionId]);
  }

  it('returns the balance exactly as of a past timestamp', async () => {
    const a = await createAccount();
    const t0 = new Date(Date.now() - 120_000);

    const d1 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '500.00' }).expect(201);
    await backdateTransaction(d1.body.id, new Date(t0.getTime() + 1000));

    const d2 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '300.00' }).expect(201);
    await backdateTransaction(d2.body.id, new Date(t0.getTime() + 2000));

    expect(await balanceAt(a.id, new Date(t0.getTime() + 1500).toISOString())).toBe('500.0000');
    expect(await balanceAt(a.id, new Date(t0.getTime() + 2500).toISOString())).toBe('800.0000');
    expect(await balanceAt(a.id)).toBe('800.0000');
  });

  it('applies both legs of a transfer atomically at as-of (no half-transfer)', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const t = new Date(Date.now() - 60_000);

    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '1000.00' }).expect(201);

    const depositTxs = (
      await pool.query('SELECT transaction_id AS id FROM entries WHERE account_id = $1', [a.id])
    ).rows;
    const depositTxId = depositTxs[0].id as string;
    await backdateTransaction(depositTxId, new Date(t.getTime() - 10_000));

    const transfer = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: a.id, toAccountId: b.id, amount: '200.00' })
      .expect(201);
    await backdateTransaction(transfer.body.id, t);

    expect(await balanceAt(a.id, t.toISOString())).toBe('800.0000');
    expect(await balanceAt(b.id, t.toISOString())).toBe('200.0000');
    expect(await balanceAt(a.id)).toBe('800.0000');
    expect(await balanceAt(b.id)).toBe('200.0000');
  });

  it('a future as_of returns the current balance', async () => {
    const a = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '100.00' }).expect(201);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(await balanceAt(a.id, future)).toBe('100.0000');
  });

  it('as_of before any events yields zero', async () => {
    const a = await createAccount();
    const before = new Date(Date.now() - 3_600_000).toISOString();
    expect(await balanceAt(a.id, before)).toBe('0.0000');
  });

  it('rejects a malformed as_of with a validation error', async () => {
    const a = await createAccount();
    const res = await request(http())
      .get(`/api/v1/accounts/${a.id}/balance?as_of=not-a-date`)
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});