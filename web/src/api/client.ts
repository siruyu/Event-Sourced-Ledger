const BASE = '/api/v1';
const KEY_STORAGE = 'ledger_api_key';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** API key for authenticated deployments (T-24), stored per browser session. */
export function getApiKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    if (key.trim()) sessionStorage.setItem(KEY_STORAGE, key.trim());
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

/** Error normalized from the API's `{ error: { code, message, details } }` contract. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed (${status})`);
    this.name = 'ApiError';
    this.code = body.code || `HTTP_${status}`;
    this.status = status;
    this.details = body.details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['x-api-key'] = key;

  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...init,
  });

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      const parsed = (await res.json()) as { error?: ApiErrorBody };
      body = parsed.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, body ?? { code: `HTTP_${res.status}`, message: res.statusText });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
