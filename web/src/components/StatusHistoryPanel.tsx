import { useQuery } from '@tanstack/react-query';
import { getStatusHistory } from '@/api/accounts';
import { Badge, Card, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

type BadgeTone = 'neutral' | 'success' | 'danger' | 'brand';

const EVENT_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  account_opened: { label: 'Opened', tone: 'success' },
  account_frozen: { label: 'Frozen', tone: 'danger' },
  account_reactivated: { label: 'Reactivated', tone: 'success' },
  account_closed: { label: 'Closed', tone: 'neutral' },
  limit_changed: { label: 'Limit changed', tone: 'brand' },
};

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  frozen: 'danger',
  closed: 'neutral',
};

export function StatusHistoryPanel({ accountId }: { accountId: string }) {
  const query = useQuery({
    queryKey: ['status-history', accountId],
    queryFn: () => getStatusHistory(accountId),
  });

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">Account lifecycle</h2>
      <p className="mt-0.5 text-xs text-slate-500">Rebuilt by replaying the account event stream.</p>

      <div className="mt-4">
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : query.isError ? (
          <ErrorState message="Could not load status history." onRetry={() => void query.refetch()} />
        ) : !query.data || query.data.length === 0 ? (
          <EmptyState title="No lifecycle events" hint="Opening the account records the first event here." />
        ) : (
          <ol className="relative space-y-0">
            {query.data.map((event, i) => {
              const meta = EVENT_LABELS[event.type] ?? { label: event.type, tone: 'neutral' as BadgeTone };
              const isLast = i === query.data.length - 1;
              return (
                <li key={event.seq} className="relative flex gap-3 pb-4">
                  {!isLast ? <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200" aria-hidden="true" /> : null}
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white ${
                    event.resultingStatus === 'frozen'
                      ? 'bg-rose-400'
                      : event.resultingStatus === 'closed'
                        ? 'bg-slate-300'
                        : 'bg-emerald-500'
                  }`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                      <p className="text-sm font-medium text-slate-900">{meta.label}</p>
                      <Badge tone={STATUS_TONE[event.resultingStatus] ?? 'neutral'}>{event.resultingStatus}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(event.createdAt)}
                      {event.reason ? <> · {event.reason}</> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}