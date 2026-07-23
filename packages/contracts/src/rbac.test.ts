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
});
