import { SetMetadata } from '@nestjs/common';

export type OrgRoleLevel = 'owner' | 'admin' | 'member';

export const REQUIRE_ORG_ROLE_KEY = 'requireOrgRole';

export const RequireOrgRole = (level: OrgRoleLevel) =>
  SetMetadata(REQUIRE_ORG_ROLE_KEY, level);
