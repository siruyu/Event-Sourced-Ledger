import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('API auth + rate limiting (enabled) [T-24]', () => {
  let app: INestApplication;
  let pool: Pool;
  let internal: InternalAccountsService;

  beforeAll(async () => {
    process.env.API_KEYS = 'key-one,key-two';
    process.env.RATE_LIMIT_MAX = '3';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    internal = app.get(InternalAccountsService);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.API_KEYS;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    internal.clearCache();
    await internal.getInternalCashAccountId();
  });

  const http = () => app.getHttpServer();
  const get = (key?: string) => {
    const req = request(http()).get('/api/v1/accounts');
    return key ? req.set('x-api-key', key) : req;
  };

  it('rejects requests without a key with 401', async () => {
    const res = await get().expect(401);
    expect(res.body.error.code).toBe('HTTP_401');
  });

  it('rejects requests with an invalid key with 401', async () => {
    const res = await get('not-a-real-key').expect(401);
    expect(res.body.error.code).toBe('HTTP_401');
  });

  it('accepts a valid key', async () => {
    const res = await get('key-one').expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('keeps the health probe public (no key required)', async () => {
    const res = await request(http()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('enforces the per-key rate limit with Retry-After + X-RateLimit headers', async () => {
    const key = 'key-two';
    for (let i = 0; i < 3; i++) {
      const res = await get(key).expect(200);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    }

    const blocked = await get(key).expect(429);
    expect(blocked.body.error.code).toBe('HTTP_429');
    expect(parseInt(blocked.headers['retry-after'], 10)).toBeGreaterThan(0);
  });

  it('does not throttle different keys independently', async () => {
    // key-two was exhausted by the previous test; key-one must be unaffected.
    const res = await get('key-one').expect(200);
    expect(res.body.items).toBeDefined();
  });

  it('still blocks the already-exhausted key', async () => {
    await get('key-two').expect(429);
  });
});

describe('API auth + rate limiting disabled (dev) [T-24]', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    delete process.env.API_KEYS;
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  it('serves requests without any API key', async () => {
    const res = await request(http()).get('/api/v1/accounts').expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  const http = () => app.getHttpServer();
});
