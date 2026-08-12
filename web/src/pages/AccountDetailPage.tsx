import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, ChevronLeft, Clock, Download, Landmark, Settings2, Shield, RotateCcw } from 'lucide-react';
import { downloadCsv, getAccount, getAudit, getBalance } from '@/api/accounts';
import { ApiError } from '@/api/client';
import type { AuditEvent } from '@/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner, useToast } from '@/components/ui';
import { MovementModal } from '@/components/forms/MovementModal';
import { TransferModal } from '@/components/forms/TransferModal';
import { ManageStatusModal } from '@/components/forms/ManageStatusModal';
import { ManageLimitModal } from '@/components/forms/ManageLimitModal';
import { VoidModal } from '@/components/forms/VoidModal';
import { BalanceChart } from '@/components/BalanceChart';
import { CopyButton } from '@/components/CopyButton';
import { StatusHistoryPanel } from '@/components/StatusHistoryPanel';
import { TransactionDetailModal } from '@/components/TransactionDetailModal';
import { formatAmount, formatDateTime, toLocalDateTimeInputValue } from '@/lib/format';

const AUDIT_PAGE = 50;

const typeTone: Record<string, string> = {
  deposit: 'border-emerald-500/50 text-emerald-500',
  withdrawal: 'border-rose-500/50 text-rose-500',
  transfer: 'border-brand-600 text-slate-200',
  reversal: 'border-amber-500/50 text-amber-500',
  fee: 'border-slate-600 text-slate-500',
};

