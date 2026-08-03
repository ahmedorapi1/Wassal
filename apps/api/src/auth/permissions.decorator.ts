import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@wasel/contracts';

export const PERMISSIONS_METADATA = 'wasel:permissions';
export const Permissions = (...permissions: readonly Permission[]) =>
  SetMetadata(PERMISSIONS_METADATA, permissions);
