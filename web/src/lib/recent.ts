export interface RecentAccount {
  id: string;
  name: string;
  accountNumber: string;
  visitedAt: number;
}

const KEY = 'ledger_recent_accounts';
const MAX = 6;

export function getRecentAccounts(): RecentAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: RecentAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable */
  }
}

export function trackAccountVisit(account: { id: string; name: string; accountNumber: string }): void {
  const items = getRecentAccounts().filter((a) => a.id !== account.id);
  items.unshift({ ...account, visitedAt: Date.now() });
  persist(items.slice(0, MAX));
}
