import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Deposits & withdrawals [T-06]', () => {
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

  async function createAccount(body: Record<string, unknown> = { name: 'Alicia' }) {
    return request(http()).post('/api/v1/accounts').send(body).expect(201);
  }

  async function balanceOf(id: string): Promise<string> {
    const res = await request(http()).get(`/api/v1/accounts/${id}/balance`).expect(200);
    return res.body.balance;
  }

  it('deposits credit the account balance', async () => {
    const { body: account } = await createAccount();
    const res = await request(http())
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .send({ amount: '1000.00' })
      .expect(201);

    expect(res.body.type).toBe('deposit');
    expect(res.body.status).toBe('posted');
    expect(await balanceOf(account.id)).toBe('1000.0000');
  });

  it('records a balanced double-entry transaction with a real cash leg', async () => {
    const { body: account } = await createAccount();
    const created = await request(http())
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .send({ amount: '250.00' })
      .expect(201);

    const detail = await request(http())
      .get(`/api/v1/transactions/${created.body.id}`)
      .expect(200);
    expect(detail.body.legs).toHaveLength(2);
    expect(detail.body.legs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: account.id, direction: 'debit', amount: '250.0000' }),
        expect.objectContaining({ direction: 'credit', amount: '250.0000' }),
      ]),
    );

    const debits = detail.body.legs.filter((l: { direction: string }) => l.direction === 'debit');
    const credits = detail.body.legs.filter((l: { direction: string }) => l.direction === 'credit');
    const sum = (legs: { amount: string }[]) =>
      legs.reduce((s: number, l: { amount: string }) => s + Number(l.amount), 0);
    expect(sum(debits)).toBe(sum(credits));
  });

  it('withdrawals debit the account balance', async () => {
    const { body: account } = await createAccount();
    await request(http()).post(`/api/v1/accounts/${account.id}/deposits`).send({ amount: '500.00' }).expect(201);

    const res = await request(http())
      .post(`/api/v1/accounts/${account.id}/withdrawals`)
      .send({ amount: '150.50' })
      .expect(201);
    expect(res.body.type).toBe('withdrawal');
    expect(await balanceOf(account.id)).toBe('349.5000');
  });

  it('rejects an overdraft atomically — balances are untouched (INSUFFICIENT_FUNDS)', async () => {
    const { body: account } = await createAccount();
    await request(http()).post(`/api/v1/accounts/${account.id}/deposits`).send({ amount: '100.00' }).expect(201);

    const res = await request(http())
      .post(`/api/v1/accounts/${account.id}/withdrawals`)
      .send({ amount: '100.01' })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(account.id)).toBe('100.0000');
  });

  it('supports overdraft down to an approved limit', async () => {
    const { body: account } = await createAccount({ name: 'Overdraft', overdraftLimit: '500.00' });
    const res = await request(http())
      .post(`/api/v1/accounts/${account.id}/withdrawals`)
      .send({ amount: '300.00' })
      .expect(201);
    expect(res.body.type).toBe('withdrawal');
    expect(await balanceOf(account.id)).toBe('-300.0000');
  });

  it('rejects zero and negative amounts with INVALID_AMOUNT / validation errors', async () => {
    const { body: account } = await createAccount();

    await request(http())
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .send({ amount: '0.00' })
      .expect(400);

    await request(http())
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .send({ amount: '-5.00' })
      .expect(400);

    await request(http())
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .send({ amount: '1.12345' })
      .expect(400);
  });

  it('returns 404 when depositing to an unknown account', async () => {
    const res = await request(http())
      .post('/api/v1/accounts/00000000-0000-4000-8000-000000000000/deposits')
      .send({ amount: '10.00' })
      .expect(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});