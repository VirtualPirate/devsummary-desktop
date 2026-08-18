/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Module, SetMetadata, DynamicModule } from '@nestjs/common';

export const AllowAnonymous = () => SetMetadata('isPublic', true);
export const OptionalAuth = () => SetMetadata('isOptionalAuth', true);
export const Session = () => () => undefined;

@Injectable()
export class AuthService<_T = unknown> {
  get api() {
    return {} as any;
  }
}

@Module({
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {
  static forRoot(_options: any): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      providers: [AuthService],
      exports: [AuthService],
    };
  }

  static forRootAsync(options: any): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: options.imports || [],
      providers: [
        AuthService,
        ...(options.useFactory
          ? [
              {
                provide: 'AUTH_MODULE_OPTIONS',
                useFactory: options.useFactory,
                inject: options.inject || [],
              },
            ]
          : []),
      ],
      exports: [AuthService],
    };
  }
}
