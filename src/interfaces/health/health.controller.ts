import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '@/infrastructure/db/providers';

const HEALTH_QUERY_TIMEOUT_MS = 2_000;

interface HealthBody {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  timestamp: string;
}

/**
 * Readiness probe: returns 200 only when the database is reachable, otherwise
 * 503. The liveness path (200 "ok") doubles as a dependency check so
 * orchestrators restart the API when Postgres is unreachable.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthBody> {
    const timestamp = new Date().toISOString();
    const db = await this.probeDatabase();

    if (db !== 'up') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', db: 'down', timestamp };
    }
    return { status: 'ok', db: 'up', timestamp };
  }

  private async probeDatabase(): Promise<'up' | 'down'> {
    try {
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('health probe timed out')), HEALTH_QUERY_TIMEOUT_MS),
        ),
      ]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
