import { useMemo } from 'react';
import type { AuditEvent } from '@/api/types';

function toNumber(value: string): number {
  return Number(value.replace(/,/g, ''));
}

/** Compact SVG line chart of an account's balance history (running balance per event). */
export function BalanceChart({ events, height = 160 }: { events: AuditEvent[]; height?: number }) {
  const path = useMemo(() => {
    if (events.length < 2) return null;
    const width = 600;
    const pad = 8;
    const values = events.map((e) => toNumber(e.runningBalance));
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;
    const stepX = (width - pad * 2) / (events.length - 1);
    const pts = events.map((e, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - (toNumber(e.runningBalance) - min) / range);
      return { x, y, e };
    });
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return { d, pts };
  }, [events, height]);

  if (events.length < 2) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
        Add at least two entries to see a balance-over-time chart.
      </p>
    );
  }

  const first = events[0].runningBalance;
  const last = events[events.length - 1].runningBalance;
  const summary = `Balance history from ${first} to ${last} across ${events.length} entries.`;

  return (
    <figure>
      <svg
        viewBox={`0 0 600 ${height}`}
        role="img"
        aria-label={summary}
        className="h-auto w-full max-h-56"
        preserveAspectRatio="none"
      >
        <title>{summary}</title>
        <line x1="0" y1={height - 8} x2="600" y2={height - 8} stroke="currentColor" className="text-slate-200" strokeWidth="1" />
        {path?.pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="currentColor" className="text-brand-500" />
        ))}
        <path d={path?.d} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-600" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
