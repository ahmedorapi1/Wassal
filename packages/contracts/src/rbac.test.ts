import { describe, expect, it } from 'vitest';

import { hasPermission, permissionsFor } from './rbac.js';

describe('RBAC policy', () => {
  it('keeps staff away from financial data', () => {
    expect(hasPermission('merchant_staff', 'finance:read')).toBe(false);
  });

  it('grants super administrators every declared permission', () => {
    expect(permissionsFor('super_admin')).toContain('feature_flag:manage');
    expect(permissionsFor('super_admin')).toContain('audit:read');
  });

  it('separates courier, finance, operations, and super-admin finance powers', () => {
    expect(hasPermission('courier', 'courier_marketplace:read')).toBe(true);
    expect(hasPermission('courier', 'courier_accounts:read')).toBe(false);
    expect(hasPermission('finance_admin', 'external_payments:create')).toBe(
      true,
    );
    expect(hasPermission('finance_admin', 'waivers:create')).toBe(false);
    expect(hasPermission('operations_admin', 'finance_settings:update')).toBe(
      false,
    );
    expect(hasPermission('super_admin', 'waivers:create')).toBe(true);
  });
});
