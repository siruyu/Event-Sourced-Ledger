import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Constant-time string comparison (no length/timing leaks). */
function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Static API-key authentication (T-24). Keys come from the comma-separated
 * `API_KEYS` env var and are supplied via the `x-api-key` header. When
 * `API_KEYS` is unset the guard is disabled entirely (local dev mode).
 * Routes marked `@Public()` (e.g. the health probe) are always allowed.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const keys = this.config.get<string>('API_KEYS', '');
    const valid = keys.split(',').map((k) => k.trim()).filter(Boolean);
    if (valid.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const provided =
      typeof req.headers['x-api-key'] === 'string' ? (req.headers['x-api-key'] as string).trim() : '';

    if (!provided || !valid.some((k) => constantTimeEqual(k, provided))) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
