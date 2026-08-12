import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`${label}: ${value}`}
      title={`${label}: ${value}`}
      className="inline-flex min-h-[44px] items-center gap-1.5 border border-transparent px-2 font-mono text-xs font-medium uppercase tracking-wide text-slate-500 transition-colors hover:border-brand-600 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {copied ? 'Copied' : label}
    </button>
  );
}
