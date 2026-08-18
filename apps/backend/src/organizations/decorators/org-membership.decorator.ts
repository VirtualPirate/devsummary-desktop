import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrganizationRole } from '@launchstack/api-interfaces';

export interface OrgMembershipContext {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export const OrgMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrgMembershipContext => {
    const request = ctx.switchToHttp().getRequest<{
      orgMembership?: OrgMembershipContext;
    }>();
    if (!request.orgMembership) {
      throw new Error(
        'OrgMembership used on a route that is not org-scoped — add @RequireOrgRole().',
      );
    }
    return request.orgMembership;
  },
);
