import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import { LoggerModule } from './logger.module';

describe('LoggerModule', () => {
  it('compiles and exposes a resolvable Logger', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule],
    }).compile();

    const logger = moduleRef.get(PinoLogger, { strict: false });
    expect(logger).toBeDefined();
    expect(typeof logger.log).toBe('function');
  });
});
