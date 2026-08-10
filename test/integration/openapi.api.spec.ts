import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { getTestPool, resetDatabase } from './db';

describe('OpenAPI / Swagger [T-19]', () => {
  let app: INestApplication;
  let pool: Pool;
  let internal: InternalAccountsService;

  beforeAll(async () => {
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, { prefix: '/api/v1' });
    await app.init();
    internal = app.get(InternalAccountsService);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    internal.clearCache();
    await internal.getInternalCashAccountId();
  });

  const http = () => app.getHttpServer();

  it('serves the Swagger UI at /docs', async () => {
    const res = await request(http()).get('/docs').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger-ui');
  });

  it('serves the machine-readable OpenAPI document at /docs-json', async () => {
    const res = await request(http()).get('/docs-json').expect(200);
    const doc = res.body;

    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('Event-Sourced Ledger API');

    const paths = doc.paths;
    expect(paths['/api/v1/accounts']).toBeDefined();
    expect(paths['/api/v1/accounts'].post).toBeDefined();
    expect(paths['/api/v1/transfers']).toBeDefined();
    expect(paths['/api/v1/accounts/{id}/audit']).toBeDefined();
    expect(paths['/api/v1/transactions/{id}/void']).toBeDefined();
  });

  it('includes Zod-synced request body schemas (no drift)', async () => {
    const doc = (await request(http()).get('/docs-json').expect(200)).body;

    const createBody = doc.paths['/api/v1/accounts'].post.requestBody.content['application/json'].schema;
    expect(createBody.properties.name).toBeDefined();
    expect(createBody.properties.type).toBeDefined();
    expect(createBody.properties.overdraftLimit).toBeDefined();

    const transferBody = doc.paths['/api/v1/transfers'].post.requestBody.content['application/json'].schema;
    expect(transferBody.properties.amount).toBeDefined();
    expect(transferBody.properties.fromAccountId).toBeDefined();
    expect(transferBody.properties.toAccountId).toBeDefined();
  });

  it('registers the shared component schemas', async () => {
    const doc = (await request(http()).get('/docs-json').expect(200)).body;
    expect(doc.components.schemas.ApiError).toBeDefined();
    expect(doc.components.schemas.Account).toBeDefined();
    expect(doc.components.schemas.Transaction).toBeDefined();
    expect(doc.components.schemas.AuditEvent).toBeDefined();
  });
});