import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../dto/zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ name: z.string().min(1) });
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed value on valid input', () => {
    expect(pipe.transform({ name: 'hello' })).toEqual({ name: 'hello' });
  });

  it('throws HttpException 400 with ApiError body on invalid input', () => {
    try {
      pipe.transform({ name: '' });
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as {
        code: string;
        message: string;
        details?: unknown;
      };
      expect((error as HttpException).getStatus()).toBe(400);
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(response.details).toBeDefined();
    }
  });
});
