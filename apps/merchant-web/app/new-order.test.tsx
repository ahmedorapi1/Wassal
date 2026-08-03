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

import { NewOrder, type QuoteRequestPayload } from './new-order';

afterEach(cleanup);

const stores = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'فرع دمياط',
    phone: '+201010000001',
    addressLine: 'شارع الجلاء، دمياط',
    city: 'دمياط',
    area: 'وسط المدينة',
    status: 'ACTIVE' as const,
    coverageStatus: 'INSIDE_ACTIVE_ZONE' as const,
    latitude: 31.41754,
    longitude: 31.81444,
  },
];

const customers = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'عميل محفوظ تجريبي',
    normalizedPhone: '+201011223344',
    status: 'ACTIVE' as const,
  },
];
const savedCustomer = customers[0]!;

function renderOrderForm() {
  return render(
    <NewOrder
      customers={customers}
      stores={stores}
      secondsLeft={0}
      onSubmit={vi.fn(async () => undefined)}
      onConfirm={vi.fn(async () => undefined)}
      onResolveMapsLink={vi.fn()}
      onValidateLocation={vi.fn()}
      onInvalidateQuote={vi.fn()}
      onOpenOrder={vi.fn()}
      onReset={vi.fn()}
    />,
  );
}

describe('actual Merchant Web new-order component', () => {
  it('renders the canonical new-customer fields once without legacy recipient or email fields', () => {
    renderOrderForm();

    expect(screen.getByLabelText('عميل جديد')).toBeChecked();
    expect(screen.getByLabelText('عميل محفوظ')).toBeEnabled();
    expect(screen.getAllByLabelText('اسم العميل — إجباري')).toHaveLength(1);
    expect(screen.getAllByLabelText('رقم الموبايل — إجباري')).toHaveLength(1);
    expect(
      screen.queryByLabelText(/البريد الإلكتروني/),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/اسم المستلم/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/هاتف المستلم/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('اسم العميل — إجباري')).not.toHaveAttribute(
      'readonly',
    );
    expect(screen.getByLabelText('اسم العميل — إجباري')).toHaveValue('');
    expect(screen.getByLabelText('رقم الموبايل — إجباري')).toHaveValue('');
  });

  it('populates the same one visible name and phone source in saved-customer mode', () => {
    renderOrderForm();

    fireEvent.click(screen.getByLabelText('عميل محفوظ'));

    expect(screen.getByLabelText('عميل محفوظ')).toBeChecked();
    expect(screen.getByLabelText('اختيار عميل محفوظ — إجباري')).toHaveValue(
      savedCustomer.id,
    );
    expect(screen.getAllByLabelText('اسم العميل — إجباري')).toHaveLength(1);
    expect(screen.getAllByLabelText('رقم الموبايل — إجباري')).toHaveLength(1);
    expect(screen.getByLabelText('اسم العميل — إجباري')).toHaveValue(
      savedCustomer.name,
    );
    expect(screen.getByLabelText('رقم الموبايل — إجباري')).toHaveValue(
      savedCustomer.normalizedPhone,
    );
    expect(screen.getByLabelText('اسم العميل — إجباري')).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByLabelText('رقم الموبايل — إجباري')).toHaveAttribute(
      'readonly',
    );
    expect(
      screen.queryByLabelText(/البريد الإلكتروني/),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/اسم المستلم/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/هاتف المستلم/)).not.toBeInTheDocument();
  });

  it('sends the confirmed rendered-map marker as latitude then longitude', async () => {
    const onSubmit = vi.fn(
      async (_body: QuoteRequestPayload, _fingerprint: string) => undefined,
    );
    const onValidateLocation = vi.fn(async () => ({
      supported: true,
      serviceZone: {
        id: '80000000-0000-4000-8000-000000000001',
        name: 'منطقة دمياط',
        city: 'دمياط',
        governorate: 'دمياط',
      },
    }));
    const { container } = render(
      <NewOrder
        customers={customers}
        stores={stores}
        secondsLeft={0}
        onSubmit={onSubmit}
        onConfirm={vi.fn(async () => undefined)}
        onResolveMapsLink={vi.fn()}
        onValidateLocation={onValidateLocation}
        onInvalidateQuote={vi.fn()}
        onOpenOrder={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(container.querySelector('#order-customerName')!, {
      target: { value: 'عميل إحداثيات' },
    });
    fireEvent.change(container.querySelector('#order-customerPhone')!, {
      target: { value: '01010000001' },
    });
    fireEvent.change(container.querySelector('#order-addressLine')!, {
      target: { value: 'عنوان اختبار إحداثيات كامل' },
    });
    fireEvent.change(container.querySelector('#order-itemDescription')!, {
      target: { value: 'مستندات اختبار' },
    });
    fireEvent.click(
      container.querySelector('#order-prohibitedItemsConfirmed')!,
    );
    fireEvent.click(container.querySelector('#order-location')!);
    fireEvent.click(
      container.querySelector('.map-dialog .button-row .primary')!,
    );

    await waitFor(() => expect(onValidateLocation).toHaveBeenCalledTimes(1));
    fireEvent.click(container.querySelector('.submit-order')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(onValidateLocation).toHaveBeenCalledWith({
      latitude: 31.41754,
      longitude: 31.81444,
    });
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      storeId: stores[0]!.id,
      dropoff: {
        latitude: 31.41754,
        longitude: 31.81444,
        locationSource: 'MAP_PICKER',
      },
    });
  });
});
