// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CourierVerificationWorkspace,
  OrdersByZoneWorkspace,
  PricingOperationsWorkspace,
  ZoneFinanceView,
} from './admin-operations-workspaces';
import { AdminFinanceWorkspace } from './admin-finance-workspace';

const token = { accessToken: 'admin-token' };
const zone = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'منطقة دمياط',
  governorate: 'دمياط',
  city: 'دمياط',
  status: 'ACTIVE',
  radiusKm: 12,
  maximumRouteDistanceMeters: 25_000,
};

function json(value: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('admin operations workspaces', () => {
  it('renders the simplified zone-bound pricing workflow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/admin/pricing-rules')) return json([]);
        if (url.includes('/admin/service-zones')) return json([zone]);
        return json({});
      }),
    );
    render(<PricingOperationsWorkspace token={token} role="super_admin" />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'إضافة قاعدة تسعير' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'إضافة قاعدة تسعير' });
    fireEvent.change(screen.getByLabelText('منطقة الخدمة — إجباري'), {
      target: { value: zone.id },
    });
    expect(dialog).toHaveTextContent('تُشتق المحافظة والمدينة');
    expect(dialog).toHaveTextContent('المحافظةدمياط');
    expect(dialog).toHaveTextContent('أقصى مسافة مسار25 كم');
    expect(
      screen.getByDisplayValue('70% من سعر الرحلة الأصلية دون العمولة'),
    ).toHaveAttribute('readonly');
    expect(screen.queryByLabelText('الأولوية')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('الحد الأدنى')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('أقصى مسافة')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('إضافات اختيارية'));
    expect(
      screen.getByLabelText(/الحد الأقصى للوزن — الشريحة 1/),
    ).toBeVisible();
    expect(screen.getByLabelText(/الإضافة — الشريحة 3/)).toBeVisible();
  });

  it('defaults courier verification to pending review and exposes four live counters', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/courier-verification/summary')) {
        return json({
          pendingReview: 2,
          approved: 4,
          changesRequested: 1,
          suspended: 3,
        });
      }
      if (url.includes('/admin/couriers?')) return json([]);
      if (url.includes('/admin/service-zones')) return json([zone]);
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CourierVerificationWorkspace token={token} />);

    expect(
      await screen.findByRole('button', { name: /تحت المراجعة/ }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /معتمدون/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /مطلوب تعديل/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /موقوفون/ })).toBeVisible();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('status=PENDING_REVIEW'),
        ),
      ).toBe(true);
    });
  });

  it('starts the order workspace with zone cards instead of a mixed order list', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/admin/order-zones/${zone.id}/summary`)) {
        return json({
          counts: {
            NEW: 1,
            AVAILABLE: 2,
            ACCEPTED: 0,
            PICKING_UP: 0,
            IN_DELIVERY: 0,
            COMPLETED_GROUP: 3,
            RETURNED_GROUP: 1,
            CANCELLED_GROUP: 0,
            DISPUTED: 0,
          },
        });
      }
      if (url.includes('/admin/orders?')) {
        return json({ items: [], total: 0 });
      }
      if (url.includes('/admin/order-zones')) {
        return json({
          zones: [
            {
              ...zone,
              ordersToday: 5,
              activeOrders: 2,
              completedToday: 3,
              returnedToday: 1,
            },
          ],
        });
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <OrdersByZoneWorkspace
        token={token}
        role="super_admin"
        onOpen={vi.fn()}
      />,
    );

    expect(await screen.findByText('منطقة دمياط')).toBeVisible();
    expect(screen.getByText('طلبات اليوم')).toBeVisible();
    expect(screen.getByText('نشطة الآن')).toBeVisible();
    expect(screen.getByText('مرتجعة اليوم')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /منطقة دمياط/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: /متاحة للمناديب/ }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('statusGroup=AVAILABLE'),
        ),
      ).toBe(true);
    });
  });

  it('shows finance totals per zone and keeps general finance tools reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/admin/finance/zones')) {
          return json({
            zones: [
              {
                ...zone,
                courierCount: 3,
                openSettlements: 2,
                overdueSettlements: 1,
                outstandingMinor: 12_500,
                collectedTodayMinor: 2_000,
                collectedMonthMinor: 8_000,
                lastActivityAt: '2026-07-29T12:00:00.000Z',
              },
            ],
          });
        }
        return json({});
      }),
    );
    const onOpenGeneral = vi.fn();
    render(<ZoneFinanceView token={token} onOpenGeneral={onOpenGeneral} />);

    expect(await screen.findByText('المالية حسب المنطقة')).toBeVisible();
    expect(await screen.findByText('مفتوحة / متأخرة')).toBeVisible();
    expect(screen.getByText('المتبقي')).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'الأدوات المالية العامة' }),
    );
    expect(onOpenGeneral).toHaveBeenCalledOnce();
  });

  it('keeps zone finance unavailable to non-finance admin roles', () => {
    render(<AdminFinanceWorkspace token={token} role="operations_admin" />);

    expect(
      screen.getByText('مساحة المالية غير متاحة لهذا الدور'),
    ).toBeVisible();
    expect(
      screen.queryByText('الأدوات المالية العامة'),
    ).not.toBeInTheDocument();
  });
});
