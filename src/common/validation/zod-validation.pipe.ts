import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/**
 * Validates and transforms a request value against a Zod schema. Validation
 * failures throw a ZodError, which the global exception filter maps to a 400
 * with the documented error shape.
 */
@Injectable()
export class ZodValidationPipe<Output> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: z.ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata): Output {
    return this.schema.parse(value) as Output;
  }
}
