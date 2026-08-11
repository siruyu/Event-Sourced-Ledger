import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('CSV export [T-25]', () => {
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
    const res = await request(http()).post('/api/v1/accounts').send({ name: 'CSV Acct', ...overrides }).expect(201);
    return res.body;
  }

  it('exports transactions as a well-formed CSV with decimal-string amounts', async () => {
    const a = await createAccount();
    const b = await createAccount({ name: 'Counterpart' });
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '1000.00' }).expect(201);
    await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '250.00' }).expect(201);

    const res = await request(http()).get(`/api/v1/accounts/${a.id}/transactions.csv`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const body = res.text;
    expect(body.startsWith('\uFEFF')).toBe(true); // UTF-8 BOM for Excel
    const lines = body.slice(1).trim().split('\r\n');
    expect(lines[0]).toContain('transaction_id');
    expect(lines[0]).toContain('running_balance');
    expect(lines).toHaveLength(3); // header + deposit + transfer
    expect(body).toContain('1000.0000');
    expect(body).toContain('250.0000');
    expect(body).toContain('deposit');
    expect(body).toContain('transfer');
  });

  it('exports the audit trail with detail columns', async () => {
    const a = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '75.50' }).expect(201);

    const res = await request(http()).get(`/api/v1/accounts/${a.id}/audit.csv`).expect(200);
    const lines = res.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toContain('seq');
    expect(lines[0]).toContain('explanation');
    expect(lines).toHaveLength(2);
    expect(res.text).toContain('Deposit +75.5000');
    expect(res.text).toContain('75.5000');
  });

  it('respects as_of when exporting', async () => {
    const a = await createAccount();
    const t = new Date(Date.now() - 60_000);
    const first = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '100.00' }).expect(201);
    await pool.query('UPDATE transactions SET posted_at = $1 WHERE id = $2', [new Date(t.getTime() - 60_000), first.body.id]);
    const second = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '50.00' }).expect(201);
    await pool.query('UPDATE transactions SET posted_at = $1 WHERE id = $2', [t, second.body.id]);

    const res = await request(http())
      .get(`/api/v1/accounts/${a.id}/transactions.csv?as_of=${encodeURIComponent(new Date(t.getTime() - 1000).toISOString())}`)
      .expect(200);
    const lines = res.text.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2); // header + only the first deposit
  });

  it('returns 404 for an unknown account', async () => {
    const res = await request(http())
      .get('/api/v1/accounts/00000000-0000-4000-8000-000000000000/transactions.csv')
      .expect(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});