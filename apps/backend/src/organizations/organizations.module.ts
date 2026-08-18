import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import * as express from 'express';
import {
  OrganizationsController,
  MembersController,
  InvitesController,
} from './controllers';
import {
  OrganizationsService,
  MembersService,
  InvitesService,
  InviteMailer,
} from './services';
import {
  OrganizationsRepository,
  OrganizationMembersRepository,
  OrganizationInvitesRepository,
} from './repositories';
import { OrganizationTeardownService } from './services/organization-teardown.service';
import { OrgContextGuard } from './guards/org-context.guard';

@Module({
  controllers: [OrganizationsController, MembersController, InvitesController],
  providers: [
    OrganizationsRepository,
    OrganizationMembersRepository,
    OrganizationInvitesRepository,
    OrganizationsService,
    // No module imports for its Slack/GitHub dependencies: TEMPORAL_CLIENT is
    // global, and the two integration services are resolved through ModuleRef
    // because their modules do not export them (see the service).
    OrganizationTeardownService,
    MembersService,
    InvitesService,
    InviteMailer,
    {
      provide: APP_GUARD,
      useClass: OrgContextGuard,
    },
  ],
})
export class OrganizationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(express.json())
      .forRoutes(OrganizationsController, MembersController, InvitesController);
  }
}
