import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { getTestPool, resetDatabase } from './db';

describe('Accounts API [T-05]', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  function createAccount(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/accounts').send(body);
  }

  it('creates an account and reports a zero derived balance', async () => {
    const res = await createAccount({ name: 'Alicia Checking' }).expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.accountNumber).toMatch(/^LE-/);
    expect(res.body).toMatchObject({
      name: 'Alicia Checking',
      type: 'checking',
      normalSide: 'debit',
      currency: 'USD',
      overdraftLimit: '0.0000',
      status: 'active',
      balance: '0.0000',
    });
  });

  it('derives default normalSide from the account type', async () => {
    const credit = await createAccount({ name: 'AMEX', type: 'credit_card' }).expect(201);
    expect(credit.body.normalSide).toBe('credit');

    const checking = await createAccount({ name: 'Checking', type: 'checking' }).expect(201);
    expect(checking.body.normalSide).toBe('debit');
  });

  it('lists accounts with their derived balances', async () => {
    await createAccount({ name: 'A' }).expect(201);
    await createAccount({ name: 'B', currency: 'EUR' }).expect(201);

    const res = await request(app.getHttpServer()).get('/api/v1/accounts').expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((a: { name: string }) => a.name)).toEqual(['A', 'B']);
    for (const account of res.body) {
      expect(account.balance).toBe('0.0000');
    }
  });

  it('gets a single account by id', async () => {
    const created = await createAccount({ name: 'Alicia', currency: 'GBP' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${created.body.id}`)
      .expect(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.name).toBe('Alicia');
    expect(res.body.currency).toBe('GBP');
    expect(res.body.balance).toBe('0.0000');
  });

  it('returns 404 with the documented error shape for an unknown account', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/accounts/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect(res.body).toEqual({
      error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' },
    });
  });

  it('returns a 400 validation error for an invalid body (structured, no stack)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .send({ name: '' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });

  it('rejects a malformed uuid param cleanly', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/accounts/not-a-uuid')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a negative overdraft limit', async () => {
    await createAccount({ name: 'Bad', overdraftLimit: '-5.00' }).expect(400);
  });

  it('reports a balance of zero for a fresh account via the balance endpoint', async () => {
    const created = await createAccount({ name: 'A' }).expect(201);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${created.body.id}/balance`)
      .expect(200);
    expect(res.body).toEqual({ balance: '0.0000', currency: 'USD' });
  });
});