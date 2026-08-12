import { api, ApiError, getApiKey, post } from './client';
import type {
  Account,
  AccountTransactionItem,
  AuditView,
  CreateAccountInput,
  MovementInput,
  Page,
  StatusHistoryItem,
  Transaction,
  TransferInput,
} from './types';

export interface AccountListParams {
  cursor?: string;
  limit?: number;
  status?: Account['status'];
  type?: Account['type'];
}

export const listAccounts = (params: AccountListParams = {}) => {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  const suffix = qs.toString();
  return api<Page<Account>>(`/accounts${suffix ? `?${suffix}` : ''}`);
};

export const getAccount = (id: string) => api<Account>(`/accounts/${id}`);

export const createAccount = (input: CreateAccountInput) =>
  post<Account>('/accounts', input);

export const updateAccountStatus = (id: string, status: Account['status']) =>
  api<Account>(`/accounts/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const voidTransaction = (id: string) => post<Transaction>(`/transactions/${id}/void`, {});
export const getStatusHistory = (id: string) => api<StatusHistoryItem[]>(`/accounts/${id}/status-history`);

export const getAccountTransactions = (
  id: string,
  opts: { cursor?: string; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return api<Page<AccountTransactionItem>>(`/accounts/${id}/transactions${qs ? `?${qs}` : ''}`);
};

export const getBalance = (id: string, asOf?: string) =>
  api<{ balance: string; currency: string; asOf?: string }>(
    `/accounts/${id}/balance${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`,
  );

export const getAudit = (
  id: string,
  opts: { asOf?: string; cursor?: string; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  if (opts.asOf) params.set('as_of', opts.asOf);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return api<AuditView>(`/accounts/${id}/audit${qs ? `?${qs}` : ''}`);
};

export const deposit = (id: string, input: MovementInput) =>
  post<Transaction>(`/accounts/${id}/deposits`, input);

export const withdraw = (id: string, input: MovementInput) =>
  post<Transaction>(`/accounts/${id}/withdrawals`, input);

export const transfer = (input: TransferInput) => post<Transaction>('/transfers', input);

/**
 * Downloads a CSV export through the same client path as every other request
 * (so the configured API key header is attached) and triggers a browser
 * download. Throws ApiError when the export fails.
 */
export async function downloadCsv(
  id: string,
  variant: 'transactions' | 'audit',
  asOf?: string,
): Promise<void> {
  const qs = new URLSearchParams();
  if (asOf) qs.set('as_of', asOf);
  const suffix = qs.toString();
  const url = `/api/v1/accounts/${id}/${variant}.csv${suffix ? `?${suffix}` : ''}`;

  const headers: Record<string, string> = {};
  const key = getApiKey();
  if (key) headers['x-api-key'] = key;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, {
      code: body?.error?.code ?? `HTTP_${res.status}`,
      message: body?.error?.message ?? `CSV export failed (${res.status})`,
    });
  }

  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${variant}-${id.slice(0, 8)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}