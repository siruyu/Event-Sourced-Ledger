/** Formats a ledger amount string ("250.0000") with thousands separators and a
 * currency code, trimming insignificant trailing zeros (min 2 decimals). */
export function formatAmount(value: string, currency: string): string {
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const [int, frac = '0000'] = abs.split('.');
  const fracTrimmed = frac.replace(/0+$/, '').padEnd(2, '0') || '00';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${currency} ${grouped}.${fracTrimmed}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function toLocalDateTimeInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
