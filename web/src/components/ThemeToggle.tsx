import { ScanLine, MonitorCheck } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useTheme();

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={next === 'dark' ? 'Enable CRT overlay' : 'Disable CRT overlay'}
      title={next === 'dark' ? 'CRT overlay: off' : 'CRT overlay: on'}
      className={`flex min-h-[44px] w-full items-center gap-3 border-l-2 border-transparent px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:border-slate-600 hover:bg-slate-100/40 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${className}`}
    >
      {theme === 'dark' ? (
        <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <MonitorCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      {theme === 'dark' ? 'CRT overlay: on' : 'CRT overlay: off'}
    </button>
  );
}
