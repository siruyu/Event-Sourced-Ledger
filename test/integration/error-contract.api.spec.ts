import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Error contract [T-11]', () => {
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
    const res = await request(http()).post('/api/v1/accounts').send({ name: 'A' }).expect(201);
    return res.body;
  }

  it('every error response matches the { error: { code, message, details? } } shape', async () => {
    const bad = await request(http()).post('/api/v1/accounts').send({ name: '' }).expect(400);
    expect(bad.body.error).toBeDefined();
    expect(typeof bad.body.error.code).toBe('string');
    expect(typeof bad.body.error.message).toBe('string');

    const missing = await request(http())
      .get('/api/v1/accounts/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('maps INSUFFICIENT_FUNDS to 422', async () => {
    const acc = await createAccount();
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '5.00' }).expect(201);
    const res = await request(http())
      .post(`/api/v1/accounts/${acc.id}/withdrawals`)
      .send({ amount: '6.00' })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('resolves a duplicate idempotency reference to the original transaction (no error, no double charge)', async () => {
    const acc = await createAccount();
    const first = await request(http())
      .post(`/api/v1/accounts/${acc.id}/deposits`)
      .send({ amount: '50.00', reference: 'payroll-2026-01' })
      .expect(201);

    const second = await request(http())
      .post(`/api/v1/accounts/${acc.id}/deposits`)
      .send({ amount: '50.00', reference: 'payroll-2026-01' })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);

    const balance = await request(http()).get(`/api/v1/accounts/${acc.id}/balance`).expect(200);
    expect(balance.body.balance).toBe('50.0000');
  });

  it('maps malformed request bodies to 400 VALIDATION_ERROR with details', async () => {
    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: 'nope', toAccountId: 'nope', amount: '-1' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('normalizes unknown routes to the same error shape', async () => {
    const res = await request(http()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('HTTP_404');
  });

  it('never leaks stack traces in production-shaped responses', async () => {
    const res = await request(http()).post('/api/v1/accounts').send({ name: '' }).expect(400);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('at ');
    expect(serialized).not.toContain('node_modules');
  });
});