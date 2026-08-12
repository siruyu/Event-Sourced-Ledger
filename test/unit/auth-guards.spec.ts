import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '@/common/security/api-key.guard';
import { ApiKeyThrottlerGuard } from '@/common/security/api-key-throttler.guard';

function makeContext({ handler, cls, headers, ip }: { handler?: unknown; cls?: unknown; headers?: Record<string, unknown>; ip?: string }) {
  return {
    getHandler: () => handler ?? (() => undefined),
    getClass: () => cls ?? class {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: headers ?? {}, ip }),
    }),
  } as never;
}

describe('ApiKeyGuard (T-24)', () => {
  it('allows @Public routes even when keys are configured', () => {
    const config = new ConfigService({ API_KEYS: 'k1,k2' });
    const reflector = new Reflector();
    reflector.getAllAndOverride = jest.fn().mockReturnValue(true) as never;
    const guard = new ApiKeyGuard(config, reflector);
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('is disabled when API_KEYS is empty', () => {
    const guard = new ApiKeyGuard(new ConfigService({ API_KEYS: '' }), new Reflector());
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('rejects a missing key when keys are configured', () => {
    const guard = new ApiKeyGuard(new ConfigService({ API_KEYS: 'k1' }), new Reflector());
    expect(() => guard.canActivate(makeContext({}))).toThrow(/Invalid or missing API key/);
  });

  it('rejects a wrong key', () => {
    const guard = new ApiKeyGuard(new ConfigService({ API_KEYS: 'k1,k2' }), new Reflector());
    expect(() => guard.canActivate(makeContext({ headers: { 'x-api-key': 'nope' } }))).toThrow();
  });

  it('accepts a valid key, trimming whitespace', () => {
    const guard = new ApiKeyGuard(new ConfigService({ API_KEYS: 'k1' }), new Reflector());
    expect(guard.canActivate(makeContext({ headers: { 'x-api-key': '  k1  ' } }))).toBe(true);
  });
});

describe('ApiKeyThrottlerGuard (T-24)', () => {
  const storage = { increment: jest.fn(), getRecord: jest.fn(), setRecord: jest.fn() } as never;

  function build(configValue: Record<string, unknown>) {
    return new ApiKeyThrottlerGuard(
      [{ ttl: 60, limit: 5 }],
      storage,
      new Reflector(),
      new ConfigService(configValue),
    );
  }

  it('bypasses throttling entirely when API_KEYS is unset', async () => {
    const guard = build({ API_KEYS: '' });
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true);
  });

  it('defers to the super implementation when keys are configured', async () => {
    const guard = build({ API_KEYS: 'k1' });
    const spy = jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    try {
      await expect(
        guard.canActivate(
          makeContext({
            headers: {
              'x-api-key': 'k1',
              host: 'localhost',
              'content-type': 'application/json',
            },
          }),
        ),
      ).resolves.toBe(true);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('getTracker prefers x-api-key, then ip, then unknown', async () => {
    const guard = build({ API_KEYS: 'k1' });

    const byKey = await (guard as unknown as { getTracker: (req: Record<string, unknown>) => Promise<string> }).getTracker({
      headers: { 'x-api-key': 'tok' },
    });
    expect(byKey).toBe('tok');

    const byIp = await (guard as unknown as { getTracker: (req: Record<string, unknown>) => Promise<string> }).getTracker({
      headers: {},
      ip: '127.0.0.1',
    });
    expect(byIp).toBe('127.0.0.1');

    const fallback = await (guard as unknown as { getTracker: (req: Record<string, unknown>) => Promise<string> }).getTracker({
      headers: {},
    });
    expect(fallback).toBe('unknown');
  });
});