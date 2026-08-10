import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Idempotency [T-15]', () => {
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

  it('a repeated deposit reference returns the original transaction and credits once', async () => {
    const acc = await createAccount();
    const payload = { amount: '250.00', reference: 'payroll-jan' };

    const first = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send(payload).expect(201);
    const second = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send(payload).expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(await balanceOf(acc.id)).toBe('250.0000');
  });

  it('a repeated transfer reference resolves to the original and moves money once', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '500.00', reference: 'seed' }).expect(201);

    const payload = { fromAccountId: a.id, toAccountId: b.id, amount: '100.00', reference: 'rent-2026' };
    const first = await request(http()).post('/api/v1/transfers').send(payload).expect(201);
    const second = await request(http()).post('/api/v1/transfers').send(payload).expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(await balanceOf(a.id)).toBe('400.0000');
    expect(await balanceOf(b.id)).toBe('100.0000');
  });

  it('different references produce independent transactions', async () => {
    const acc = await createAccount();
    const r1 = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00', reference: 'ref-1' }).expect(201);
    const r2 = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '20.00', reference: 'ref-2' }).expect(201);

    expect(r2.body.id).not.toBe(r1.body.id);
    expect(await balanceOf(acc.id)).toBe('30.0000');
  });

  it('concurrent requests with the same reference create exactly one transaction', async () => {
    const acc = await createAccount();

    const [r1, r2, r3] = await Promise.all([
      request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00', reference: 'race-ref' }),
      request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00', reference: 'race-ref' }),
      request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00', reference: 'race-ref' }),
    ]);

    const ids = [r1.body.id, r2.body.id, r3.body.id];
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(201);
    expect(new Set(ids).size).toBe(1);
    expect(await balanceOf(acc.id)).toBe('100.0000');

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM transactions WHERE reference = $1', ['race-ref']);
    expect(count.rows[0].n).toBe(1);
  });
});