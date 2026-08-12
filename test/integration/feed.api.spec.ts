import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Global feed + statement range + limit change [T-27]', () => {
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

  async function createAccount(name: string) {
    const res = await request(http()).post('/api/v1/accounts').send({ name, currency: 'USD' }).expect(201);
    return res.body;
  }

  describe('GET /transactions (global feed)', () => {
    it('lists transactions newest-first with full legs', async () => {
      const a = await createAccount('Feed A');
      const b = await createAccount('Feed B');
      await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '300.00', reference: 'feed-1' }).expect(201);
      await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '100.00' }).expect(201);

      const res = await request(http()).get('/api/v1/transactions').expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(2);
      // transfer is newest (deposit first)
      expect(res.body.items[0].type).toBe('transfer');
      expect(res.body.items[0].legs).toHaveLength(2);
      expect(res.body.items[1].type).toBe('deposit');
      const amountStrings = res.body.items.flatMap((t: { legs: { amount: string }[] }) => t.legs.map((l) => l.amount));
      expect(amountStrings.every((amt: string) => !/[eE]/.test(amt))).toBe(true); // no scientific notation
    });

    it('supports reference lookup on the same route', async () => {
      const a = await createAccount('Ref A');
      const tx = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '50.00', reference: 'unique-ref-xyz' }).expect(201);

      const byRef = await request(http()).get(`/api/v1/transactions?reference=unique-ref-xyz`).expect(200);
      expect(byRef.body.id).toBe(tx.body.id);
    });

    it('filters by type and status', async () => {
      const a = await createAccount('Filter A');
      const b = await createAccount('Filter B');
      await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '100.00' }).expect(201);
      const transfer = await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '10.00' }).expect(201);

      const transfersOnly = await request(http()).get('/api/v1/transactions?type=transfer').expect(200);
      expect(transfersOnly.body.items).toHaveLength(1);
      expect(transfersOnly.body.items[0].type).toBe('transfer');

      const postedOnly = await request(http()).get('/api/v1/transactions?status=posted').expect(200);
      expect(postedOnly.body.items).toHaveLength(2);

      await request(http()).post(`/api/v1/transactions/${transfer.body.id}/void`).send({}).expect(201);
      const voided = await request(http()).get('/api/v1/transactions?status=void').expect(200);
      expect(voided.body.items.length).toBeGreaterThanOrEqual(1);
      expect(voided.body.items[0].status).toBe('void');
    });

    it('paginates without overlap', async () => {
      const a = await createAccount('Page A');
      for (let i = 0; i < 5; i++) {
        await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '10.00', reference: `page-ref-${i}` }).expect(201);
      }
      const page1 = await request(http()).get('/api/v1/transactions?limit=2').expect(200);
      expect(page1.body.items).toHaveLength(2);
      const ids1 = new Set(page1.body.items.map((t: { id: string }) => t.id));
      const page2 = await request(http()).get(`/api/v1/transactions?limit=2&cursor=${page1.body.nextCursor}`).expect(200);
      const ids2 = new Set(page2.body.items.map((t: { id: string }) => t.id));
      expect(ids2.size).toBeGreaterThan(0);
      expect([...ids2].every((id) => !ids1.has(id))).toBe(true);
    });

    it('rejects an invalid status filter', async () => {
      const res = await request(http()).get('/api/v1/transactions?status=bogus').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('audit statement range (from/to)', () => {
    it('restricts the trail to the window and reports the balance at `to`', async () => {
      const a = await createAccount('Range A');
      const t1 = new Date(Date.now() - 120_000);
      const t2 = new Date(Date.now() - 60_000);
      const t3 = new Date(Date.now());

      const d1 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '100.00' }).expect(201);
      const d2 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '200.00' }).expect(201);
      const d3 = await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '300.00' }).expect(201);
      await pool.query('UPDATE transactions SET posted_at = $1 WHERE id = $2', [t1, d1.body.id]);
      await pool.query('UPDATE transactions SET posted_at = $1 WHERE id = $2', [t2, d2.body.id]);
      await pool.query('UPDATE transactions SET posted_at = $1 WHERE id = $2', [t3, d3.body.id]);

      const window = await request(http())
        .get(`/api/v1/accounts/${a.id}/audit?from=${encodeURIComponent(new Date(t1.getTime() + 1000).toISOString())}&to=${encodeURIComponent(new Date(t2.getTime() + 1000).toISOString())}`)
        .expect(200);
      expect(window.body.items).toHaveLength(1);
      expect(window.body.items[0].amount).toBe('200.0000');
      expect(window.body.balance).toBe('300.0000'); // 100 + 200, as of `to`
      expect(window.body.items[0].runningBalance).toBe('300.0000'); // includes the pre-window deposit
    });
  });

  describe('PATCH /accounts/:id/limit', () => {
    it('updates the overdraft limit and records a limit_changed event', async () => {
      const a = await createAccount('Limit A');
      const res = await request(http()).patch(`/api/v1/accounts/${a.id}/limit`).send({ overdraftLimit: '500.00' }).expect(200);
      expect(res.body.overdraftLimit).toBe('500.0000');

      const { rows } = await pool.query(
        "SELECT type, payload FROM account_events WHERE account_id = $1 AND type = 'limit_changed' ORDER BY seq DESC LIMIT 1",
        [a.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].payload.to).toBe('500.0000');
    });

    it('rejects changing the limit of a closed account', async () => {
      const a = await createAccount('Closed Limit');
      const b = await createAccount('Closed Limit 2');
      // drain A to zero first, then close
      await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '1.00' }).expect(201);
      await request(http()).post(`/api/v1/accounts/${a.id}/withdrawals`).send({ amount: '1.00' }).expect(201);
      await request(http()).patch(`/api/v1/accounts/${a.id}/status`).send({ status: 'closed' }).expect(200);
      void b;

      const res = await request(http()).patch(`/api/v1/accounts/${a.id}/limit`).send({ overdraftLimit: '100.00' }).expect(409);
      expect(res.body.error.code).toBe('ACCOUNT_CLOSED');
    });

    it('rejects an invalid limit', async () => {
      const a = await createAccount('Bad Limit');
      const res = await request(http()).patch(`/api/v1/accounts/${a.id}/limit`).send({ overdraftLimit: '-5.00' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});