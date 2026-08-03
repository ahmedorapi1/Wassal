// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZonesView, type Zone } from './admin-app';
import { ServiceZoneMap } from './service-zone-map';

const activeZone: Zone = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'منطقة دمياط',
  governorate: 'دمياط',
  city: 'دمياط',
  status: 'ACTIVE',
  centerLatitude: 31.4165,
  centerLongitude: 31.8133,
  radiusKm: 12,
  allowedPickup: true,
  allowedDropoff: true,
  maximumRouteDistanceMeters: 30_000,
  priority: 10,
  version: 3,
  updatedAt: '2026-07-29T12:00:00.000Z',
  geometry: { type: 'MultiPolygon', coordinates: [] },
};

const inactiveZone: Zone = {
  ...activeZone,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'منطقة اختبار متوقفة',
  status: 'INACTIVE',
  version: 1,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderZones(overrides: Partial<Parameters<typeof ZonesView>[0]> = {}) {
  const props: Parameters<typeof ZonesView>[0] = {
    busy: false,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onToggle: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    zones: [activeZone, inactiveZone],
    ...overrides,
  };
  render(<ZonesView {...props} />);
  return props;
}

describe('actually rendered service-zone administration', () => {
  it('remeasures the real map viewport after opening and ResizeObserver changes', async () => {
    let bounds = { height: 500, width: 960 };
    let notifyResize: () => void = () => undefined;
    class TestResizeObserver {
      public constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }

      public disconnect() {}
      public observe() {}
      public unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains('zone-map-canvas')) {
          return {
            bottom: bounds.height,
            height: bounds.height,
            left: 0,
            right: bounds.width,
            top: 0,
            width: bounds.width,
            x: 0,
            y: 0,
            toJSON: () => undefined,
          };
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        };
      },
    );

    render(
      <ServiceZoneMap
        initialPoint={{ latitude: 31.41, longitude: 31.825 }}
        initialRadiusKm={25}
        onCancel={() => undefined}
        readOnly
      />,
    );
    const map = screen.getByRole('application', {
      name: 'خريطة منطقة الخدمة التفاعلية',
    });

    await waitFor(() => {
      expect(map).toHaveAttribute('data-map-ready', 'true');
      expect(map).toHaveAttribute('data-viewport-width', '960');
      expect(map).toHaveAttribute('data-viewport-height', '500');
      expect(Number(map.getAttribute('data-tile-count'))).toBeGreaterThan(0);
    });

    bounds = { height: 420, width: 640 };
    act(() => notifyResize());

    await waitFor(() => {
      expect(map).toHaveAttribute('data-viewport-width', '640');
      expect(map).toHaveAttribute('data-viewport-height', '420');
    });
  });

  it('renders accessible map, edit, status, and delete actions for every zone', () => {
    renderZones();

    for (const zone of [activeZone, inactiveZone]) {
      expect(
        screen.getByRole('button', {
          name: `عرض على الخريطة: ${zone.name}`,
        }),
      ).toHaveAttribute('title', 'عرض على الخريطة');
      expect(
        screen.getByRole('button', { name: `تعديل: ${zone.name}` }),
      ).toHaveAttribute('title', 'تعديل');
      expect(
        screen.getByRole('button', { name: `حذف: ${zone.name}` }),
      ).toHaveAttribute('title', 'حذف');
    }

    expect(
      screen.getByRole('button', { name: `إيقاف: ${activeZone.name}` }),
    ).toHaveAttribute('title', 'إيقاف');
    expect(
      screen.getByRole('button', { name: `تفعيل: ${inactiveZone.name}` }),
    ).toHaveAttribute('title', 'تفعيل');
  });

  it('requires permanent-delete confirmation and displays linked-reference rejection', async () => {
    const blockedMessage =
      'لا يمكن حذف منطقة الخدمة لأنها مرتبطة بفروع أو طلبات أو قواعد تسعير. يمكنك إيقافها بدلًا من حذفها.';
    const onDelete = vi.fn().mockRejectedValue(new Error(blockedMessage));
    renderZones({ onDelete });

    fireEvent.click(
      screen.getByRole('button', { name: `حذف: ${inactiveZone.name}` }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'حذف منطقة الخدمة',
    });
    expect(dialog).toHaveTextContent(
      'هل تريد حذف منطقة الخدمة نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.',
    );
    expect(within(dialog).getByRole('button', { name: 'إلغاء' })).toBeEnabled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'تأكيد الحذف' }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      blockedMessage,
    );
    expect(onDelete).toHaveBeenCalledWith(inactiveZone);
  });

  it('edits the same zone through the live map without creating a duplicate', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderZones({ onCreate, onUpdate });

    fireEvent.click(
      screen.getByRole('button', { name: `تعديل: ${activeZone.name}` }),
    );
    const editor = screen.getByRole('dialog', {
      name: 'تعديل منطقة الخدمة',
    });
    expect(within(editor).getByLabelText('اسم منطقة الخدمة')).toHaveValue(
      activeZone.name,
    );

    fireEvent.click(
      within(editor).getByRole('button', {
        name: 'تحديد مركز المنطقة على الخريطة',
      }),
    );
    const mapDialog = screen.getByRole('dialog', {
      name: 'تحديد مركز المنطقة على الخريطة',
    });
    const map = within(mapDialog).getByRole('application', {
      name: 'خريطة منطقة الخدمة التفاعلية',
    });
    expect(map).toHaveAttribute(
      'data-center-latitude',
      String(activeZone.centerLatitude),
    );
    expect(
      within(mapDialog).getByLabelText('اسحب علامة مركز منطقة الخدمة'),
    ).toBeVisible();
    expect(
      within(mapDialog).getByLabelText(
        `دائرة تغطية بنصف قطر ${activeZone.radiusKm} كيلومتر`,
      ),
    ).toBeVisible();

    fireEvent.change(
      within(mapDialog).getByLabelText('نصف قطر الخدمة بالكيلومتر'),
      { target: { value: '18.5' } },
    );
    fireEvent.change(
      within(mapDialog).getByLabelText('البحث عن مدينة أو حي أو عنوان'),
      { target: { value: '31.5, 31.8' } },
    );
    fireEvent.click(within(mapDialog).getByRole('button', { name: 'بحث' }));

    await waitFor(() => {
      expect(map).toHaveAttribute('data-center-latitude', '31.5');
      expect(map).toHaveAttribute('data-center-longitude', '31.8');
      expect(map).toHaveAttribute('data-radius-km', '18.5');
    });

    fireEvent.click(
      within(mapDialog).getByRole('button', {
        name: 'تأكيد المركز ونصف القطر',
      }),
    );
    fireEvent.click(
      within(editor).getByRole('button', { name: 'حفظ تعديلات المنطقة' }),
    );

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        activeZone,
        expect.objectContaining({
          centerLatitude: 31.5,
          centerLongitude: 31.8,
          radiusKm: 18.5,
        }),
      );
    });
    expect(onCreate).not.toHaveBeenCalled();
  });
});
