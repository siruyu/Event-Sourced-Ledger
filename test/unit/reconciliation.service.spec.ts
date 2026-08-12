import { ReconciliationService } from '@/application/reconciliation/reconciliation.service';

function poolMock(rowsByCall: unknown[][]) {
  const query = jest.fn();
  for (const rows of rowsByCall) {
    query.mockResolvedValueOnce({ rows });
  }
  return { query };
}

describe('ReconciliationService (T-20) — edge paths', () => {
  it('flags an unbalanced transaction and below-overdraft accounts', async () => {
    const pool = poolMock([
      [{ transactionId: 't1', debits: '10.0000', credits: '9.0000' }], // unbalanced
      [], // cross-currency (none)
      [], // sequence (none)
      [{ accountId: 'a1', balance: '-60.0000', overdraftLimit: '50.0000' }], // overdraft
      [{ n: 1 }], // tx count
      [{ n: 2 }], // account count
    ]);
    const svc = new ReconciliationService(pool as never);
    const report = await svc.run();

    expect(report.passed).toBe(false);
    expect(report.issues.map((i) => i.check)).toEqual(['unbalanced_transaction', 'below_overdraft_limit']);
    expect(report.checked).toEqual({ transactions: 1, accounts: 2 });
  });

  it('reports a clear report with no issues', async () => {
    const pool = poolMock([[], [], [], [], [{ n: 0 }], [{ n: 0 }]]);
    const svc = new ReconciliationService(pool as never);
    const report = await svc.run();
    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('flags cross-currency transactions missing fx metadata or legs', async () => {
    function rows(meta: Record<string, unknown> | null, legs: unknown[]) {
      const first = { transactionId: 'c1', metadata: meta, direction: 'debit', amount: '1.0000', currency: 'USD' };
      return [first, ...legs.map((l) => ({ transactionId: 'c1', metadata: meta, ...(l as object) }))];
    }

    const noMeta = poolMock([
      [],
      rows(null, []),
      [],
      [],
      [{ n: 1 }],
      [{ n: 1 }],
    ]);
    const noMetaReport = await new ReconciliationService(noMeta as never).run();
    expect(noMetaReport.issues.some((i) => String(i.details.reason).includes('missing fx_rate'))).toBe(true);

    const noLeg = poolMock([
      [],
      rows({ fxRate: '0.85', fromCurrency: 'USD', toCurrency: 'EUR' }, []),
      [],
      [],
      [{ n: 1 }],
      [{ n: 1 }],
    ]);
    const noLegReport = await new ReconciliationService(noLeg as never).run();
    expect(noLegReport.issues.some((i) => String(i.details.reason).includes('missing a base/quote leg'))).toBe(true);

    const mismatch = poolMock([
      [],
      rows(
        { fxRate: '0.85', fromCurrency: 'USD', toCurrency: 'EUR' },
        [
          { direction: 'debit', amount: '1.0000', currency: 'USD' },
          { direction: 'credit', amount: '9.0000', currency: 'EUR' },
        ],
      ),
      [],
      [],
      [{ n: 1 }],
      [{ n: 1 }],
    ]);
    const mismatchReport = await new ReconciliationService(mismatch as never).run();
    expect(mismatchReport.issues.some((i) => i.check === 'unbalanced_transaction')).toBe(true);

    const match = poolMock([
      [],
      rows(
        { fxRate: '0.85', fromCurrency: 'USD', toCurrency: 'EUR' },
        [
          { direction: 'debit', amount: '1.0000', currency: 'USD' },
          { direction: 'credit', amount: '0.8500', currency: 'EUR' },
        ],
      ),
      [],
      [],
      [{ n: 1 }],
      [{ n: 1 }],
    ]);
    const matchReport = await new ReconciliationService(match as never).run();
    expect(matchReport.passed).toBe(true);
  });

  it('flags sequence gaps or duplicates', async () => {
    const pool = poolMock([
      [],
      [],
      [{ accountId: 'a1', count: 5, maxSeq: 7, distinctSeq: 4 }],
      [],
      [{ n: 1 }],
      [{ n: 1 }],
    ]);
    const report = await new ReconciliationService(pool as never).run();
    expect(report.issues).toEqual([
      { check: 'sequence_gap_or_duplicate', accountId: 'a1', details: { count: 5, maxSeq: 7, distinctSeq: 4 } },
    ]);
  });
});