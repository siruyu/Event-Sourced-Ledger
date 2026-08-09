import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', '/api/v1');
  const port = parseInt(config.get<string>('PORT', '3000'), 10);
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.setGlobalPrefix(prefix);
  if (origins.length > 0) {
    app.enableCors({ origin: origins });
  }

  await app.listen(port);
  Logger.log(`Ledger API listening on http://localhost:${port}${prefix}`, 'Bootstrap');
}

void bootstrap();
