import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '@/domain/errors';
import { errorBody, httpStatusFor, type ApiErrorBody } from './error-response';

/**
 * Global exception filter that normalizes every error into the documented
 * `{ error: { code, message, details? } }` contract (T-11).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let body: ApiErrorBody;

    if (exception instanceof DomainError) {
      status = httpStatusFor(exception.code);
      body = errorBody(exception.code, exception.message);
    } else if (exception instanceof ZodError) {
      status = 400;
      body = errorBody(
        'VALIDATION_ERROR',
        'Validation failed',
        exception.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      );
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: unknown }).message as string) ?? exception.message;
      body = errorBody(`HTTP_${status}`, message);
    } else {
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.originalUrl}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      body = errorBody('INTERNAL', 'Internal server error');
    }

    response.status(status).json(body);
  }
}
