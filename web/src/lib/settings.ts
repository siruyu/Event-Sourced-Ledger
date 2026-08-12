export interface Settings {
  displayCurrency: string;
  pageSize: number;
}

const KEY = 'ledger_settings';
const DEFAULTS: Settings = { displayCurrency: 'USD', pageSize: 20 };

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      displayCurrency: typeof parsed.displayCurrency === 'string' && parsed.displayCurrency ? parsed.displayCurrency : DEFAULTS.displayCurrency,
      pageSize: typeof parsed.pageSize === 'number' && parsed.pageSize >= 1 && parsed.pageSize <= 100 ? parsed.pageSize : DEFAULTS.pageSize,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSettings(patch: Partial<Settings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}
