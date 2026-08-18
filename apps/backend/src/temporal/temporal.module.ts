import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import { buildTemporalConfig, type TemporalConfig } from './temporal.config';
import { TEMPORAL_CLIENT, TEMPORAL_CONFIG } from './temporal.tokens';
import { TemporalProducerService } from './producer.service';

@Global()
@Module({})
export class TemporalModule {
  static forRoot(): DynamicModule {
    return {
      module: TemporalModule,
      providers: [
        {
          provide: TEMPORAL_CONFIG,
          inject: [ConfigService],
          useFactory: (c: ConfigService): TemporalConfig =>
            buildTemporalConfig(c),
        },
        {
          provide: TEMPORAL_CLIENT,
          inject: [TEMPORAL_CONFIG],
          useFactory: async (cfg: TemporalConfig): Promise<Client> => {
            const connection = await Connection.connect({
              address: cfg.address,
            });
            return new Client({ connection, namespace: cfg.namespace });
          },
        },
        TemporalProducerService,
      ],
      exports: [TemporalProducerService, TEMPORAL_CLIENT, TEMPORAL_CONFIG],
    };
  }
}
