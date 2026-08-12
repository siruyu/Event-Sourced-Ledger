import { errorBody, httpStatusFor } from '@/common/errors/error-response';
import { encodeCursor, decodeCursor } from '@/common/cursor';

describe('Error response helpers (T-11)', () => {
  it('builds a body without details when none supplied', () => {
    expect(errorBody('ACCOUNT_NOT_FOUND', 'nope')).toEqual({
      error: { code: 'ACCOUNT_NOT_FOUND', message: 'nope' },
    });
  });

  it('includes details when supplied', () => {
    expect(errorBody('VALIDATION_ERROR', 'bad', { path: 'amount' })).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'bad', details: { path: 'amount' } },
    });
  });

  it('maps every documented domain code to its HTTP status', () => {
    expect(httpStatusFor('ACCOUNT_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('NOT_FOUND')).toBe(404);
    expect(httpStatusFor('ACCOUNT_FROZEN')).toBe(409);
    expect(httpStatusFor('ACCOUNT_CLOSED')).toBe(409);
    expect(httpStatusFor('DUPLICATE_REFERENCE')).toBe(409);
    expect(httpStatusFor('CONFLICT_SEQUENCE')).toBe(409);
    expect(httpStatusFor('INSUFFICIENT_FUNDS')).toBe(422);
    expect(httpStatusFor('INVALID_AMOUNT')).toBe(422);
    expect(httpStatusFor('UNBALANCED_TRANSACTION')).toBe(422);
    expect(httpStatusFor('INVALID_TRANSACTION')).toBe(422);
    expect(httpStatusFor('CURRENCY_MISMATCH')).toBe(422);
  });

  it('falls back to 422 for unknown codes', () => {
    expect(httpStatusFor('WHATEVER')).toBe(422);
  });
});

describe('Cursor encode/decode', () => {
  it('encodes and round-trips an object', () => {
    const encoded = encodeCursor({ seq: 42, id: 'abc' });
    expect(decodeCursor(encoded)).toEqual({ seq: 42, id: 'abc' });
  });

  it('returns null for an undefined cursor', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null for malformed base64', () => {
    expect(decodeCursor('!!!not-valid!!!')).toBeNull();
  });

  it('returns null when the decoded value is not an object', () => {
    expect(decodeCursor(Buffer.from(JSON.stringify('just a string'), 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify(12), 'utf8').toString('base64url'))).toBeNull();
  });
});