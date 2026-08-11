const BASE = '/api/v1';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
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
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
