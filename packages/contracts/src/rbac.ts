export const roles = [
  'merchant_owner',
  'merchant_manager',
  'merchant_staff',
  'courier',
  'support_agent',
  'operations_admin',
  'finance_admin',
  'super_admin',
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  'merchant:read',
  'merchant:write',
  'merchant_staff:manage',
  'store:read',
  'store:write',
  'order:read',
  'order:write',
  'courier:self',
  'courier:verify',
  'user_status:manage',
  'pricing:manage',
  'finance:read',
  'support:manage',
  'feature_flag:manage',
  'audit:read',
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions = {
  merchant_owner: [
    'merchant:read',
    'merchant:write',
    'merchant_staff:manage',
    'store:read',
    'store:write',
    'order:read',
    'order:write',
    'finance:read',
  ],
  merchant_manager: [
    'merchant:read',
    'merchant:write',
    'merchant_staff:manage',
    'store:read',
    'store:write',
    'order:read',
    'order:write',
  ],
  merchant_staff: ['merchant:read', 'store:read', 'order:read', 'order:write'],
  courier: ['courier:self', 'order:read'],
  support_agent: ['order:read', 'support:manage'],
  operations_admin: [
    'order:read',
    'courier:verify',
    'user_status:manage',
    'pricing:manage',
    'support:manage',
  ],
  finance_admin: ['order:read', 'pricing:manage', 'finance:read'],
  super_admin: permissions,
} as const satisfies Record<Role, readonly Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (rolePermissions[role] as readonly Permission[]).includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return rolePermissions[role];
}

export const databaseRoleByRole = {
  merchant_owner: 'OWNER',
  merchant_manager: 'MANAGER',
  merchant_staff: 'STAFF',
  courier: 'COURIER',
  support_agent: 'SUPPORT',
  operations_admin: 'OPERATIONS_ADMIN',
  finance_admin: 'FINANCE_ADMIN',
  super_admin: 'SUPER_ADMIN',
} as const satisfies Record<Role, string>;

export function roleFromDatabase(role: string): Role {
  const entry = Object.entries(databaseRoleByRole).find(
    ([, databaseRole]) => databaseRole === role,
  );
  if (!entry) throw new Error(`Unsupported database role: ${role}`);
  return entry[0] as Role;
}
