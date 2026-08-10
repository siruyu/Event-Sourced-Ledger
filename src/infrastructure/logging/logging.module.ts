import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'http';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const USE_PRETTY = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

/**
 * Structured JSON logging with per-request correlation ids. The request id is
 * honoured from an incoming X-Request-Id header (or generated) and echoed back
 * on every response so clients can trace a request through the ledger.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', LOG_LEVEL),
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
            const id = incoming && incoming.length > 0 && incoming.length <= 128 ? incoming : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/api/v1/health') ?? false,
          },
          ...(USE_PRETTY ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule {}