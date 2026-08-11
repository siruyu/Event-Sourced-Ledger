import { api, post } from './client';
import type { Account, AuditView, CreateAccountInput, MovementInput, Page, Transaction, TransferInput } from './types';

export const listAccounts = (params: { cursor?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString();
  return api<Page<Account>>(`/accounts${suffix ? `?${suffix}` : ''}`);
};

export const getAccount = (id: string) => api<Account>(`/accounts/${id}`);

export const createAccount = (input: CreateAccountInput) =>
  post<Account>('/accounts', input);

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