import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * Global rate-limiter (T-24). Counts per API key (`x-api-key`) when auth is
 * enabled, falling back to the request IP. Limits/window come from
 * `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`; throttling is disabled entirely
 * when `API_KEYS` is unset (dev mode). Headers are emitted as
 * `X-RateLimit-{Limit,Remaining,Reset}` with a `Retry-After` on 429.
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const keys = this.config.get<string>('API_KEYS', '');
    if (!keys.trim()) return true;
    return super.canActivate(context);
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, unknown> | undefined;
    const provided = headers?.['x-api-key'];
    const tracker = typeof provided === 'string' && provided.length > 0 ? provided : typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(tracker);
  }
}