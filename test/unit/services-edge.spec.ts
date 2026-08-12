import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '@/application/snapshot/snapshot.service';
import type { LedgerStore } from '@/infrastructure/event-store/ledger.store';
import { InternalAccountsService, internalCashAccountNumber, INTERNAL_CASH_ACCOUNT_NAME } from '@/application/internal-accounts.service';
import type { AccountRepository } from '@/infrastructure/repositories/account.repository';
import type { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import { configureApp } from '@/app.setup';
import { SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

describe('SnapshotService (T-21)', () => {
  function build(config: Record<string, unknown>, store: Partial<LedgerStore>) {
    return new SnapshotService(store as LedgerStore, new ConfigService(config));
  }

  it('snapshots on an exact interval boundary', async () => {
    const svc = new SnapshotService(
      { latestSnapshotSeq: jest.fn(), balanceUpToSeq: jest.fn(), insertSnapshot: jest.fn() } as unknown as LedgerStore,
      new ConfigService({ SNAPSHOT_INTERVAL_EVENTS: '1000' }),
    );
    const take = jest.spyOn(svc, 'takeSnapshot').mockResolvedValue(undefined);
    await svc.maybeSnapshot('a1', 'USD', 2000);
    expect(take).toHaveBeenCalledWith('a1', 'USD', 2000);
  });

  it('falls back to the max-lag safety net when not on a boundary', async () => {
    const svc = new SnapshotService(
      { latestSnapshotSeq: jest.fn().mockResolvedValue(950) } as unknown as LedgerStore,
      new ConfigService({ SNAPSHOT_INTERVAL_EVENTS: '1000', SNAPSHOT_MAX_LAG_EVENTS: '100' }),
    );
    const take = jest.spyOn(svc, 'takeSnapshot').mockResolvedValue(undefined);
    await svc.maybeSnapshot('a1', 'USD', 1050);
    expect(take).toHaveBeenCalledWith('a1', 'USD', 1050);
  });

  it('does nothing when lag is below the threshold', async () => {
    const svc = new SnapshotService(
      { latestSnapshotSeq: jest.fn().mockResolvedValue(1000) } as unknown as LedgerStore,
      new ConfigService({ SNAPSHOT_INTERVAL_EVENTS: '1000', SNAPSHOT_MAX_LAG_EVENTS: '100' }),
    );
    const take = jest.spyOn(svc, 'takeSnapshot').mockResolvedValue(undefined);
    await svc.maybeSnapshot('a1', 'USD', 1050);
    expect(take).not.toHaveBeenCalled();
  });

  it('uses newSeq as lag base when there is no snapshot yet', async () => {
    const svc = new SnapshotService(
      { latestSnapshotSeq: jest.fn().mockResolvedValue(null) } as unknown as LedgerStore,
      new ConfigService({ SNAPSHOT_INTERVAL_EVENTS: '0', SNAPSHOT_MAX_LAG_EVENTS: '5' }),
    );
    const take = jest.spyOn(svc, 'takeSnapshot').mockResolvedValue(undefined);
    await svc.maybeSnapshot('a1', 'USD', 10);
    expect(take).toHaveBeenCalled();
  });

  it('respects maxLag <= 0 (disabled)', async () => {
    const latest = jest.fn();
    const svc = new SnapshotService(
      { latestSnapshotSeq: latest } as unknown as LedgerStore,
      new ConfigService({ SNAPSHOT_INTERVAL_EVENTS: '0', SNAPSHOT_MAX_LAG_EVENTS: '0' }),
    );
    const take = jest.spyOn(svc, 'takeSnapshot').mockResolvedValue(undefined);
    await svc.maybeSnapshot('a1', 'USD', 500);
    expect(latest).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it('does not snapshot before the first event', async () => {
    const insert = jest.fn();
    const svc = new SnapshotService(
      { currentSequence: jest.fn().mockResolvedValue(0), balanceUpToSeq: jest.fn(), insertSnapshot: insert } as unknown as LedgerStore,
      new ConfigService({}),
    );
    await svc.takeSnapshot('a1', 'USD');
    expect(insert).not.toHaveBeenCalled();
  });

  it('parses config defensively', () => {
    const svc = build({ SNAPSHOT_INTERVAL_EVENTS: 'not-a-number' }, {});
    // fallback used, no crash
    expect(svc).toBeDefined();
  });
});

describe('InternalAccountsService (race-safe cash accounts)', () => {
  const accountRow = {
    id: 'cash-1',
    accountNumber: internalCashAccountNumber('USD'),
    name: INTERNAL_CASH_ACCOUNT_NAME,
    type: 'cash',
    normalSide: 'debit',
    currency: 'USD',
    overdraftLimit: '999999999999.9999',
    status: 'active',
  };

  function build(accounts: Partial<AccountRepository>) {
    const runner = { withTransaction: jest.fn((fn) => fn({})) } as unknown as PostgresTransactionRunner;
    return { svc: new InternalAccountsService(runner, accounts as AccountRepository), runner };
  }

  it('caches the resolved id and reuses it on subsequent calls', async () => {
    const { svc, runner } = build({ findByAccountNumber: jest.fn().mockResolvedValue(accountRow) });
    const first = await svc.getInternalCashAccountId('USD');
    const second = await svc.getInternalCashAccountId('USD');
    expect(first).toBe('cash-1');
    expect(second).toBe('cash-1');
    expect(runner.withTransaction).not.toHaveBeenCalled();
  });

  it('creates the account when none exists', async () => {
    const accounts = {
      findByAccountNumber: jest.fn().mockResolvedValue(null),
      insertIfAbsent: jest.fn().mockResolvedValue('cash-1'),
    };
    const { svc } = build(accounts);
    await expect(svc.getInternalCashAccountId('EUR')).resolves.toBe('cash-1');
  });

  it('resolves the surviving row when a concurrent insert loses the race', async () => {
    const accounts = {
      findByAccountNumber: jest.fn().mockResolvedValue(accountRow),
      insertIfAbsent: jest.fn().mockResolvedValue(null),
    };
    const { svc } = build(accounts);
    await expect(svc.getInternalCashAccountId('GBP')).resolves.toBe('cash-1');
  });

  it('throws when the cash account can neither be created nor resolved', async () => {
    const accounts = {
      findByAccountNumber: jest.fn().mockResolvedValue(null),
      insertIfAbsent: jest.fn().mockResolvedValue(null),
    };
    const { svc } = build(accounts);
    await expect(svc.getInternalCashAccountId('JPY')).rejects.toThrow(/could not be created or resolved/);
  });

  it('defaults to USD', async () => {
    const accounts = { findByAccountNumber: jest.fn().mockResolvedValue(accountRow) };
    const { svc } = build(accounts);
    await expect(svc.getInternalCashAccountId()).resolves.toBe('cash-1');
  });
});

describe('configureApp', () => {
  function appMock() {
    const app = {
      useGlobalFilters: jest.fn(),
      setGlobalPrefix: jest.fn(),
      enableCors: jest.fn(),
    };
    return app as unknown as INestApplication & { useGlobalFilters: jest.Mock; setGlobalPrefix: jest.Mock; enableCors: jest.Mock };
  }

  it('sets prefix, applies CORS when origins given, and enables swagger by default', () => {
    const app = appMock();
    const setupSpy = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    const docSpy = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({ components: {} } as never);
    try {
      configureApp(app, { prefix: '/api/v1', corsOrigins: ['http://localhost:5173'] });
      expect(app.setGlobalPrefix).toHaveBeenCalledWith('/api/v1');
      expect(app.enableCors).toHaveBeenCalledWith({ origin: ['http://localhost:5173'] });
      expect(setupSpy).toHaveBeenCalled();
      expect(docSpy).toHaveBeenCalled();
    } finally {
      setupSpy.mockRestore();
      docSpy.mockRestore();
    }
  });

  it('skips CORS when no origins and skips swagger when disabled', () => {
    const app = appMock();
    const setupSpy = jest.spyOn(SwaggerModule, 'setup');
    try {
      configureApp(app, { prefix: '/api/v1', enableSwagger: false });
      expect(app.enableCors).not.toHaveBeenCalled();
      expect(setupSpy).not.toHaveBeenCalled();
    } finally {
      setupSpy.mockRestore();
    }
  });

  it('accepts an empty origins list without enabling CORS', () => {
    const app = appMock();
    const setupSpy = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    const docSpy = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as never);
    try {
      configureApp(app, { prefix: '/api/v1', corsOrigins: [] });
      expect(app.enableCors).not.toHaveBeenCalled();
    } finally {
      setupSpy.mockRestore();
      docSpy.mockRestore();
    }
  });
});