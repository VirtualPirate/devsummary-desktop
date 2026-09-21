import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OrganizationsController } from './controllers';
import { OrganizationsService } from './services';
import {
  OrganizationsRepository,
  OrganizationMembersRepository,
} from './repositories';
import { OrganizationTeardownService } from './services/organization-teardown.service';
import { OrgContextGuard } from './guards/org-context.guard';

@Module({
  controllers: [OrganizationsController],
  providers: [
    OrganizationsRepository,
    OrganizationMembersRepository,
    OrganizationsService,
    // No module imports for its GitHub dependencies: the integration
    // services are resolved through ModuleRef because their modules do not
    // export them (see the service).
    OrganizationTeardownService,
    {
      provide: APP_GUARD,
      useClass: OrgContextGuard,
    },
  ],
})
export class OrganizationsModule {}
