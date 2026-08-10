import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Reversal / void [T-16]', () => {
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

  it('voiding a deposit returns the balance to zero and marks the original void', async () => {
    const acc = await createAccount();
    const deposit = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00' }).expect(201);
    expect(await balanceOf(acc.id)).toBe('100.0000');

    const reversal = await request(http()).post(`/api/v1/transactions/${deposit.body.id}/void`).expect(201);
    expect(reversal.body.type).toBe('reversal');
    expect(reversal.body.metadata.originalTransactionId).toBe(deposit.body.id);

    expect(await balanceOf(acc.id)).toBe('0.0000');

    const original = await request(http()).get(`/api/v1/transactions/${deposit.body.id}`).expect(200);
    expect(original.body.status).toBe('void');
  });

  it('keeps the event log append-only — nothing is deleted on void', async () => {
    const acc = await createAccount();
    const deposit = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00' }).expect(201);
    await request(http()).post(`/api/v1/transactions/${deposit.body.id}/void`).expect(201);

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM entries');
    expect(count.rows[0].n).toBe(4); // 2 deposit legs + 2 reversal legs
  });

  it('voiding a transfer restores both accounts', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '500.00' }).expect(201);
    const transfer = await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '200.00' }).expect(201);

    expect(await balanceOf(a.id)).toBe('300.0000');
    expect(await balanceOf(b.id)).toBe('200.0000');

    await request(http()).post(`/api/v1/transactions/${transfer.body.id}/void`).expect(201);
    expect(await balanceOf(a.id)).toBe('500.0000');
    expect(await balanceOf(b.id)).toBe('0.0000');
  });

  it('rejects voiding a transaction twice', async () => {
    const acc = await createAccount();
    const deposit = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(201);
    await request(http()).post(`/api/v1/transactions/${deposit.body.id}/void`).expect(201);

    const res = await request(http()).post(`/api/v1/transactions/${deposit.body.id}/void`).expect(422);
    expect(res.body.error.code).toBe('INVALID_TRANSACTION');
  });

  it('rejects voiding an unknown transaction', async () => {
    const res = await request(http())
      .post('/api/v1/transactions/00000000-0000-4000-8000-000000000000/void')
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('shows the reversal in the audit trail as a compensating entry', async () => {
    const acc = await createAccount();
    const deposit = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00' }).expect(201);
    await request(http()).post(`/api/v1/transactions/${deposit.body.id}/void`).expect(201);

    const trail = await request(http()).get(`/api/v1/accounts/${acc.id}/audit`).expect(200);
    expect(trail.body.events).toHaveLength(2);
    expect(trail.body.events.map((e: { type: string }) => e.type)).toEqual(['deposit', 'reversal']);
    expect(trail.body.balance).toBe('0.0000');
  });
});