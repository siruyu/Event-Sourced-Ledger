import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Internal cash account creation (race-safe) [T-06 hardening]', () => {
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
  });

  const http = () => app.getHttpServer();

  async function createAccount() {
    const res = await request(http()).post('/api/v1/accounts').send({ name: 'Acct' }).expect(201);
    return res.body;
  }

  it('handles many concurrent first-ever deposits without a 500 on the internal cash account', async () => {
    // No internal account is pre-seeded: every request races to create it.
    const account = await createAccount();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(http())
          .post(`/api/v1/accounts/${account.id}/deposits`)
          .send({ amount: '10.00', reference: `race-${i}` }),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM accounts WHERE account_number = 'LE-INTERNAL-CASH'`,
    );
    expect(rows[0].n).toBe(1);

    const balance = await request(http()).get(`/api/v1/accounts/${account.id}/balance`).expect(200);
    expect(balance.body.balance).toBe('80.0000');
  });

  it('resolves to the same internal account id across cache clears', async () => {
    const a = await internal.getInternalCashAccountId();
    internal.clearCache();
    const b = await internal.getInternalCashAccountId();
    expect(a).toBe(b);
  });
});
