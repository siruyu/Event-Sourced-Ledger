import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { HealthController } from '@/interfaces/health/health.controller';
import { PG_POOL } from '@/infrastructure/db/providers';

function stubResponse(): Response {
  const res = { status: jest.fn().mockReturnThis() } as unknown as Response;
  return res;
}

describe('HealthController', () => {
  it('reports ok when the database is reachable', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PG_POOL, useValue: { query: jest.fn().mockResolvedValue({ rows: [] }) } }],
    }).compile();
    const controller = moduleRef.get(HealthController);
    const res = stubResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is unreachable', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PG_POOL,
          useValue: { query: jest.fn().mockRejectedValue(new Error('connection refused')) },
        },
      ],
    }).compile();
    const controller = moduleRef.get(HealthController);
    const res = stubResponse();

    const result = await controller.check(res);

    expect(result.status).toBe('error');
    expect(result.db).toBe('down');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('returns 503 when the probe times out', async () => {
    const never = new Promise<{ rows: [] }>(() => undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PG_POOL, useValue: { query: jest.fn().mockReturnValue(never) } }],
    }).compile();
    const controller = moduleRef.get(HealthController);
    const res = stubResponse();

    const result = await controller.check(res);

    expect(result.db).toBe('down');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
