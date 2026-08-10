import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Observability — request tracing [T-13]', () => {
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

  it('echoes a client-supplied X-Request-Id on the response', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/accounts')
      .set('X-Request-Id', 'my-trace-42')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('my-trace-42');
  });

  it('generates and returns an X-Request-Id when none is supplied', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/accounts')
      .expect(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(String(res.headers['x-request-id']).length).toBeGreaterThan(0);
  });

  it('money movements complete normally with structured logging enabled', async () => {
    const acc = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .send({ name: 'Traced' })
      .set('X-Request-Id', 'trace-money')
      .expect(201);

    const deposit = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${acc.body.id}/deposits`)
      .send({ amount: '25.00' })
      .set('X-Request-Id', 'trace-money')
      .expect(201);

    expect(deposit.body.id).toBeDefined();
    expect(resToId(deposit)).toBe('trace-money');
  });

  function resToId(res: { headers: Record<string, unknown> }): string {
    return String(res.headers['x-request-id']);
  }
});