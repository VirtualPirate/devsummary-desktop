import { SetMetadata } from '@nestjs/common';
import { ACTIVITY_METADATA_KEY } from './temporal.tokens';

export const Activity = (name: string): MethodDecorator =>
  SetMetadata(ACTIVITY_METADATA_KEY, name);
