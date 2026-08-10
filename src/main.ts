import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', '/api/v1');
  const port = parseInt(config.get<string>('PORT', '3000'), 10);
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  configureApp(app, { prefix, corsOrigins: origins });

  await app.listen(port);
  Logger.log(
    `Ledger API listening on http://localhost:${port}${prefix} (Swagger: /docs)`,
    'Bootstrap',
  );
}

void bootstrap();