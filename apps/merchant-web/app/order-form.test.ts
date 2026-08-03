import { describe, expect, it } from 'vitest';

import {
  buildQuoteRequestPayload,
  normalizeEgyptianOrderPhone,
  orderApiError,
  type OrderFormInput,
  validateOrderForm,
} from './order-form';

const validInput: OrderFormInput = {
  addressLine: 'شارع الجلاء بجوار البنك',
  apartment: '',
  buildingNumber: '',
  category: 'documents',
  courierNotes: '',
  declaredValue: '100',
  floor: '',
  fragile: false,
  itemDescription: 'مستندات تعاقد',
  landmark: '',
  latitude: '31.4321',
  locationConfirmed: true,
  locationEligibility: 'INSIDE',
  locationSource: 'MAP_PICKER',
  longitude: '31.8273',
  packageCount: '1',
  packageSize: 'small',
  prohibitedItemsConfirmed: true,
  customerName: 'عميل تجريبي',
  customerPhone: '010 1000 0001',
  saveAddress: false,
  serviceZoneCity: 'دمياط',
  serviceZoneGovernorate: 'دمياط',
  serviceZoneName: 'دمياط التجريبية',
  sourceMapsUrl: '',
  storeCoverageStatus: 'INSIDE_ACTIVE_ZONE',
  storeId: '10000000-0000-4000-8000-000000000001',
  street: '',
  thermalBag: false,
  weightKg: '1',
};

describe('merchant canonical order form', () => {
  it('builds the customer and dropoff contracts from one contact representation', () => {
    const payload = buildQuoteRequestPayload(validInput);

    expect(payload.customer).toEqual({
      name: 'عميل تجريبي',
      phone: '+201010000001',
    });
    expect(payload.dropoff).toMatchObject({
      contactName: payload.customer.name,
      contactPhone: payload.customer.phone,
      latitude: 31.4321,
      longitude: 31.8273,
    });
    expect(payload.package).toMatchObject({
      weightGrams: 1_000,
      packageCount: 1,
      declaredValueMinor: 10_000,
    });
    expect(JSON.stringify(payload)).not.toContain('email');
  });

  it('omits empty optional address and note values instead of sending blanks', () => {
    const payload = buildQuoteRequestPayload(validInput);

    expect(payload.dropoff).not.toHaveProperty('street');
    expect(payload.dropoff).not.toHaveProperty('buildingNumber');
    expect(payload.dropoff).not.toHaveProperty('floor');
    expect(payload.dropoff).not.toHaveProperty('apartment');
    expect(payload.dropoff).not.toHaveProperty('landmark');
    expect(payload.dropoff).not.toHaveProperty('deliveryNotes');
    expect(payload.package).not.toHaveProperty('courierNotes');
  });

  it('normalizes supported Egyptian mobile formats', () => {
    expect(normalizeEgyptianOrderPhone('010-1000-0001')).toBe('+201010000001');
    expect(normalizeEgyptianOrderPhone('00201010000001')).toBe('+201010000001');
  });

  it('returns Arabic field errors and focuses the first invalid field', () => {
    const result = validateOrderForm({
      ...validInput,
      addressLine: '',
      locationConfirmed: false,
      customerName: '',
      customerPhone: '',
      storeId: '',
    });

    expect(result.firstInvalidField).toBe('storeId');
    expect(result.errors).toMatchObject({
      storeId: 'فرع الاستلام مطلوب.',
      customerPhone: 'رقم الموبايل مطلوب.',
      addressLine: 'العنوان النصي مطلوب.',
      location: 'يرجى تحديد موقع التسليم على الخريطة.',
    });
  });

  it('keeps optional address details empty without blocking submission', () => {
    expect(validateOrderForm(validInput).errors).toEqual({});
  });

  it('maps structured API validation and service-zone failures to Arabic', () => {
    const validation = orderApiError(
      Object.assign(new Error('The request data is invalid.'), {
        code: 'validation_failed',
        fields: {
          'customer.phone': 'Invalid string',
          'dropoff.addressLine': 'Too small',
        },
      }),
    );
    expect(validation.errors).toEqual({
      customerPhone: 'رقم الموبايل غير صحيح.',
      addressLine: 'العنوان النصي غير صحيح.',
    });
    expect(validation.summary).not.toContain('The request data is invalid');

    const route = orderApiError(
      Object.assign(new Error('route exceeds limit'), {
        code: 'order_route_distance_exceeded',
      }),
    );
    expect(route.errors.location).toContain('الحد الأقصى');

    const mismatch = orderApiError(
      Object.assign(new Error('zone mismatch'), {
        code: 'order_pickup_delivery_zone_mismatch',
      }),
    );
    expect(mismatch.errors.location).toBe(
      'فرع الاستلام وموقع التسليم غير مشمولين داخل منطقة خدمة واحدة.',
    );

    const missingPricing = orderApiError(
      Object.assign(new Error('missing pricing'), {
        code: 'order_service_zone_pricing_unavailable',
      }),
    );
    expect(missingPricing.errors.location).toBe(
      'منطقة الخدمة المحددة لا تحتوي على قاعدة تسعير نشطة حالياً.',
    );
  });
});
