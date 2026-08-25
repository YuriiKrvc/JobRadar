import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(
          err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      }
      throw new BadRequestException('invalid query parameters');
    }
  }
}
