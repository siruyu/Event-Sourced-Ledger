import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Account lifecycle: freeze & close (T-17)', () => {
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

  function setStatus(id: string, status: string) {
    return request(http()).patch(`/api/v1/accounts/${id}/status`).send({ status });
  }

  it('freezing blocks mutations, unfreezing restores them', async () => {
    const acc = await createAccount();
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '100.00' }).expect(201);

    await setStatus(acc.id, 'frozen').expect(200);
    const frozen = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(409);
    expect(frozen.body.error.code).toBe('ACCOUNT_FROZEN');

    await setStatus(acc.id, 'active').expect(200);
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(201);
    const balance = await request(http()).get(`/api/v1/accounts/${acc.id}/balance`).expect(200);
    expect(balance.body.balance).toBe('110.0000');
  });

  it('rejects closing an account with a non-zero balance', async () => {
    const acc = await createAccount();
    await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '50.00' }).expect(201);

    const res = await setStatus(acc.id, 'closed');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TRANSACTION');
  });

  it('closes a zero-balance account, then rejects all writes permanently', async () => {
    const acc = await createAccount();
    await setStatus(acc.id, 'closed').expect(200);

    const res = await request(http()).post(`/api/v1/accounts/${acc.id}/deposits`).send({ amount: '10.00' }).expect(409);
    expect(res.body.error.code).toBe('ACCOUNT_CLOSED');

    const reopen = await setStatus(acc.id, 'active').expect(422);
    expect(reopen.body.error.code).toBe('INVALID_TRANSACTION');
  });

  it('records a status history in account metadata', async () => {
    const acc = await createAccount();
    await setStatus(acc.id, 'frozen').expect(200);

    const detail = await request(http()).get(`/api/v1/accounts/${acc.id}`).expect(200);
    const history = detail.body.metadata.statusHistory;
    expect(history).toBeDefined();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: 'active', to: 'frozen' });
  });

  it('rejects invalid status values', async () => {
    const acc = await createAccount();
    const res = await request(http())
      .patch(`/api/v1/accounts/${acc.id}/status`)
      .send({ status: 'banana' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});