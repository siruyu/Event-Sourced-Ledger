import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/** Converts a Zod schema into an OpenAPI 3 JSON schema, keeping docs in sync. */
export function jsonSchema(schema: z.ZodTypeAny): SchemaObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (zodToJsonSchema as any)(schema, { target: 'openApi3' }) as SchemaObject;
}

export const apiErrorSchema: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'INSUFFICIENT_FUNDS' },
        message: { type: 'string', example: 'Insufficient funds: post would leave balance ...' },
        details: { type: 'object' },
      },
    },
  },
};

export const accountSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'accountNumber', 'name', 'type', 'normalSide', 'currency', 'overdraftLimit', 'status', 'balance', 'metadata', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    accountNumber: { type: 'string', example: 'LE-ABC123' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['checking', 'savings', 'credit_card', 'cash', 'investment'] },
    normalSide: { type: 'string', enum: ['debit', 'credit'] },
    currency: { type: 'string', example: 'USD' },
    overdraftLimit: { type: 'string', example: '0.0000', description: 'Decimal string, 4 decimal places' },
    status: { type: 'string', enum: ['active', 'frozen', 'closed'] },
    balance: { type: 'string', example: '0.0000', description: 'Derived balance, decimal string' },
    metadata: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export function pageSchema(item: SchemaObject): SchemaObject {
  return {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', items: item },
      nextCursor: { type: 'string', description: 'Opaque cursor for the next page' },
    },
  };
}

/** A Page whose items are a $ref to a registered component schema. */
export function pageRefSchema(itemRef: string): SchemaObject {
  return {
    type: 'object',
    required: ['items'],
    properties: {
      items: { type: 'array', items: { $ref: itemRef } },
      nextCursor: { type: 'string', description: 'Opaque cursor for the next page' },
    },
  };
}

export const transactionLegSchema: SchemaObject = {
  type: 'object',
  required: ['accountId', 'direction', 'amount', 'currency'],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    direction: { type: 'string', enum: ['debit', 'credit'] },
    amount: { type: 'string', example: '250.0000' },
    currency: { type: 'string' },
  },
};

export const transactionSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'type', 'status', 'reference', 'description', 'metadata', 'postedAt', 'legs'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['deposit', 'withdrawal', 'transfer', 'fee', 'reversal'] },
    status: { type: 'string', enum: ['posted', 'void'] },
    reference: { type: 'string',
    nullable: true },
    description: { type: 'string',
    nullable: true },
    metadata: { type: 'object' },
    postedAt: { type: 'string', format: 'date-time' },
    legs: { type: 'array', items: transactionLegSchema },
  },
};

export const auditEventSchema: SchemaObject = {
  type: 'object',
  required: ['seq', 'transactionId', 'type', 'direction', 'amount', 'effect', 'runningBalance', 'postedAt', 'counterparty', 'explanation'],
  properties: {
    seq: { type: 'integer' },
    transactionId: { type: 'string', format: 'uuid' },
    type: { type: 'string' },
    reference: { type: 'string',
    nullable: true },
    description: { type: 'string',
    nullable: true },
    direction: { type: 'string', enum: ['debit', 'credit'] },
    amount: { type: 'string' },
    effect: { type: 'string', example: '+250.0000' },
    runningBalance: { type: 'string', example: '750.0000' },
    postedAt: { type: 'string', format: 'date-time' },
    counterparty: {
      type: 'object',
      nullable: true,
      properties: { accountId: { type: 'string', format: 'uuid' }, accountNumber: { type: 'string' }, name: { type: 'string' } },
    },
    explanation: { type: 'string', example: 'Transfer -250.0000 to Bodhi (LE-ABC) — balance 750.0000' },
  },
};

export const balanceSchema: SchemaObject = {
  type: 'object',
  required: ['balance', 'currency'],
  properties: {
    balance: { type: 'string', example: '0.0000' },
    currency: { type: 'string' },
    asOf: { type: 'string', format: 'date-time' },
  },
};