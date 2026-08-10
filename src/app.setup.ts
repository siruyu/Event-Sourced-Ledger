import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import {
  accountSchema,
  apiErrorSchema,
  auditEventSchema,
  transactionLegSchema,
  transactionSchema,
} from '@/common/swagger/contract';

export interface AppSetupOptions {
  prefix: string;
  corsOrigins?: string[];
  enableSwagger?: boolean;
}

/**
 * Shared application-level configuration used by both the production bootstrap
 * (main.ts) and the integration test harness, so behaviour is identical.
 */
export function configureApp(app: INestApplication, options: AppSetupOptions): void {
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix(options.prefix);
  if (options.corsOrigins && options.corsOrigins.length > 0) {
    app.enableCors({ origin: options.corsOrigins });
  }

  if (options.enableSwagger !== false) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Event-Sourced Ledger API')
      .setDescription(
        'Double-entry banking core. Every balance change is an immutable, append-only ' +
          'event; balances are derived from history; invariant violations abort atomically.',
      )
      .setVersion('0.1.0')
      .addTag('accounts')
      .addTag('transactions')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    document.components = {
      ...(document.components ?? {}),
      schemas: {
        ...(document.components?.schemas ?? {}),
        ApiError: apiErrorSchema,
        Account: accountSchema,
        Transaction: transactionSchema,
        TransactionLeg: transactionLegSchema,
        AuditEvent: auditEventSchema,
      },
    };
    SwaggerModule.setup('docs', app, document);
  }
}