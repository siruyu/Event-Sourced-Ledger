import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, ShieldCheck } from 'lucide-react';
import { downloadCsv, getAudit, getReconciliation, listAccounts } from '@/api/accounts';
import type { AuditView } from '@/api/types';
import { ApiError } from '@/api/client';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import { formatAmount, formatDateTime, toLocalDateTimeInputValue } from '@/lib/format';

export function ReportsPage() {
  const toast = useToast();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const accountsQuery = useQuery({ queryKey: ['accounts', { limit: 100 }], queryFn: () => listAccounts({ limit: 100 }) });
  const accounts = accountsQuery.data?.items ?? [];

  const enabled = Boolean(accountId);
  const range = useMemo(() => {
    const r: { from?: string; to?: string } = {};
    if (from) r.from = new Date(from).toISOString();
    if (to) r.to = new Date(to).toISOString();
    return r;
  }, [from, to]);

  const statementQuery = useQuery({
    queryKey: ['statement', accountId, range],
    queryFn: () => getAudit(accountId, { ...range, limit: 100 }),
    enabled,
  });

  const account = accounts.find((a) => a.id === accountId);
  const statement = statementQuery.data;

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  return (
    <div className="space-y-6">
      <PageHeader index="04" title="Reports" meta="STATEMENTS // RECONCILIATION" />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            <span className="tech-label text-slate-500">Account</span>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-64" aria-label="Account">
              {accounts.length === 0 ? <option value="">No accounts</option> : null}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.accountNumber}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            <span className="tech-label text-slate-500">From</span>
            <input
              type="datetime-local"
              value={from ? toLocalDateTimeInputValue(from) : ''}
              onChange={(e) => setFrom(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className="min-h-[44px] border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            <span className="tech-label text-slate-500">To</span>
            <input
              type="datetime-local"
              value={to ? toLocalDateTimeInputValue(to) : ''}
              onChange={(e) => setTo(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className="min-h-[44px] border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
            />
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => window.print()} disabled={!statement}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void downloadCsv(accountId, 'audit', range.to)
                  .catch((err) => toast('error', err instanceof ApiError ? err.message : 'CSV export failed'));
              }}
              disabled={!enabled}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-700 pb-3">
          <div>
            <h2 className="macro-section">{account?.name ?? 'Statement'}</h2>
            <p className="font-mono text-xs text-slate-500">{account?.accountNumber}</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-600">
              {from ? `From ${formatDateTime(from)}` : 'From inception'}
              {to ? ` · to ${formatDateTime(to)}` : ''}
            </p>
            {statement ? (
              <p className="font-semibold tabular text-slate-900 glow-readout">
                Balance: {formatAmount(statement.balance, account?.currency ?? '')}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          {!enabled ? (
            <EmptyState title="Pick an account" hint="Choose an account to generate its statement." />
          ) : statementQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : statementQuery.isError ? (
            <ErrorState message="Could not load the statement." onRetry={() => void statementQuery.refetch()} />
          ) : statement && statement.items.length === 0 ? (
            <EmptyState title="No entries in range" hint="Widen the date range or choose another account." />
          ) : statement ? (
            <StatementTable statement={statement} currency={account?.currency ?? ''} />
          ) : null}
        </div>
      </Card>

      <ReconciliationCard />
    </div>
  );
}

function StatementTable({ statement, currency }: { statement: AuditView; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-sm">
        <thead>
          <tr className="border-b border-slate-500 text-left text-[10px] uppercase tracking-[0.1em] text-slate-500">
            <th className="py-2 pr-3 font-semibold">Date</th>
            <th className="py-2 pr-3 font-semibold">Type</th>
            <th className="py-2 pr-3 text-right font-semibold">Amount</th>
            <th className="py-2 pr-3 text-right font-semibold">Running</th>
            <th className="py-2 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {statement.items.map((e) => (
            <tr key={e.seq} className="hover:bg-slate-50">
              <td className="whitespace-nowrap py-2 pr-3 tabular text-slate-500">{formatDateTime(e.postedAt)}</td>
              <td className="py-2 pr-3 text-xs uppercase tracking-wide text-slate-400">{e.type}</td>
              <td className={`whitespace-nowrap py-2 pr-3 text-right tabular font-medium ${e.direction === 'debit' ? 'text-emerald-500 glow-green' : 'text-rose-500'}`}>
                {formatAmount(e.amount, currency)}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-right tabular text-slate-900">{formatAmount(e.runningBalance, currency)}</td>
              <td className="max-w-[22rem] truncate py-2 text-xs text-slate-500" title={e.explanation}>
                {e.explanation}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconciliationCard() {
  const query = useQuery({ queryKey: ['reconciliation'], queryFn: getReconciliation, refetchInterval: 60_000 });
  const report = query.data;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 macro-section">
          <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden="true" />
          Ledger reconciliation
        </h2>
        <Button variant="secondary" onClick={() => void query.refetch()} loading={query.isFetching}>
          Re-run check
        </Button>
      </div>

      <div className="mt-3">
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : query.isError ? (
          <ErrorState message="Could not run the reconciliation." onRetry={() => void query.refetch()} />
        ) : report ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge tone={report.passed ? 'success' : 'danger'}>
                {report.passed ? 'Passed' : 'Issues found'}
              </Badge>
              <span className="font-mono text-xs text-slate-500">
                Checked {report.checked.transactions} transactions · {report.checked.accounts} accounts
              </span>
              <span className="text-xs text-slate-500">{formatDateTime(report.generatedAt)}</span>
            </div>
            {report.issues.length === 0 ? (
              <p className="border border-emerald-500/50 bg-emerald-50 px-3 py-2 text-sm text-emerald-500">
                <span className="led led-ok mr-2" aria-hidden="true" />
                Zero unbalanced transactions and zero diverged balances.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 border border-rose-600/50">
                {report.issues.map((issue, i) => (
                  <li key={i} className="px-3 py-2 font-mono text-xs text-rose-500">
                    <span className="uppercase tracking-wide">{issue.type}</span> — {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}