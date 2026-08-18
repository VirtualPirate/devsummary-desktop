import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import * as express from 'express';
import { KYSELY_DB, type AppDatabase } from '../databases/kysely';
import { createAuth } from './auth.config';
import { EmailOtpController } from './email-otp.controller';
import { EmailOtpService } from './email-otp.service';

@Module({
  imports: [
    BetterAuthModule.forRootAsync({
      inject: [KYSELY_DB, ConfigService],
      useFactory: (db: AppDatabase, configService: ConfigService) => {
        const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
        const secret = configService.getOrThrow<string>('BETTER_AUTH_SECRET');
        const baseURL = configService.getOrThrow<string>('BETTER_AUTH_URL');
        const frontendURL = configService.getOrThrow<string>('FRONTEND_URL');
        const resendApiKey = configService.getOrThrow<string>('RESEND_API_KEY');
        const emailFrom = configService.getOrThrow<string>('EMAIL_FROM');
        const googleClientId = configService.get<string>('GOOGLE_CLIENT_ID');
        const googleClientSecret = configService.get<string>(
          'GOOGLE_CLIENT_SECRET',
        );
        return {
          auth: createAuth({
            db,
            databaseUrl,
            secret,
            baseURL,
            trustedOrigins: [baseURL, frontendURL],
            resendApiKey,
            emailFrom,
            nodeEnv: configService.get<string>('NODE_ENV'),
            googleClientId,
            googleClientSecret,
          }),
          bodyParser: { rawBody: true },
        };
      },
    }),
  ],
  controllers: [EmailOtpController],
  providers: [EmailOtpService],
})
export class AppAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(express.json()).forRoutes(EmailOtpController);
  }
}
