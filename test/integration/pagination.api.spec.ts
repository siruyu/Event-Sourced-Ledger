import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Cursor pagination [T-18]', () => {
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

  it('paginates GET /accounts by keyset cursor with no overlap', async () => {
    for (let i = 0; i < 5; i++) await createAccount();
    // The internal cash account is seeded in beforeEach, so 6 accounts exist.

    const page1 = await request(http()).get('/api/v1/accounts?limit=2').expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeDefined();

    const page2 = await request(http())
      .get(`/api/v1/accounts?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(2);

    const page3 = await request(http())
      .get(`/api/v1/accounts?limit=2&cursor=${encodeURIComponent(page2.body.nextCursor)}`)
      .expect(200);
    expect(page3.body.items).toHaveLength(2);
    expect(page3.body.nextCursor).toBeUndefined();

    const all = [...page1.body.items, ...page2.body.items, ...page3.body.items];
    const ids = all.map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain(page1.body.items[0].id);
  });

  it('paginates GET /accounts/:id/transactions in seq order', async () => {
    const acc = await createAccount();
    for (let i = 0; i < 4; i++) {
      await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(201);
    }

    const page1 = await request(http()).get(`/api/v1/accounts/${acc.id}/transactions?limit=3`).expect(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.items[0].type).toBe('deposit');
    expect(page1.body.nextCursor).toBeDefined();

    const page2 = await request(http())
      .get(`/api/v1/accounts/${acc.id}/transactions?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeUndefined();
    expect(page2.body.items[0].seq).toBeGreaterThan(page1.body.items[2].seq);
  });

  it('paginates GET /accounts/:id/audit with stable running balances', async () => {
    const acc = await createAccount();
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00' }).expect(201);
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '50.00' }).expect(201);
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '25.00' }).expect(201);

    const page1 = await request(http()).get(`/api/v1/accounts/${acc.id}/audit?limit=2`).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.items[1].runningBalance).toBe('150.0000');

    const page2 = await request(http())
      .get(`/api/v1/accounts/${acc.id}/audit?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].runningBalance).toBe('175.0000');
    expect(page2.body.nextCursor).toBeUndefined();
    expect(page1.body.balance).toBe('175.0000');
  });

  it('rejects an out-of-range limit', async () => {
    const res = await request(http()).get('/api/v1/accounts?limit=1000').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});