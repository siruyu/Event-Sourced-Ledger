import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Invariant enforcement [T-08]', () => {
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

  async function createAccount(overrides: Record<string, unknown> = {}) {
    const res = await request(http())
      .post('/api/v1/accounts')
      .send({ name: 'Account', ...overrides })
      .expect(201);
    return res.body;
  }

  async function setStatus(accountId: string, status: string) {
    await pool.query('UPDATE accounts SET status = $1 WHERE id = $2', [status, accountId]);
  }

  async function balanceOf(id: string): Promise<string> {
    const res = await request(http()).get(`/api/v1/accounts/${id}/balance`).expect(200);
    return res.body.balance;
  }

  it('rejects all mutations on a frozen account', async () => {
    const acc = await createAccount();
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '500.00' }).expect(201);
    await setStatus(acc.id, 'frozen');

    const deposit = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(409);
    expect(deposit.body.error.code).toBe('ACCOUNT_FROZEN');
    expect(await balanceOf(acc.id)).toBe('500.0000');

    const withdraw = await request(http()).post(`/api/v1/accounts/${acc.id}/withdrawals`).send({ amount: '10.00' }).expect(409);
    expect(withdraw.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  it('rejects transfers involving a frozen account (sender or recipient)', async () => {
    const frozen = await createAccount();
    const other = await createAccount();
    await request(http()).post(`/api/v1/accounts/${frozen.id}/deposits`).send({ amount: '500.00' }).expect(201);
    await setStatus(frozen.id, 'frozen');

    const asSender = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: frozen.id, toAccountId: other.id, amount: '10.00' })
      .expect(409);
    expect(asSender.body.error.code).toBe('ACCOUNT_FROZEN');

    await request(http()).post(`/api/v1/accounts/${other.id}/deposits`).send({ amount: '100.00' }).expect(201);
    const asRecipient = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: other.id, toAccountId: frozen.id, amount: '10.00' })
      .expect(409);
    expect(asRecipient.body.error.code).toBe('ACCOUNT_FROZEN');

    expect(await balanceOf(frozen.id)).toBe('500.0000');
    expect(await balanceOf(other.id)).toBe('100.0000');
  });

  it('rejects all writes on a closed account but still serves reads', async () => {
    const acc = await createAccount();
    await setStatus(acc.id, 'closed');

    const deposit = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(409);
    expect(deposit.body.error.code).toBe('ACCOUNT_CLOSED');

    const detail = await request(http()).get(`/api/v1/accounts/${acc.id}`).expect(200);
    expect(detail.body.status).toBe('closed');
    expect(await balanceOf(acc.id)).toBe('0.0000');
  });

  it('never allows a non-credit account below zero — even a serially designed one', async () => {
    const acc = await createAccount();
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '5.00' }).expect(201);

    // Withdraw exactly the balance — allowed.
    await request(http()).post(`/api/v1/accounts/${acc.id}/withdrawals`).send({ amount: '5.00' }).expect(201);
    expect(await balanceOf(acc.id)).toBe('0.0000');

    // Then any further 1 cent withdrawal must fail.
    const res = await request(http()).post(`/api/v1/accounts/${acc.id}/withdrawals`).send({ amount: '0.01' }).expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });
});