import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Multi-currency + FX [T-22]', () => {
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
    await internal.getInternalCashAccountId('USD');
  });

  const http = () => app.getHttpServer();

  async function createAccount(currency: string, overrides: Record<string, unknown> = {}) {
    const res = await request(http())
      .post('/api/v1/accounts')
      .send({ name: `Acct-${currency}`, currency, ...overrides })
      .expect(201);
    return res.body;
  }

  async function balanceOf(id: string): Promise<string> {
    const res = await request(http()).get(`/api/v1/accounts/${id}/balance`).expect(200);
    return res.body.balance;
  }

  it('deposits into a non-USD account use a per-currency vault', async () => {
    const eur = await createAccount('EUR');
    await request(http())
      .post(`/api/v1/accounts/${eur.id}/deposits`)
      .send({ amount: '500.00' })
      .expect(201);

    expect(await balanceOf(eur.id)).toBe('500.0000');

    const vault = await internal.getInternalCashAccountId('EUR');
    expect(await balanceOf(vault)).toBe('-500.0000');

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM accounts WHERE account_number = 'LE-INTERNAL-CASH-EUR'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('cross-currency transfer converts at the fx rate and records it', async () => {
    const usd = await createAccount('USD');
    const eur = await createAccount('EUR');
    await request(http())
      .post(`/api/v1/accounts/${usd.id}/deposits`)
      .send({ amount: '1000.00' })
      .expect(201);
    await request(http())
      .post(`/api/v1/accounts/${eur.id}/deposits`)
      .send({ amount: '500.00' })
      .expect(201);

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: usd.id, toAccountId: eur.id, amount: '200.00', fxRate: '0.85' })
      .expect(201);

    expect(res.body.type).toBe('transfer');
    expect(res.body.metadata.fxRate).toBe('0.85');
    expect(res.body.legs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: usd.id, currency: 'USD', amount: '200.0000' }),
        expect.objectContaining({ accountId: eur.id, currency: 'EUR', amount: '170.0000' }),
      ]),
    );

    expect(await balanceOf(usd.id)).toBe('800.0000');
    expect(await balanceOf(eur.id)).toBe('670.0000');
  });

  it('rounds converted amounts half-up to 4 decimal places', async () => {
    const usd = await createAccount('USD');
    const jpy = await createAccount('JPY');
    await request(http())
      .post(`/api/v1/accounts/${usd.id}/deposits`)
      .send({ amount: '10.00' })
      .expect(201);

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: usd.id, toAccountId: jpy.id, amount: '1.00', fxRate: '1.23456' })
      .expect(201);

    const toLeg = res.body.legs.find((l: { accountId: string }) => l.accountId === jpy.id);
    expect(toLeg.amount).toBe('1.2346');
  });

  it('rejects a cross-currency transfer without an fx rate', async () => {
    const usd = await createAccount('USD');
    const eur = await createAccount('EUR');
    await request(http())
      .post(`/api/v1/accounts/${usd.id}/deposits`)
      .send({ amount: '100.00' })
      .expect(201);

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: usd.id, toAccountId: eur.id, amount: '10.00' })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_TRANSACTION');
  });

  it('rejects an fx rate on a same-currency transfer', async () => {
    const a = await createAccount('USD');
    const b = await createAccount('USD');
    await request(http())
      .post(`/api/v1/accounts/${a.id}/deposits`)
      .send({ amount: '100.00' })
      .expect(201);

    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: a.id, toAccountId: b.id, amount: '10.00', fxRate: '1.0' })
      .expect(422);
    expect(res.body.error.code).toBe('INVALID_TRANSACTION');
  });

  it('shows the fx rate in the audit trail', async () => {
    const usd = await createAccount('USD');
    const eur = await createAccount('EUR');
    await request(http())
      .post(`/api/v1/accounts/${usd.id}/deposits`)
      .send({ amount: '100.00' })
      .expect(201);

    await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: usd.id, toAccountId: eur.id, amount: '50.00', fxRate: '0.9' })
      .expect(201);

    const trail = await request(http()).get(`/api/v1/accounts/${usd.id}/audit`).expect(200);
    const transferEvent = trail.body.items.find((e: { type: string }) => e.type === 'transfer');
    expect(transferEvent.fxRate).toBe('0.9');
    expect(transferEvent.explanation).toContain('@ fx 0.9');
  });

  it('whole-ledger reconciliation still passes after cross-currency activity', async () => {
    const usd = await createAccount('USD');
    const eur = await createAccount('EUR');
    await request(http())
      .post(`/api/v1/accounts/${usd.id}/deposits`)
      .send({ amount: '1000.00' })
      .expect(201);
    await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: usd.id, toAccountId: eur.id, amount: '300.00', fxRate: '0.8' })
      .expect(201);

    const report = await request(http()).get('/api/v1/reconciliation').expect(200);
    expect(report.body.passed).toBe(true);
    expect(report.body.issues).toEqual([]);
  });

  it('rejects a malformed fx rate with a validation error', async () => {
    const usd = await createAccount('USD');
    const eur = await createAccount('EUR');
    const res = await request(http())
      .post('/api/v1/transfers')
      .send({ fromAccountId: usd.id, toAccountId: eur.id, amount: '10.00', fxRate: '-1' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
