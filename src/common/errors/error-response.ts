export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const DOMAIN_HTTP_STATUS: Record<string, number> = {
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_FROZEN: 409,
  ACCOUNT_CLOSED: 409,
  INSUFFICIENT_FUNDS: 422,
  INVALID_AMOUNT: 422,
  UNBALANCED_TRANSACTION: 422,
  INVALID_TRANSACTION: 422,
  DUPLICATE_REFERENCE: 409,
  CONFLICT_SEQUENCE: 409,
  CURRENCY_MISMATCH: 422,
  NOT_FOUND: 404,
};

export function httpStatusFor(code: string): number {
  return DOMAIN_HTTP_STATUS[code] ?? 422;
}
