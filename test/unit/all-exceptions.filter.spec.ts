import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { AccountNotFoundError, InvalidAmountError } from '@/domain/errors';

function makeHost(status: jest.Mock, json: jest.Mock) {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status, json }),
      getRequest: () => ({ method: 'GET', originalUrl: '/x' }),
    }),
  } as never;
}

describe('AllExceptionsFilter (T-11 contract)', () => {
  const filter = new AllExceptionsFilter();

  it('maps a DomainError to its documented status and code', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    filter.catch(new AccountNotFoundError(), makeHost(status, json));
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' } });
  });

  it('normalizes a Zod validation error to 400 with readable details', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const zod = new ZodError([
      { code: 'too_small', path: ['amount'], message: 'too small', minimum: 1, type: 'number', inclusive: false } as never,
    ]);
    filter.catch(zod, makeHost(status, json));
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0]).toEqual({ path: 'amount', message: 'too small' });
  });

  it('maps HttpException string and object responses', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    filter.catch(new HttpException('boom', HttpStatus.BAD_REQUEST), makeHost(status, json));
    expect(json.mock.calls[0][0]).toEqual({ error: { code: 'HTTP_400', message: 'boom' } });

    const status2 = jest.fn().mockReturnThis();
    const json2 = jest.fn();
    filter.catch(
      new HttpException({ message: 'nested message' }, HttpStatus.UNAUTHORIZED),
      makeHost(status2, json2),
    );
    expect(json2.mock.calls[0][0]).toEqual({ error: { code: 'HTTP_401', message: 'nested message' } });
  });

  it('wraps unknown errors as INTERNAL 500 without leaking the stack', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    filter.catch(new Error('secret details'), makeHost(status, json));
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0]).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it('handles non-Error thrown values', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    filter.catch('plain string', makeHost(status, json));
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].error.code).toBe('INTERNAL');
  });

  it('handles an InvalidAmountError with its 422 status', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    filter.catch(new InvalidAmountError(), makeHost(status, json));
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
  });
});