function Dot({ className }: { className: string }) {
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 ring-4 ring-slate-900 ${className}`} aria-hidden="true" />;
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const [asOf, setAsOf] = useState<string>();
  const [modal, setModal] = useState<'deposit' | 'withdraw' | 'transfer' | 'status' | 'void' | 'limit' | null>(null);
  const [selectedTx, setSelectedTx] = useState<string>();
  const [auditCursor, setAuditCursor] = useState<string>();
  const [auditItems, setAuditItems] = useState<AuditEvent[]>([]);
  const toast = useToast();

  const onExport = (variant: 'transactions' | 'audit') => {
    void downloadCsv(id, variant, asOf).catch((err) => {
      toast('error', err instanceof ApiError ? err.message : 'CSV export failed');
    });
  };

  const accountQuery = useQuery({ queryKey: ['account', id], queryFn: () => getAccount(id) });
  const balanceQuery = useQuery({
    queryKey: ['account-balance', id, asOf ?? 'current'],
    queryFn: () => getBalance(id, asOf),
    enabled: Boolean(asOf),
  });
  const auditQuery = useQuery({
    queryKey: ['audit', id, asOf ?? 'all', auditCursor ?? 'start'],
    queryFn: () => getAudit(id, { asOf, cursor: auditCursor, limit: AUDIT_PAGE }),
  });

  // Append each loaded page to the accumulated timeline (deduped by seq).
  useEffect(() => {
    const page = auditQuery.data?.items ?? [];
    if (page.length === 0) return;
    setAuditItems((prev) => {
      const known = new Set(prev.map((i) => i.seq));
      const fresh = page.filter((i) => !known.has(i.seq));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, [auditQuery.data]);

  // Reset the accumulation when the account or point-in-time window changes.
  useEffect(() => {
    setAuditItems([]);
    setAuditCursor(undefined);
  }, [id, asOf]);

  const account = accountQuery.data;
  const displayBalance = asOf ? balanceQuery.data?.balance : account?.balance;

  const timeline = useMemo(() => {
    const max = Math.max(...auditItems.map((i) => i.seq), 0);
    return auditItems.map((item) => ({ item, isLast: item.seq === max }));
  }, [auditItems]);

  const hasMore = Boolean(auditQuery.data?.nextCursor);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center bg-brand-600 text-black">
          <Landmark className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="macro-title">{account?.name}</h1>
            <Badge tone={account?.status === 'active' ? 'success' : account?.status === 'frozen' ? 'danger' : 'neutral'}>
              {account?.status}
            </Badge>
            <Badge tone="brand">{account?.type}</Badge>
          </div>
          <p className="mt-0.5 flex items-center gap-1 font-mono text-sm text-slate-500">
            {account?.accountNumber}
            {account ? <CopyButton value={account.id} label="Account ID" /> : null}
          </p>
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
        <Button variant="secondary" onClick={() => setModal('limit')}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          Manage limit
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center gap-1.5 border-l-2 border-transparent pr-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 hover:border-brand-600 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Accounts
        </Link>
        <p className="tech-label">
          <span className="text-brand-600">{'<<<'}</span> RECORD {id.slice(0, 8).toUpperCase()} <span className="text-brand-600">{'>>>'}</span>
        </p>
      </div>

      <Card className="space-y-4 p-5">
        {header}
        {account.status !== 'active' ? (
          <div
            role="status"
            className={`border-l-4 px-4 py-3 font-mono text-sm uppercase tracking-wide ${
              account.status === 'frozen'
                ? 'border-amber-500 bg-amber-50 text-amber-500'
                : 'border-rose-600 bg-rose-50 text-rose-500'
            }`}
          >
            {account.status === 'frozen'
              ? 'This account is frozen — deposits, withdrawals, and transfers are blocked. Reads still work.'
              : 'This account is closed and can no longer move money. The record is retained for audit.'}
          </div>
        ) : null}
        <div className="border-t border-slate-700 pt-4">
          <p className="tech-label">
            {asOf ? 'Balance as of' : 'Current balance'}
          </p>
          <p className="mt-1 text-4xl font-semibold tabular tracking-tight text-slate-900 glow-readout">
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
                {'[clear]'}
              </button>
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="macro-section">Balance over time</h2>
        <div className="mt-3">
          {auditItems.length >= 2 ? (
            <BalanceChart events={auditItems} />
          ) : (
            <p className="border border-slate-600 bg-slate-50 px-3 py-4 text-center font-mono text-sm text-slate-500">
              Add at least two entries to see a balance-over-time chart.
            </p>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="macro-section">Audit trail</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => onExport('transactions')}>
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Transactions CSV</span>
                <span className="sm:hidden">CSV</span>
              </Button>
              <Button variant="secondary" onClick={() => onExport('audit')}>
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Audit CSV</span>
                <span className="sm:hidden">Audit</span>
              </Button>
            </div>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-600">
              <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span className="sr-only">Point in time</span>
              <input
                type="datetime-local"
                value={asOf ? toLocalDateTimeInputValue(asOf) : ''}
                onChange={(e) => setAsOf(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                className="border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
              />
            </label>
          </div>
        </div>

        <div className="mt-4">
          {auditQuery.isLoading && auditItems.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : auditQuery.isError ? (
            <ErrorState message="Could not load the audit trail." onRetry={() => void auditQuery.refetch()} />
          ) : timeline.length === 0 ? (
            <EmptyState title="No activity yet" hint="Deposits, withdrawals, and transfers will appear here as an event timeline." />
          ) : (
            <>
              <ol className="relative space-y-0">
                {timeline.map(({ item, isLast }) => (
                  <li key={item.seq} className="relative flex gap-3 pb-5">
                    {!isLast ? <span className="absolute left-[5px] top-4 h-full w-px bg-slate-500" aria-hidden="true" /> : null}
                    <Dot className={item.direction === 'debit' ? 'bg-emerald-500' : 'bg-rose-500'} />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setSelectedTx(item.transactionId)}
                        className="w-full px-1 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${typeTone[item.type] ?? typeTone.fee}`}>
                              {item.type}
                            </span>
                            <span className="text-xs text-slate-500">seq {item.seq}</span>
                            {item.fxRate ? <span className="text-xs text-slate-500">fx {item.fxRate}</span> : null}
                          </div>
                          <span className={`text-sm font-semibold tabular ${item.direction === 'debit' ? 'text-emerald-500 glow-green' : 'text-rose-500'}`}>
                            {item.effect}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-slate-400">{item.explanation}</p>
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
                          Running balance: <span className="font-medium tabular text-slate-700">{formatAmount(item.runningBalance, account.currency)}</span>
                        </p>
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              {hasMore ? (
                <div className="flex justify-center border-t border-slate-700 pt-4">
                  <Button variant="secondary" onClick={() => setAuditCursor(auditQuery.data?.nextCursor)} loading={auditQuery.isFetching}>
                    {'>>>'} Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {modal === 'deposit' ? <MovementModal accountId={account.id} currency={account.currency} kind="deposit" onClose={() => setModal(null)} /> : null}
      {modal === 'withdraw' ? <MovementModal accountId={account.id} currency={account.currency} kind="withdraw" onClose={() => setModal(null)} /> : null}
      {modal === 'transfer' ? <TransferModal defaultFromId={account.id} onClose={() => setModal(null)} /> : null}
      {modal === 'status' ? <ManageStatusModal account={account} onClose={() => setModal(null)} /> : null}
      {modal === 'limit' ? <ManageLimitModal account={account} onClose={() => setModal(null)} /> : null}
      {modal === 'void' ? <VoidModal accountId={account.id} onClose={() => setModal(null)} /> : null}
      {selectedTx ? <TransactionDetailModal transactionId={selectedTx} onClose={() => setSelectedTx(undefined)} /> : null}

      <StatusHistoryPanel accountId={account.id} />
    </div>
  );
}
