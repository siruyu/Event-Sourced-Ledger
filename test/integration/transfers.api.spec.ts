import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Transfers [T-07]', () => {
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

  async function fund(accountId: string, amount: string) {
    await request(http()).post(`/api/v1/accounts/${accountId}/deposits`).send({ amount }).expect(201);
  }

  async function balanceOf(id: string): Promise<string> {
    const res = await request(http()).get(`/api/v1/accounts/${id}/balance`).expect(200);
    return res.body.balance;
  }

  it('transfers money atomically: source decreases, destination increases', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await fund(from.id, '1000.00');

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: from.id, toAccountId: to.id, amount: '250.00' })
      .expect(201);

    expect(res.body.type).toBe('transfer');
    expect(await balanceOf(from.id)).toBe('750.0000');
    expect(await balanceOf(to.id)).toBe('250.0000');
  });

  it('posts exactly two legs that sum to zero', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await fund(from.id, '500.00');

    const created = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: from.id, toAccountId: to.id, amount: '123.45' })
      .expect(201);

    const detail = await request(http())
      .get(`/api/v1/transactions/${created.body.id}`)
      .expect(200);

    expect(detail.body.legs).toHaveLength(2);
    const leg = detail.body.legs.find((l: { accountId: string }) => l.accountId === from.id);
    expect(leg.direction).toBe('credit');
    expect(leg.amount).toBe('123.4500');

    const debits = detail.body.legs
      .filter((l: { direction: string }) => l.direction === 'debit')
      .reduce((s: number, l: { amount: string }) => s + Number(l.amount), 0);
    const credits = detail.body.legs
      .filter((l: { direction: string }) => l.direction === 'credit')
      .reduce((s: number, l: { amount: string }) => s + Number(l.amount), 0);
    expect(debits).toBe(credits);
  });

  it('rejects an overdraft on the source atomically — neither account changes', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await fund(from.id, '100.00');

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: from.id, toAccountId: to.id, amount: '100.01' })
      .expect(422);

    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(from.id)).toBe('100.0000');
    expect(await balanceOf(to.id)).toBe('0.0000');
  });

  it('rejects invalid amounts with a 400 validation error', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await fund(from.id, '100.00');

    for (const amount of ['0.00', '-1.00', '1.12345', 'abc']) {
      const res = await request(http())
        .post('/api/v1/transfers')
        .send({ fromAccountId: from.id, toAccountId: to.id, amount });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a transfer to the same account', async () => {
    const acc = await createAccount();
    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: acc.id, toAccountId: acc.id, amount: '10.00' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a transfer to a non-existent destination atomically', async () => {
    const from = await createAccount();
    await fund(from.id, '500.00');

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({
        fromAccountId: from.id,
        toAccountId: '00000000-0000-4000-8000-000000000000',
        amount: '10.00',
      })
      .expect(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await balanceOf(from.id)).toBe('500.0000');
  });

  it('moves money correctly across multiple sequential transfers', async () => {
    const a = await createAccount();
    const b = await createAccount();
    const c = await createAccount();
    await fund(a.id, '1000.00');

    await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '200.00' }).expect(201);
    await request(http()).post('/api/v1/transfers').send({ fromAccountId: b.id, toAccountId: c.id, amount: '150.50' }).expect(201);

    expect(await balanceOf(a.id)).toBe('800.0000');
    expect(await balanceOf(b.id)).toBe('49.5000');
    expect(await balanceOf(c.id)).toBe('150.5000');
  });
});