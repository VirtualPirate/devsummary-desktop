import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AppError } from '../../common/errors';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.VALIDATION_ERROR({ details: result.error.format() });
    }
    return result.data;
  }
}
