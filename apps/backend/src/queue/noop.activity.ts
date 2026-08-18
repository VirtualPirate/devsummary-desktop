/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Logger } from '@nestjs/common';
import { Activity } from '../temporal';

@Injectable()
export class NoopActivity {
  private readonly logger = new Logger('NoopActivity');

  @Activity('noop.run')
  async run(message: string): Promise<void> {
    this.logger.log(`[noop] received: ${message}`);
  }
}
