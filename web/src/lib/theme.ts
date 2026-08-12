import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ledger_theme';

function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function getTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // The substrate is always the tactical dark terminal; the toggle controls the
  // CRT overlay (scanlines + noise). "light" = clean phosphor, "dark" = full CRT.
  root.classList.toggle('crt-off', theme === 'light');
  root.style.colorScheme = 'dark';
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const set = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
    setTheme(next);
  }, []);

  return [theme, set];
}

/** Clears the stored preference and follows the OS theme. */
export function useSystemTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const followSystem = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    setTheme(systemTheme());
  }, []);

  return [theme, followSystem];
}
