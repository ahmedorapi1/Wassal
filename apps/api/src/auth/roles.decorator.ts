import { SetMetadata } from '@nestjs/common';
import type { Role } from '@wasel/contracts';

export const ROLES_METADATA = 'wasel:roles';
export const Roles = (...roles: readonly Role[]) =>
  SetMetadata(ROLES_METADATA, roles);
