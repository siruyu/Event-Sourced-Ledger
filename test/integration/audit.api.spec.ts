import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Audit trail [T-10]', () => {
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
    const res = await request(http()).post('/api/v1/accounts').send({ name: 'Acct', ...overrides }).expect(201);
    return res.body;
  }

  async function audit(id: string, asOf?: string) {
    const url = asOf ? `/api/v1/accounts/${id}/audit?as_of=${encodeURIComponent(asOf)}` : `/api/v1/accounts/${id}/audit`;
    const res = await request(http()).get(url).expect(200);
    return res.body;
  }

  it('reconstructs an account history in sequence order with running balances', async () => {
    const a = await createAccount({ name: 'Alicia' });
    const b = await createAccount({ name: 'Bodhi' });

    const dep = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '1000.00' }).expect(201);
    await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '250.00' }).expect(201);
    await request(http()).post(`/api/v1/accounts/${a.id}/withdrawals`).send({ amount: '100.00' }).expect(201);

    const trail = await audit(a.id);

    expect(trail.balance).toBe('650.0000');
    expect(trail.items).toHaveLength(3);

    expect(trail.items[0]).toMatchObject({
      seq: 1,
      type: 'deposit',
      direction: 'debit',
      amount: '1000.0000',
      effect: '+1000.0000',
      runningBalance: '1000.0000',
    });
    expect(trail.items[0].explanation).toContain('Deposit +1000.0000');
    expect(trail.items[0].counterparty.name).toBe('Bank Vault');

    expect(trail.items[1]).toMatchObject({
      seq: 2,
      type: 'transfer',
      direction: 'credit',
      effect: '-250.0000',
      runningBalance: '750.0000',
    });
    expect(trail.items[1].counterparty.accountNumber).toBe(b.accountNumber);
    expect(trail.items[1].explanation).toContain('Transfer -250.0000');

    expect(trail.items[2]).toMatchObject({
      seq: 3,
      type: 'withdrawal',
      direction: 'credit',
      effect: '-100.0000',
      runningBalance: '650.0000',
    });

    // The trail must fully explain how the balance was reached.
    expect(trail.items[2].runningBalance).toBe(trail.balance);
    expect(dep.body.id).toBeDefined();
  });

  it('shows the same transaction from the recipient side as a debit', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '500.00' }).expect(201);
    await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '200.00' }).expect(201);

    const bTrail = await audit(b.id);
    expect(bTrail.items).toHaveLength(1);
    expect(bTrail.items[0]).toMatchObject({
      type: 'transfer',
      direction: 'debit',
      amount: '200.0000',
      effect: '+200.0000',
      runningBalance: '200.0000',
    });
    expect(bTrail.items[0].counterparty.accountNumber).toBe(a.accountNumber);
    expect(bTrail.balance).toBe('200.0000');
  });

  it('trims the trail at as_of and reports the balance as of that time', async () => {
    const a = await createAccount();
    const t = new Date(Date.now() - 60_000);

    const d1 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '500.00' }).expect(201);
    await pool.query('UPDATE entries SET created_at = $1 WHERE transaction_id = $2', [new Date(t.getTime() - 10_000), d1.body.id]);

    const d2 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '300.00' }).expect(201);
    await pool.query('UPDATE entries SET created_at = $1 WHERE transaction_id = $2', [t, d2.body.id]);

    const trail = await audit(a.id, new Date(t.getTime() + 1).toISOString());
    expect(trail.items).toHaveLength(2);
    expect(trail.balance).toBe('800.0000');
    expect(trail.asOf).toBeDefined();
  });

  it('returns an empty trail for a fresh account with zero balance', async () => {
    const a = await createAccount();
    const trail = await audit(a.id);
    expect(trail.items).toEqual([]);
    expect(trail.balance).toBe('0.0000');
  });

  it('returns 404 for an unknown account', async () => {
    const res = await request(http())
      .get('/api/v1/accounts/00000000-0000-4000-8000-000000000000/audit')
      .expect(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});