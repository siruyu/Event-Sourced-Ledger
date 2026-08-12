import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/* ---------------------------------- Spinner --------------------------------- */

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 border border-current border-t-transparent align-middle animate-spin ${className}`}
    />
  );
}

/* ---------------------------------- Button --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40',
  secondary:
    'bg-transparent text-slate-200 border border-slate-500 hover:border-brand-600 hover:text-brand-600 disabled:opacity-40',
  ghost: 'text-slate-500 hover:text-brand-600 disabled:opacity-40',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({ variant = 'primary', loading, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 border px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------- Badge ---------------------------------- */

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'danger' | 'brand' }) {
  const tones = {
    neutral: 'text-slate-400 border-slate-600',
    success: 'text-emerald-500 border-emerald-500/60 glow-green',
    danger: 'text-rose-500 border-rose-500/60 glow-red',
    brand: 'text-slate-100 border-brand-600',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${tones[tone]}`}>
      <span
        className={`h-1.5 w-1.5 flex-none ${tone === 'success' ? 'led led-ok' : tone === 'danger' ? 'led led-alert' : 'bg-current opacity-60'}`}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

/* ------------------------------- Form controls ------------------------------ */

const fieldBase =
  'min-h-[44px] w-full border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40 disabled:cursor-not-allowed disabled:opacity-50';

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="tech-label block text-slate-500">
        {'['} {label} {'>'}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p className="flex items-center gap-1.5 font-mono text-xs font-medium uppercase tracking-wide text-rose-500" role="alert">
          <span className="led led-alert" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldBase} ${className}`} {...rest} />;
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldBase} ${className}`} {...rest} />;
}

/* ---------------------------------- Card ------------------------------------ */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`t-panel ${className}`}>{children}</div>;
}

/* ---------------------------------- PageHeader ------------------------------ */

export function PageHeader({ index, title, meta }: { index: string; title: string; meta?: string }) {
  return (
    <header className="border-b border-slate-700 pb-4">
      <p className="tech-label">
        <span className="text-brand-600">{'<<<'}</span> CHANNEL {index} <span className="text-brand-600">{'>>>'}</span>
        {meta ? <span className="ml-3 text-slate-600">{meta}</span> : null}
      </p>
      <h1 className="macro-title mt-2">{title}</h1>
      <div className="hazard-stripe mt-4" aria-hidden="true" />
    </header>
  );
}

/* ---------------------------------- Modal ----------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/80" onClick={onClose} aria-hidden="true" />
      <div className="ascii-frame relative z-10 w-full max-w-md p-6 animate-fade-in sm:max-w-lg">
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-slate-700 pb-3">
          <h2 className="macro-section flex items-center gap-2">
            <span className="text-brand-600">{'>'}</span>
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex h-10 w-10 items-center justify-center border border-slate-600 font-mono text-sm text-slate-400 transition-colors hover:border-brand-600 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            X
          </button>
        </div>
        <div>{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------ Empty / error ------------------------------- */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="t-panel-strong crosshair flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
        <span className="text-brand-600">[ </span>
        {title}
        <span className="text-brand-600"> ]</span>
      </p>
      {hint ? <p className="max-w-sm text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="ascii-frame crosshair flex flex-col items-center justify-center gap-3 border-rose-600/60 px-6 py-10 text-center">
      <p className="led led-alert" aria-hidden="true" />
      <p className="font-mono text-sm uppercase tracking-wide text-rose-500">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ---------------------------------- Toasts ---------------------------------- */

interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<{ push: (tone: 'success' | 'error', message: string) => void }>({
  push: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((tone: 'success' | 'error', message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`ascii-frame pointer-events-auto flex items-start gap-3 p-3 ${
              t.tone === 'success' ? 'border-emerald-500/60' : 'border-rose-500/60'
            }`}
          >
            <span className={`mt-1 h-2 w-2 flex-none ${t.tone === 'success' ? 'led led-ok' : 'led led-alert'}`} aria-hidden="true" />
            <p className="font-mono text-xs uppercase tracking-wide text-slate-300">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext).push;
}
