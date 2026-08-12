import { useEffect, useState } from 'react';
import { KeyRound, Moon, Ruler, Wallet } from 'lucide-react';
import { getApiKey, setApiKey } from '@/api/client';
import { Card, PageHeader, Select, useToast } from '@/components/ui';
import { useTheme, useSystemTheme, type Theme } from '@/lib/theme';
import { getSettings, setSettings } from '@/lib/settings';
import { CopyButton } from '@/components/CopyButton';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF'];

export function SettingsPage() {
  const toast = useToast();
  const [, setTheme] = useTheme();
  const [, followSystem] = useSystemTheme();
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [settings, setSettingsState] = useState(() => getSettings());
  const [themeMode, setThemeMode] = useState<string>(() => getThemeMode());

  useEffect(() => {
    setApiKey(apiKey);
  }, [apiKey]);

  const onTheme = (value: string) => {
    setThemeMode(value);
    if (value === 'system') {
      followSystem();
      toast('success', 'CRT overlay follows system');
    } else {
      setTheme(value as Theme);
      toast('success', `${value === 'dark' ? 'CRT overlay enabled' : 'CRT overlay off'}`);
    }
  };

  const onCurrency = (value: string) => {
    setSettingsState((s) => ({ ...s, displayCurrency: value }));
    setSettings({ displayCurrency: value });
    toast('success', 'Display currency updated');
  };

  const onPageSize = (value: number) => {
    setSettingsState((s) => ({ ...s, pageSize: value }));
    setSettings({ pageSize: value });
  };

  return (
    <div className="space-y-6">
      <PageHeader index="05" title="Settings" meta="LOCAL PREFERENCES" />

      <Card className="p-5">
        <h2 className="flex items-center gap-2 macro-section">
          <Moon className="h-4 w-4 text-slate-400" aria-hidden="true" />
          Display
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select value={themeMode} onChange={(e) => onTheme(e.target.value)} className="w-44" aria-label="Display mode">
            <option value="dark">CRT overlay: on</option>
            <option value="light">CRT overlay: off</option>
            <option value="system">Follow system</option>
          </Select>
          <p className="text-sm text-slate-500">The terminal is always dark; this toggles the CRT scanlines + grain overlay.</p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 macro-section">
          <KeyRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
          API key
        </h2>
        <div className="mt-3 max-w-xl space-y-2">
          <label htmlFor="settings-api-key" className="sr-only">
            API key
          </label>
          <input
            id="settings-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKeyState(e.target.value)}
            placeholder="Optional — sent as x-api-key on every request"
            autoComplete="off"
            className="min-h-[44px] w-full border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
          />
          <p className="text-xs text-slate-500">
            Needed only when the API is running with <code className="font-mono">API_KEYS</code> set. The key is held for this browser
            session only and is never stored server-side.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 macro-section">
          <Wallet className="h-4 w-4 text-slate-400" aria-hidden="true" />
          Display currency
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select value={settings.displayCurrency} onChange={(e) => onCurrency(e.target.value)} className="w-32" aria-label="Display currency">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <p className="text-sm text-slate-500">Highlighted on the dashboard when a balance is in this currency.</p>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 macro-section">
          <Ruler className="h-4 w-4 text-slate-400" aria-hidden="true" />
          Default page size
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select value={settings.pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="w-32" aria-label="Default page size">
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <p className="text-sm text-slate-500">Initial number of rows for lists across the console.</p>
          <CopyButton value={JSON.stringify({ theme: themeMode, apiKey: apiKey ? '•••' : '', ...settings })} label="Snapshot settings" />
        </div>
      </Card>
    </div>
  );
}

function getThemeMode(): 'light' | 'dark' | 'system' {
  try {
    const v = localStorage.getItem('ledger_theme');
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}
