import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { AccountEventService } from '@/application/account-events/account-event.service';
import { getTestPool, resetDatabase } from './db';

describe('Account-aggregate event sourcing [T-26]', () => {
  let app: INestApplication;
  let pool: Pool;
  let internal: InternalAccountsService;
  let accountEvents: AccountEventService;

  beforeAll(async () => {
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    internal = app.get(InternalAccountsService);
    accountEvents = app.get(AccountEventService);
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
    const res = await request(http()).post('/api/v1/accounts').send({ name: 'Evented', ...overrides }).expect(201);
    return res.body;
  }

  async function setStatus(id: string, status: string) {
    return request(http()).patch(`/api/v1/accounts/${id}/status`).send({ status }).expect(200);
  }

  it('book-ends account creation with an account_opened event', async () => {
    const acc = await createAccount({ currency: 'USD' });
    const { rows } = await pool.query('SELECT type FROM account_events WHERE account_id = $1 ORDER BY seq', [acc.id]);
    expect(rows.map((r) => r.type)).toEqual(['account_opened']);
  });

  it('appends lifecycle events for freeze/reactivate/close and rebuilds the aggregate by replay', async () => {
    const acc = await createAccount();

    await setStatus(acc.id, 'frozen');
    await setStatus(acc.id, 'active');
    await setStatus(acc.id, 'closed');

    const projection = await accountEvents.projectAccount(acc.id);
    expect(projection.status).toBe('closed');
    expect(projection.statusHistory.map((h) => h.type)).toEqual([
      'account_opened',
      'account_frozen',
      'account_reactivated',
      'account_closed',
    ]);
    expect(projection.statusHistory.find((h) => h.type === 'account_frozen')?.resultingStatus).toBe('frozen');

    // The stored accounts row is the projection of the stream.
    const stored = await pool.query('SELECT status FROM accounts WHERE id = $1', [acc.id]);
    expect(stored.rows[0].status).toBe('closed');
    expect(projection.status).toBe(stored.rows[0].status);
  });

  it('rebuilds overdraft limit and status from the stream only', async () => {
    const acc = await createAccount({ overdraftLimit: '250.00' });

    const projection = await accountEvents.projectAccount(acc.id);
    expect(projection.status).toBe('active');
    expect(projection.overdraftLimit).toBe('250.0000');
  });

  it('exposes status history over the API with reasons', async () => {
    const acc = await createAccount();
    await setStatus(acc.id, 'frozen');
    await setStatus(acc.id, 'active');

    const res = await request(http()).get(`/api/v1/accounts/${acc.id}/status-history`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((e: { type: string }) => e.type)).toEqual([
      'account_opened',
      'account_frozen',
      'account_reactivated',
    ]);
    expect(res.body[1].reason).toContain('status changed');
    expect(res.body[1].resultingStatus).toBe('frozen');
    expect(typeof res.body[0].createdAt).toBe('string');
  });

  it('keeps events immutable with a version field for forward-compat', async () => {
    const acc = await createAccount();
    const { rows } = await pool.query('SELECT version, payload FROM account_events WHERE account_id = $1', [acc.id]);
    expect(rows[0].version).toBe(1);
    expect(rows[0].payload.name).toBe('Evented');
  });

  it('returns 404 for an unknown account status history', async () => {
    const res = await request(http())
      .get('/api/v1/accounts/00000000-0000-4000-8000-000000000000/status-history')
      .expect(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('status transitions remain idempotent (no duplicate events)', async () => {
    const acc = await createAccount();
    await setStatus(acc.id, 'frozen');
    await setStatus(acc.id, 'frozen'); // no-op

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM account_events WHERE account_id = $1', [acc.id]);
    expect(rows[0].n).toBe(2); // opened + frozen only
  });
});
