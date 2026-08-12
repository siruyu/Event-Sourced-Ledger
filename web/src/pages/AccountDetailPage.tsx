import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, ChevronLeft, Clock, Download, Landmark, Shield, RotateCcw } from 'lucide-react';
import { downloadCsv, getAccount, getAudit, getBalance } from '@/api/accounts';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { MovementModal } from '@/components/forms/MovementModal';
import { TransferModal } from '@/components/forms/TransferModal';
import { ManageStatusModal } from '@/components/forms/ManageStatusModal';
import { VoidModal } from '@/components/forms/VoidModal';
import { StatusHistoryPanel } from '@/components/StatusHistoryPanel';
import { formatAmount, formatDateTime, toLocalDateTimeInputValue } from '@/lib/format';

const typeTone: Record<string, string> = {
  deposit: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  withdrawal: 'bg-rose-50 text-rose-700 ring-rose-200',
  transfer: 'bg-brand-50 text-brand-700 ring-brand-200',
  reversal: 'bg-amber-50 text-amber-700 ring-amber-200',
  fee: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function Dot({ className }: { className: string }) {
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white ${className}`} aria-hidden="true" />;
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const [asOf, setAsOf] = useState<string>();
  const [modal, setModal] = useState<'deposit' | 'withdraw' | 'transfer' | 'status' | 'void' | null>(null);

  const accountQuery = useQuery({ queryKey: ['account', id], queryFn: () => getAccount(id) });
  const balanceQuery = useQuery({
    queryKey: ['account-balance', id, asOf ?? 'current'],
    queryFn: () => getBalance(id, asOf),
    enabled: Boolean(asOf),
  });
  const auditQuery = useQuery({
    queryKey: ['audit', id, asOf ?? 'all'],
    queryFn: () => getAudit(id, { asOf, limit: 100 }),
  });

  const account = accountQuery.data;
  const displayBalance = asOf ? balanceQuery.data?.balance : account?.balance;

  const timeline = useMemo(() => {
    const items = auditQuery.data?.items ?? [];
    const max = Math.max(...items.map((i) => i.seq), 0);
    return items.map((item) => ({ item, isLast: item.seq === max }));
  }, [auditQuery.data]);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Landmark className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{account?.name}</h1>
            <Badge tone={account?.status === 'active' ? 'success' : account?.status === 'frozen' ? 'danger' : 'neutral'}>
              {account?.status}
            </Badge>
            <Badge tone="brand">{account?.type}</Badge>
          </div>
          <p className="mt-0.5 font-mono text-sm text-slate-500">{account?.accountNumber}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" onClick={() => setModal('deposit')} disabled={account?.status !== 'active'}>
          <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
          Deposit
        </Button>
        <Button variant="secondary" onClick={() => setModal('withdraw')} disabled={account?.status !== 'active'}>
          <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />
          Withdraw
        </Button>
        <Button variant="secondary" onClick={() => setModal('transfer')} disabled={account?.status !== 'active'}>
          <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
          Transfer
        </Button>
        <Button variant="secondary" onClick={() => setModal('void')}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Void
        </Button>
        <Button variant="secondary" onClick={() => setModal('status')}>
          <Shield className="h-4 w-4" aria-hidden="true" />
          Manage status
        </Button>
      </div>
    </div>
  );

  if (accountQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (accountQuery.isError || !account) {
    return <ErrorState message="Could not load this account." onRetry={() => void accountQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Accounts
      </Link>

      <Card className="space-y-4 p-5">
        {header}
        {account.status !== 'active' ? (
          <div
            role="status"
            className={`rounded-lg px-4 py-3 text-sm ${
              account.status === 'frozen'
                ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
                : 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
            }`}
          >
            {account.status === 'frozen'
              ? 'This account is frozen — deposits, withdrawals, and transfers are blocked. Reads still work.'
              : 'This account is closed and can no longer move money. The record is retained for audit.'}
          </div>
        ) : null}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {asOf ? 'Balance as of' : 'Current balance'}
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
            {asOf && balanceQuery.isLoading ? (
              <Spinner className="inline h-6 w-6 text-brand-600" />
            ) : (
              formatAmount(displayBalance ?? '0.0000', account.currency)
            )}
          </p>
          {asOf ? (
            <p className="mt-1 text-xs text-slate-500">
              {formatDateTime(asOf)}
              <button
                type="button"
                onClick={() => setAsOf(undefined)}
                className="ml-2 font-semibold text-brand-600 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                Clear
              </button>
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900">Audit trail</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => downloadCsv(account.id, 'transactions', asOf)}>
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Transactions CSV</span>
                <span className="sm:hidden">CSV</span>
              </Button>
              <Button variant="secondary" onClick={() => downloadCsv(account.id, 'audit', asOf)}>
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Audit CSV</span>
                <span className="sm:hidden">Audit</span>
              </Button>
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-600">
              <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span className="sr-only">Point in time</span>
              <input
                type="datetime-local"
                value={asOf ? toLocalDateTimeInputValue(asOf) : ''}
                onChange={(e) => setAsOf(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
          </div>
        </div>

        <div className="mt-4">
          {auditQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : auditQuery.isError ? (
            <ErrorState message="Could not load the audit trail." onRetry={() => void auditQuery.refetch()} />
          ) : timeline.length === 0 ? (
            <EmptyState title="No activity yet" hint="Deposits, withdrawals, and transfers will appear here as an event timeline." />
          ) : (
            <ol className="relative space-y-0">
              {timeline.map(({ item, isLast }) => (
                <li key={item.seq} className="relative flex gap-3 pb-5">
                  {!isLast ? <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" aria-hidden="true" /> : null}
                  <Dot className={item.direction === 'debit' ? 'bg-emerald-500' : 'bg-rose-400'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${typeTone[item.type] ?? typeTone.fee}`}>
                          {item.type}
                        </span>
                        <span className="text-xs text-slate-400">seq {item.seq}</span>
                        {item.fxRate ? <span className="text-xs text-slate-400">fx {item.fxRate}</span> : null}
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${item.direction === 'debit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {item.effect}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700">{item.explanation}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                      {item.reference ? (
                        <span className="font-mono">ref: {item.reference}</span>
                      ) : null}
                      {item.counterparty ? (
                        <span>
                          Counterparty: {item.counterparty.name} ({item.counterparty.accountNumber})
                        </span>
                      ) : null}
                      <span>{formatDateTime(item.postedAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Running balance: <span className="font-medium tabular-nums text-slate-700">{formatAmount(item.runningBalance, account.currency)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      {modal === 'deposit' ? <MovementModal accountId={account.id} currency={account.currency} kind="deposit" onClose={() => setModal(null)} /> : null}
      {modal === 'withdraw' ? <MovementModal accountId={account.id} currency={account.currency} kind="withdraw" onClose={() => setModal(null)} /> : null}
      {modal === 'transfer' ? <TransferModal defaultFromId={account.id} onClose={() => setModal(null)} /> : null}
      {modal === 'status' ? <ManageStatusModal account={account} onClose={() => setModal(null)} /> : null}
      {modal === 'void' ? <VoidModal accountId={account.id} onClose={() => setModal(null)} /> : null}

      <StatusHistoryPanel accountId={account.id} />
    </div>
  );
}
