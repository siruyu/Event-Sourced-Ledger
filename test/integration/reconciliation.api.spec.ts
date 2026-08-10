import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('Financial reconciliation [T-20]', () => {
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
    const res = await request(http())
      .post('/api/v1/accounts')
      .send({ name: 'Acct', ...overrides })
      .expect(201);
    return res.body;
  }

  async function runReport() {
    const res = await request(http()).get('/api/v1/reconciliation').expect(200);
    return res.body;
  }

  it('passes on a ledger of healthy activity', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await request(http()).post(`/api/v1/accounts/${a.id}/deposits`).send({ amount: '1000.00' }).expect(201);
    await request(http()).post('/api/v1/transfers').send({ fromAccountId: a.id, toAccountId: b.id, amount: '250.00' }).expect(201);
    await request(http()).post(`/api/v1/accounts/${a.id}/withdrawals`).send({ amount: '50.00' }).expect(201);

    const report = await runReport();
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.checked.transactions).toBe(3); // deposit + transfer + withdrawal
    expect(report.checked.accounts).toBeGreaterThanOrEqual(3); // 2 + internal cash
  });

  it('reports unbalanced transactions injected outside the domain layer', async () => {
    const acc = await createAccount();
    const txId = randomUUID();
    await pool.query(
      `INSERT INTO transactions (id, type, status, metadata, posted_at)
       VALUES ($1, 'transfer', 'posted', '{}', now())`,
      [txId],
    );
    // One leg only — debits != credits — directly in the DB.
    await pool.query(
      `INSERT INTO entries (transaction_id, account_id, seq, direction, amount, currency)
       SELECT $1, id, current_sequence + 1, 'debit', '100.0000', currency FROM accounts WHERE id = $2`,
      [txId, acc.id],
    );

    const report = await runReport();
    expect(report.passed).toBe(false);
    const finding = report.issues.find(
      (i: { check: string }) => i.check === 'unbalanced_transaction',
    );
    expect(finding).toBeDefined();
    expect(finding.transactionId).toBe(txId);
  });

  it('reports an account left below its overdraft limit by direct SQL', async () => {
    const acc = await createAccount({ overdraftLimit: '0' });
    const txId = randomUUID();
    await pool.query(
      `INSERT INTO transactions (id, type, status, metadata, posted_at)
       VALUES ($1, 'transfer', 'posted', '{}', now())`,
      [txId],
    );
    await pool.query(
      `INSERT INTO entries (transaction_id, account_id, seq, direction, amount, currency)
       SELECT $1, id, current_sequence + 1, 'credit', '50.0000', currency FROM accounts WHERE id = $2`,
      [txId, acc.id],
    );

    const report = await runReport();
    expect(report.passed).toBe(false);
    const finding = report.issues.find(
      (i: { check: string }) => i.check === 'below_overdraft_limit',
    );
    expect(finding).toBeDefined();
  });

  it('reports sequence gaps or duplicates', async () => {
    const acc2 = await createAccount({ name: 'Other' });
    // Insert an entry at seq 2 while seq 1 does not exist — a gap that the
    // application layer can never produce, injected directly via SQL.
    const tx = randomUUID();
    await pool.query(
      `INSERT INTO transactions (id, type, status, metadata, posted_at) VALUES ($1, 'transfer', 'posted', '{}', now())`,
      [tx],
    );
    await pool.query(
      `INSERT INTO entries (transaction_id, account_id, seq, direction, amount, currency) VALUES ($1, $2, 2, 'debit', '10.0000', 'USD')`,
      [tx, acc2.id],
    );

    const report = await runReport();
    expect(report.passed).toBe(false);
    const finding = report.issues.find(
      (i: { check: string }) => i.check === 'sequence_gap_or_duplicate',
    );
    expect(finding).toBeDefined();
    expect(finding.accountId).toBe(acc2.id);
  });
});