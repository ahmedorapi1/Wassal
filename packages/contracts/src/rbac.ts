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
  'courier_marketplace:read',
  'courier_order:accept',
  'courier_assigned_order:read',
  'courier_lifecycle:update',
  'courier_account:read',
  'courier_settlement:read',
  'finance_settings:read',
  'finance_settings:update',
  'courier_accounts:read',
  'settlements:read',
  'settlements:close',
  'external_payments:create',
  'external_payments:reverse',
  'adjustments:create',
  'waivers:create',
  'financial_exports:create',
  'delivery_dispute:read',
  'delivery_dispute:resolve',
  'return:override',
  'payment_proof:create',
  'payment_proof:read_own',
  'payment_proof:cancel',
  'payment_proof:review',
  'payment_proof:approve',
  'payment_proof:reject',
  'payment_proof_file:read',
  'operational_settings:read',
  'operational_settings:update',
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
    'operational_settings:read',
  ],
  merchant_manager: [
    'merchant:read',
    'merchant:write',
    'merchant_staff:manage',
    'store:read',
    'store:write',
    'order:read',
    'order:write',
    'operational_settings:read',
  ],
  merchant_staff: ['merchant:read', 'store:read', 'order:read', 'order:write'],
  courier: [
    'courier:self',
    'order:read',
    'courier_marketplace:read',
    'courier_order:accept',
    'courier_assigned_order:read',
    'courier_lifecycle:update',
    'courier_account:read',
    'courier_settlement:read',
    'payment_proof:create',
    'payment_proof:read_own',
    'payment_proof:cancel',
    'payment_proof_file:read',
  ],
  support_agent: ['order:read', 'support:manage', 'delivery_dispute:read'],
  operations_admin: [
    'order:read',
    'courier:verify',
    'user_status:manage',
    'pricing:manage',
    'support:manage',
    'delivery_dispute:read',
    'delivery_dispute:resolve',
    'return:override',
    'operational_settings:read',
  ],
  finance_admin: [
    'order:read',
    'pricing:manage',
    'finance:read',
    'finance_settings:read',
    'courier_accounts:read',
    'settlements:read',
    'settlements:close',
    'external_payments:create',
    'financial_exports:create',
    'payment_proof:review',
    'payment_proof:approve',
    'payment_proof:reject',
    'payment_proof_file:read',
    'operational_settings:read',
  ],
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
