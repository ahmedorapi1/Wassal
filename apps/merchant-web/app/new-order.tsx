'use client';

import { useState, type FormEvent } from 'react';

import {
  canRequestQuote,
  insideServiceZoneMessage,
  locationRequestErrorMessage,
  manualMapsLinkMessage,
  outsideServiceZoneMessage,
} from './location-selection';
import { MapPicker, OpenMapPreview } from './map-picker';
import {
  buildQuoteRequestPayload,
  orderApiError,
  type OrderFormErrors,
  type OrderFormField,
  type OrderFormInput,
  type OrderLocationSource,
  type QuoteRequestPayload,
  validateOrderForm,
} from './order-form';
import { googleMapsUrl, type MapPoint } from './open-map';
import {
  quoteInputFingerprint,
  quoteMatchesInput,
  type QuoteFingerprintInput,
} from './quote-input';

type Store = {
  id: string;
  name: string;
  phone: string | null;
  addressLine: string;
  city: string;
  area: string;
  status: 'ACTIVE' | 'INACTIVE';
  coverageStatus?:
    'INSIDE_ACTIVE_ZONE' | 'OUTSIDE_ACTIVE_ZONES' | 'NO_LOCATION';
  latitude: number | null;
  longitude: number | null;
};

type Customer = {
  id: string;
  name: string;
  normalizedPhone: string;
  status: 'ACTIVE' | 'ARCHIVED';
};

type AddressSnapshot = {
  addressLine: string;
  latitude: number;
  longitude: number;
  locationSource?: OrderLocationSource | 'STORE';
  sourceMapsUrl?: string | null;
};

type Quote = {
  id: string;
  version: number;
  distanceMeters: number;
  durationSeconds: number;
  baseFeeMinor: number;
  distanceChargeMinor: number;
  packageSurchargeMinor: number;
  weightSurchargeMinor: number;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  discountMinor: number;
  taxMinor: number;
  merchantTotalMinor: number;
  currency: string;
  customerSnapshot: { name: string; normalizedPhone: string };
  pickupAddressSnapshot: AddressSnapshot;
  dropoffAddressSnapshot: AddressSnapshot;
  pricingRuleVersion: number;
};

type LocationValidation = {
  supported: boolean;
  serviceZone: {
    id: string;
    name: string;
    city: string;
    governorate: string;
  } | null;
};

type ResolvedMapsLink = {
  status: 'COORDINATES_FOUND' | 'MANUAL_SELECTION_REQUIRED';
  latitude: number | null;
  longitude: number | null;
  userMessage: string | null;
};

const defaultMapPoint = { latitude: 31.41754, longitude: 31.81444 };

const locationSourceLabels: Record<OrderLocationSource | 'STORE', string> = {
  SAVED_ADDRESS: 'عنوان محفوظ',
  MAP_PICKER: 'اختيار على الخريطة',
  DEVICE_LOCATION: 'موقع الجهاز لمرة واحدة',
  GOOGLE_MAPS_LINK: 'رابط Google Maps',
  MANUAL_COORDINATES: 'إحداثيات يدوية متقدمة',
  STORE: 'موقع المتجر',
};

const money = (minor: number, currency = 'EGP') =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
  }).format(minor / 100);

function debugOrderLocation(
  event: 'merchant.order.location.confirmed' | 'merchant.order.quote.request',
  details: Record<string, unknown>,
) {
  if (process.env.NODE_ENV !== 'development') return;
  console.debug(`[SKKA] ${event}`, details);
}

function FieldError({
  errors,
  field,
}: {
  errors: OrderFormErrors;
  field: OrderFormField;
}) {
  const message = errors[field];
  return message ? (
    <small className="field-error" id={`order-${field}-error`}>
      {message}
    </small>
  ) : null;
}

function fieldErrorProps(errors: OrderFormErrors, field: OrderFormField) {
  return {
    'aria-describedby': errors[field] ? `order-${field}-error` : undefined,
    'aria-invalid': Boolean(errors[field]),
    id: `order-${field}`,
  } as const;
}

export function NewOrder({
  stores,
  customers,
  quote,
  quoteFingerprint,
  createdOrder,
  secondsLeft,
  onSubmit,
  onConfirm,
  onResolveMapsLink,
  onValidateLocation,
  onInvalidateQuote,
  onOpenOrder,
  onReset,
}: {
  stores: Store[];
  customers: Customer[];
  quote?: Quote;
  quoteFingerprint?: string;
  createdOrder?: { id: string; orderNumber: string };
  secondsLeft: number;
  onSubmit: (body: QuoteRequestPayload, fingerprint: string) => Promise<void>;
  onConfirm: (fingerprint: string) => Promise<void>;
  onResolveMapsLink: (value: string) => Promise<ResolvedMapsLink>;
  onValidateLocation: (point: MapPoint) => Promise<LocationValidation>;
  onInvalidateQuote: () => void;
  onOpenOrder: (id: string) => void;
  onReset: () => void;
}) {
  const initialDraft = (): OrderFormInput => ({
    addressLine: '',
    apartment: '',
    buildingNumber: '',
    category: 'food',
    courierNotes: '',
    declaredValue: '100',
    floor: '',
    fragile: false,
    itemDescription: '',
    landmark: '',
    latitude: '',
    locationConfirmed: false,
    locationEligibility: 'UNVALIDATED',
    locationSource: 'MAP_PICKER',
    longitude: '',
    packageCount: '1',
    packageSize: 'small',
    prohibitedItemsConfirmed: false,
    customerName: '',
    customerPhone: '',
    saveAddress: false,
    serviceZoneCity: '',
    serviceZoneGovernorate: '',
    serviceZoneName: '',
    sourceMapsUrl: '',
    storeCoverageStatus: stores.find((store) => store.status === 'ACTIVE')
      ?.coverageStatus,
    storeId: stores.find((store) => store.status === 'ACTIVE')?.id ?? '',
    street: '',
    thermalBag: false,
    weightKg: '1',
  });

  const [draft, setDraft] = useState<OrderFormInput>(initialDraft);
  const [customerMode, setCustomerMode] = useState<'new' | 'saved'>('new');
  const [customerId, setCustomerId] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingMapPoint, setPendingMapPoint] = useState<MapPoint>();
  const [pendingMapSource, setPendingMapSource] =
    useState<OrderLocationSource>('MAP_PICKER');
  const [pendingMapsUrl, setPendingMapsUrl] = useState('');
  const [pendingMapGuidance, setPendingMapGuidance] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [formErrors, setFormErrors] = useState<OrderFormErrors>({});
  const [formSummary, setFormSummary] = useState('');
  const effectiveStoreId =
    draft.storeId ||
    stores.find((store) => store.status === 'ACTIVE')?.id ||
    '';
  const activeStore = stores.find((store) => store.id === effectiveStoreId);
  const storePoint =
    activeStore?.latitude !== null &&
    activeStore?.latitude !== undefined &&
    activeStore.longitude !== null &&
    activeStore.longitude !== undefined
      ? {
          latitude: activeStore.latitude,
          longitude: activeStore.longitude,
        }
      : undefined;
  const selectedPoint =
    draft.locationConfirmed &&
    Number.isFinite(Number(draft.latitude)) &&
    Number.isFinite(Number(draft.longitude))
      ? {
          latitude: Number(draft.latitude),
          longitude: Number(draft.longitude),
        }
      : undefined;

  const normalizedDraft: OrderFormInput = {
    ...draft,
    storeCoverageStatus: activeStore?.coverageStatus,
    storeId: effectiveStoreId,
  };
  const fingerprintInput: QuoteFingerprintInput = {
    addressIdentity: `temporary:${draft.locationSource}`,
    category: draft.category,
    customerIdentity: `${draft.customerName.trim()}:${draft.customerPhone.trim()}`,
    declaredValueMinor: Math.round(Number(draft.declaredValue || 0) * 100),
    fragile: draft.fragile,
    latitude: selectedPoint?.latitude ?? 0,
    longitude: selectedPoint?.longitude ?? 0,
    packageCount: Number(draft.packageCount || 0),
    packageSize: draft.packageSize,
    storeId: effectiveStoreId,
    thermalBag: draft.thermalBag,
    weightGrams: Math.round(Number(draft.weightKg || 0) * 1_000),
  };
  const currentFingerprint = quoteInputFingerprint(fingerprintInput);
  const freshQuote = quoteMatchesInput(quoteFingerprint, fingerprintInput);

  function change(fields: Partial<OrderFormInput>, invalidatesQuote = false) {
    setDraft((current) => ({ ...current, ...fields }));
    setFormSummary('');
    setFormErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(fields)) {
        delete next[key as OrderFormField];
      }
      return next;
    });
    if (invalidatesQuote) onInvalidateQuote();
  }

  function focusField(field?: OrderFormField) {
    if (!field) return;
    window.setTimeout(() => {
      document.getElementById(`order-${field}`)?.focus();
      document
        .getElementById(`order-${field}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function chooseCustomerMode(mode: 'new' | 'saved') {
    setCustomerMode(mode);
    if (mode === 'new') {
      setCustomerId('');
      change({ customerName: '', customerPhone: '' }, true);
      return;
    }
    const customer = customers.find(({ status }) => status === 'ACTIVE');
    setCustomerId(customer?.id ?? '');
    change(
      {
        customerName: customer?.name ?? '',
        customerPhone: customer?.normalizedPhone ?? '',
      },
      true,
    );
  }

  function chooseSavedCustomer(id: string) {
    const customer = customers.find(
      (candidate) => candidate.id === id && candidate.status === 'ACTIVE',
    );
    setCustomerId(customer?.id ?? '');
    change(
      {
        customerName: customer?.name ?? '',
        customerPhone: customer?.normalizedPhone ?? '',
      },
      true,
    );
  }

  async function confirmLocation(
    point: MapPoint,
    source: OrderLocationSource,
    sourceMapsUrl = '',
  ) {
    setLocationError('');
    debugOrderLocation('merchant.order.location.confirmed', {
      selectedStoreId: effectiveStoreId,
      branchLatitude: storePoint?.latitude ?? null,
      branchLongitude: storePoint?.longitude ?? null,
      deliveryLatitude: point.latitude,
      deliveryLongitude: point.longitude,
      selectedMapMarkerLatitude: point.latitude,
      selectedMapMarkerLongitude: point.longitude,
      locationSource: source,
    });
    try {
      const validation = await onValidateLocation(point);
      change(
        {
          latitude: point.latitude.toFixed(6),
          locationConfirmed: true,
          locationEligibility: validation.supported ? 'INSIDE' : 'OUTSIDE',
          locationSource: source,
          longitude: point.longitude.toFixed(6),
          serviceZoneCity: validation.serviceZone?.city ?? '',
          serviceZoneGovernorate: validation.serviceZone?.governorate ?? '',
          serviceZoneName: validation.serviceZone?.name ?? '',
          sourceMapsUrl,
        },
        true,
      );
      setMapOpen(false);
    } catch (error) {
      setLocationError(locationRequestErrorMessage(error));
      throw error;
    }
  }

  function openMap(
    source: OrderLocationSource,
    point = selectedPoint ?? storePoint ?? defaultMapPoint,
    guidance = '',
  ) {
    setPendingMapSource(source);
    setPendingMapPoint(point);
    setPendingMapsUrl(source === 'GOOGLE_MAPS_LINK' ? draft.sourceMapsUrl : '');
    setPendingMapGuidance(guidance);
    setMapOpen(true);
    setLocationError('');
  }

  function useCurrentLocation() {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('هذا المتصفح لا يدعم تحديد الموقع.');
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocationBusy(false);
        openMap('DEVICE_LOCATION', {
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      },
      (error) => {
        setLocationBusy(false);
        const messages: Record<number, string> = {
          1: 'تم رفض إذن الموقع. يمكنك اختيار الموقع على الخريطة بدلاً منه.',
          2: 'تعذر الحصول على الموقع الحالي.',
          3: 'انتهت مهلة الحصول على الموقع الحالي.',
        };
        setLocationError(messages[error.code] ?? 'تعذر تحديد الموقع الحالي.');
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }

  async function resolveMapsLink() {
    if (!draft.sourceMapsUrl.trim()) {
      setLocationError('الصق رابط Google Maps أولاً.');
      return;
    }
    setLocationBusy(true);
    setLocationError('');
    try {
      const originalUrl = draft.sourceMapsUrl.trim();
      const resolved = await onResolveMapsLink(originalUrl);
      const point =
        resolved.latitude !== null && resolved.longitude !== null
          ? {
              latitude: resolved.latitude,
              longitude: resolved.longitude,
            }
          : (selectedPoint ?? storePoint ?? defaultMapPoint);
      openMap(
        'GOOGLE_MAPS_LINK',
        point,
        resolved.status === 'MANUAL_SELECTION_REQUIRED'
          ? (resolved.userMessage ?? manualMapsLinkMessage)
          : '',
      );
      setPendingMapsUrl(originalUrl);
    } catch (error) {
      setLocationError(locationRequestErrorMessage(error));
    } finally {
      setLocationBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocationError('');
    const validation = validateOrderForm(normalizedDraft);
    if (Object.keys(validation.errors).length > 0) {
      setFormErrors(validation.errors);
      setFormSummary('تعذر متابعة الطلب. راجع الحقول الموضحة أدناه.');
      focusField(validation.firstInvalidField);
      return;
    }
    try {
      setFormErrors({});
      setFormSummary('');
      const payload = buildQuoteRequestPayload(normalizedDraft);
      debugOrderLocation('merchant.order.quote.request', {
        selectedStoreId: payload.storeId,
        branchLatitude: storePoint?.latitude ?? null,
        branchLongitude: storePoint?.longitude ?? null,
        deliveryLatitude: payload.dropoff.latitude,
        deliveryLongitude: payload.dropoff.longitude,
        selectedMapMarkerLatitude: selectedPoint?.latitude ?? null,
        selectedMapMarkerLongitude: selectedPoint?.longitude ?? null,
        locationSource: payload.dropoff.locationSource,
      });
      await onSubmit(payload, currentFingerprint);
    } catch (error) {
      const mapped = orderApiError(error);
      setFormErrors(mapped.errors);
      setFormSummary(mapped.summary);
      focusField(Object.keys(mapped.errors)[0] as OrderFormField | undefined);
    }
  }

  function resetForAnotherOrder() {
    setDraft(initialDraft());
    setCustomerMode('new');
    setCustomerId('');
    setFormErrors({});
    setFormSummary('');
    onReset();
  }

  if (createdOrder) {
    return (
      <section className="searching-card">
        <img src="/brand/skka-logo.png" alt="" />
        <span className="status-dot">تم إنشاء الطلب</span>
        <h2>{createdOrder.orderNumber}</h2>
        <p className="searching-status">جارٍ البحث عن مندوب</p>
        <p>تم حفظ الطلب بنجاح وإتاحته للمندوبين المؤهلين في نطاق الخدمة.</p>
        <div className="button-row">
          <button
            className="primary"
            onClick={() => onOpenOrder(createdOrder.id)}
          >
            عرض تفاصيل الطلب
          </button>
          <button className="secondary" onClick={resetForAnotherOrder}>
            إنشاء طلب آخر
          </button>
        </div>
      </section>
    );
  }

  if (quote) {
    const components = [
      ['الرسوم الأساسية', quote.baseFeeMinor],
      ['المسافة', quote.distanceChargeMinor],
      ['حجم الطرد', quote.packageSurchargeMinor],
      ['الوزن', quote.weightSurchargeMinor],
      ['قابل للكسر', quote.fragileSurchargeMinor],
      ['حقيبة حرارية', quote.thermalBagSurchargeMinor],
      ['الخصم', -quote.discountMinor],
      ['الضريبة', quote.taxMinor],
    ] as const;
    return (
      <section className="quote-layout">
        <div className="panel">
          <p className="eyebrow">عرض السعر الجديد</p>
          <h2>راجع الموقع والتكلفة قبل التأكيد</h2>
          {!freshQuote && (
            <p className="notice error">
              تغيرت بيانات الموقع أو التسعير. لا يمكن استخدام هذا العرض.
            </p>
          )}
          <div className="route-summary">
            <span>{(quote.distanceMeters / 1_000).toFixed(2)} كم تقريباً</span>
            <span>{Math.ceil(quote.durationSeconds / 60)} دقيقة تقريباً</span>
          </div>
          <div className="location-review">
            <h3>المراجعة النهائية للموقع</h3>
            <p>
              العميل: {quote.customerSnapshot.name} ·{' '}
              <span dir="ltr">{quote.customerSnapshot.normalizedPhone}</span>
            </p>
            <p>الاستلام: {quote.pickupAddressSnapshot.addressLine}</p>
            <p>التسليم: {quote.dropoffAddressSnapshot.addressLine}</p>
            <p>
              مصدر الموقع:{' '}
              {
                locationSourceLabels[
                  quote.dropoffAddressSnapshot.locationSource ??
                    draft.locationSource
                ]
              }
            </p>
            <OpenMapPreview point={quote.dropoffAddressSnapshot} />
            <a
              href={
                quote.dropoffAddressSnapshot.sourceMapsUrl ??
                googleMapsUrl(quote.dropoffAddressSnapshot)
              }
              rel="noreferrer"
              target="_blank"
            >
              فتح موقع التسليم
            </a>
          </div>
          <dl className="price-list">
            {components.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{money(value, quote.currency)}</dd>
              </div>
            ))}
            <div className="total">
              <dt>إجمالي التاجر</dt>
              <dd>{money(quote.merchantTotalMinor, quote.currency)}</dd>
            </div>
          </dl>
        </div>
        <aside className="panel quote-action">
          <span className={secondsLeft > 0 ? 'countdown' : 'countdown expired'}>
            {secondsLeft > 0
              ? `ينتهي خلال ${Math.floor(secondsLeft / 60)}:${String(
                  secondsLeft % 60,
                ).padStart(2, '0')}`
              : 'انتهت صلاحية العرض'}
          </span>
          <button
            className="primary"
            disabled={secondsLeft === 0 || !freshQuote}
            onClick={() => void onConfirm(currentFingerprint)}
          >
            تأكيد وإنشاء الطلب
          </button>
          <button
            className="secondary"
            onClick={onInvalidateQuote}
            type="button"
          >
            تعديل الموقع أو بيانات الطلب
          </button>
        </aside>
      </section>
    );
  }

  return (
    <>
      <form
        className="order-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {formSummary && (
          <div className="form-error-summary" role="alert">
            <strong>{formSummary}</strong>
            {Object.values(formErrors).length > 0 && (
              <ul>
                {[...new Set(Object.values(formErrors))].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <section className="panel">
          <p className="eyebrow">١ · بيانات الاستلام</p>
          <h2>فرع الاستلام</h2>
          <label>
            فرع الاستلام — إجباري
            <select
              {...fieldErrorProps(formErrors, 'storeId')}
              value={effectiveStoreId}
              onChange={(event) => {
                const store = stores.find(
                  (candidate) => candidate.id === event.target.value,
                );
                change(
                  {
                    storeCoverageStatus: store?.coverageStatus,
                    storeId: event.target.value,
                  },
                  true,
                );
              }}
            >
              <option value="">اختر فرع الاستلام</option>
              {stores
                .filter((store) => store.status === 'ACTIVE')
                .map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} · {store.area}
                  </option>
                ))}
            </select>
            <FieldError errors={formErrors} field="storeId" />
          </label>
          {activeStore && (
            <div className="pickup-store-summary">
              {storePoint && <OpenMapPreview point={storePoint} />}
              <div>
                <strong>{activeStore.name}</strong>
                <p>{activeStore.addressLine}</p>
                <p>
                  {activeStore.area}، {activeStore.city}
                </p>
                <p
                  className={`notice ${
                    activeStore.coverageStatus === 'INSIDE_ACTIVE_ZONE'
                      ? 'success'
                      : 'error'
                  }`}
                >
                  {activeStore.coverageStatus === 'INSIDE_ACTIVE_ZONE'
                    ? 'الفرع صالح للاستلام داخل نطاق الخدمة.'
                    : 'هذا الفرع غير صالح حالياً لإنشاء طلب داخل نطاق الخدمة.'}
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">٢ · بيانات العميل</p>
          <h2>بيانات العميل</h2>
          <fieldset className="customer-mode-selector">
            <legend>نوع العميل</legend>
            <label className="check">
              <input
                checked={customerMode === 'new'}
                name="customerMode"
                onChange={() => chooseCustomerMode('new')}
                type="radio"
              />
              عميل جديد
            </label>
            <label className="check">
              <input
                checked={customerMode === 'saved'}
                disabled={!customers.some(({ status }) => status === 'ACTIVE')}
                name="customerMode"
                onChange={() => chooseCustomerMode('saved')}
                type="radio"
              />
              عميل محفوظ
            </label>
          </fieldset>
          {customerMode === 'saved' && (
            <label className="saved-customer-select">
              اختيار عميل محفوظ — إجباري
              <select
                value={customerId}
                onChange={(event) => chooseSavedCustomer(event.target.value)}
              >
                {customers
                  .filter(({ status }) => status === 'ACTIVE')
                  .map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} · {customer.normalizedPhone}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <div className="form-grid">
            <label>
              اسم العميل — إجباري
              <input
                {...fieldErrorProps(formErrors, 'customerName')}
                autoComplete="name"
                readOnly={customerMode === 'saved'}
                value={draft.customerName}
                onChange={(event) =>
                  change({ customerName: event.target.value }, true)
                }
              />
              <FieldError errors={formErrors} field="customerName" />
            </label>
            <label>
              رقم الموبايل — إجباري
              <input
                {...fieldErrorProps(formErrors, 'customerPhone')}
                autoComplete="tel"
                dir="ltr"
                inputMode="tel"
                readOnly={customerMode === 'saved'}
                value={draft.customerPhone}
                onChange={(event) =>
                  change({ customerPhone: event.target.value }, true)
                }
              />
              <FieldError errors={formErrors} field="customerPhone" />
            </label>
          </div>
        </section>

        <section className="panel customer-location-section">
          <p className="eyebrow">٣ · عنوان التسليم</p>
          <h2>العنوان وموقع التسليم</h2>
          <label className="span-2">
            العنوان النصي الكامل — إجباري
            <input
              {...fieldErrorProps(formErrors, 'addressLine')}
              value={draft.addressLine}
              onChange={(event) => change({ addressLine: event.target.value })}
            />
            <small className="field-help">
              اكتب عنوانًا واضحًا يمكن للمندوب قراءته، بالإضافة إلى تحديد الموقع
              على الخريطة.
            </small>
            <FieldError errors={formErrors} field="addressLine" />
          </label>

          <div
            aria-describedby={
              formErrors.location ? 'order-location-error' : undefined
            }
            className="required-map-field"
          >
            <strong>موقع التسليم على الخريطة — إجباري</strong>
            <p>تُنشأ إحداثيات الموقع تلقائياً بعد تأكيد العلامة.</p>
            <div className="location-actions">
              <button
                className="primary"
                id="order-location"
                onClick={() => openMap('MAP_PICKER')}
                type="button"
              >
                اختيار الموقع على الخريطة
              </button>
              <button
                className="secondary"
                disabled={locationBusy}
                onClick={useCurrentLocation}
                type="button"
              >
                استخدام موقعي الحالي
              </button>
            </div>
            <FieldError errors={formErrors} field="location" />
          </div>

          <div className="maps-link-row">
            <label>
              رابط Google Maps — اختياري
              <input
                dir="ltr"
                placeholder="https://www.google.com/maps/... أو https://maps.app.goo.gl/..."
                value={draft.sourceMapsUrl}
                onChange={(event) =>
                  change(
                    {
                      locationConfirmed: false,
                      locationEligibility: 'UNVALIDATED',
                      locationSource: 'GOOGLE_MAPS_LINK',
                      sourceMapsUrl: event.target.value,
                    },
                    true,
                  )
                }
              />
            </label>
            <button
              className="secondary"
              disabled={locationBusy}
              onClick={() => void resolveMapsLink()}
              type="button"
            >
              استخراج ومراجعة الموقع
            </button>
          </div>

          {locationError && <p className="notice error">{locationError}</p>}
          {selectedPoint && (
            <div
              className={`selected-location-card${
                draft.locationEligibility === 'OUTSIDE' ? ' outside-zone' : ''
              }`}
            >
              <OpenMapPreview point={selectedPoint} />
              <div>
                <strong>تم اختيار موقع التسليم</strong>
                <p>
                  {draft.serviceZoneName || 'بانتظار التحقق'} ·{' '}
                  {locationSourceLabels[draft.locationSource]}
                </p>
                <p
                  className={`notice ${
                    draft.locationEligibility === 'INSIDE' ? 'success' : 'error'
                  }`}
                >
                  {draft.locationEligibility === 'INSIDE'
                    ? insideServiceZoneMessage
                    : outsideServiceZoneMessage}
                </p>
                <p className="generated-coordinates" dir="ltr">
                  {draft.latitude}, {draft.longitude}
                </p>
                <a
                  href={draft.sourceMapsUrl || googleMapsUrl(selectedPoint)}
                  rel="noreferrer"
                  target="_blank"
                >
                  فتح في Google Maps
                </a>
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() => openMap('MAP_PICKER')}
                    type="button"
                  >
                    تغيير الموقع
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      change(
                        {
                          latitude: '',
                          locationConfirmed: false,
                          locationEligibility: 'UNVALIDATED',
                          longitude: '',
                          serviceZoneCity: '',
                          serviceZoneGovernorate: '',
                          serviceZoneName: '',
                          sourceMapsUrl: '',
                        },
                        true,
                      )
                    }
                    type="button"
                  >
                    مسح الموقع
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="form-grid">
            <label>
              اسم الشارع — اختياري
              <input
                value={draft.street}
                onChange={(event) => change({ street: event.target.value })}
              />
            </label>
            <label>
              رقم المبنى — اختياري
              <input
                value={draft.buildingNumber}
                onChange={(event) =>
                  change({ buildingNumber: event.target.value })
                }
              />
            </label>
            <label>
              الدور — اختياري
              <input
                value={draft.floor}
                onChange={(event) => change({ floor: event.target.value })}
              />
            </label>
            <label>
              رقم الشقة — اختياري
              <input
                value={draft.apartment}
                onChange={(event) => change({ apartment: event.target.value })}
              />
            </label>
            <label>
              علامة مميزة — اختياري
              <input
                value={draft.landmark}
                onChange={(event) => change({ landmark: event.target.value })}
              />
            </label>
            <label className="span-2">
              ملاحظات للمندوب — اختياري
              <textarea
                value={draft.courierNotes}
                onChange={(event) =>
                  change({ courierNotes: event.target.value })
                }
              />
            </label>
            <label className="check span-2">
              <input
                checked={draft.saveAddress}
                onChange={(event) =>
                  change({ saveAddress: event.target.checked })
                }
                type="checkbox"
              />
              حفظ العنوان للمستلم — اختياري
            </label>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">٤ · تفاصيل الطلب</p>
          <h2>ما الذي سيتم توصيله؟</h2>
          <div className="form-grid">
            <label>
              الفئة — إجباري
              <select
                value={draft.category}
                onChange={(event) =>
                  change({ category: event.target.value }, true)
                }
              >
                <option value="food">طعام</option>
                <option value="groceries">بقالة</option>
                <option value="pharmacy">صيدلية</option>
                <option value="documents">مستندات</option>
                <option value="clothing">ملابس</option>
                <option value="gifts">هدايا</option>
                <option value="electronics_accessories">
                  ملحقات إلكترونية
                </option>
                <option value="spare_parts">قطع غيار</option>
                <option value="other">أخرى</option>
              </select>
            </label>
            <label>
              وصف مختصر — إجباري
              <input
                {...fieldErrorProps(formErrors, 'itemDescription')}
                value={draft.itemDescription}
                onChange={(event) =>
                  change({ itemDescription: event.target.value })
                }
              />
              <FieldError errors={formErrors} field="itemDescription" />
            </label>
            <label>
              الحجم — إجباري
              <select
                value={draft.packageSize}
                onChange={(event) =>
                  change({ packageSize: event.target.value }, true)
                }
              >
                <option value="small">صغير</option>
                <option value="medium">متوسط</option>
                <option value="large">كبير</option>
              </select>
            </label>
            <label>
              الوزن التقريبي بالكيلوجرام — إجباري
              <input
                {...fieldErrorProps(formErrors, 'weightKg')}
                max="25"
                min="0.1"
                step="0.1"
                type="number"
                value={draft.weightKg}
                onChange={(event) =>
                  change({ weightKg: event.target.value }, true)
                }
              />
              <FieldError errors={formErrors} field="weightKg" />
            </label>
            <label>
              عدد الطرود — إجباري
              <input
                {...fieldErrorProps(formErrors, 'packageCount')}
                max="20"
                min="1"
                type="number"
                value={draft.packageCount}
                onChange={(event) =>
                  change({ packageCount: event.target.value }, true)
                }
              />
              <FieldError errors={formErrors} field="packageCount" />
            </label>
            <label>
              القيمة المعلنة بالجنيه — إجباري
              <input
                {...fieldErrorProps(formErrors, 'declaredValue')}
                max="5000"
                min="0"
                type="number"
                value={draft.declaredValue}
                onChange={(event) =>
                  change({ declaredValue: event.target.value }, true)
                }
              />
              <FieldError errors={formErrors} field="declaredValue" />
            </label>
            <label className="check">
              <input
                checked={draft.fragile}
                onChange={(event) =>
                  change({ fragile: event.target.checked }, true)
                }
                type="checkbox"
              />
              قابل للكسر — اختياري
            </label>
            <label className="check">
              <input
                checked={draft.thermalBag}
                onChange={(event) =>
                  change({ thermalBag: event.target.checked }, true)
                }
                type="checkbox"
              />
              يحتاج حقيبة حرارية — اختياري
            </label>
            <label className="declaration span-2">
              <input
                {...fieldErrorProps(formErrors, 'prohibitedItemsConfirmed')}
                checked={draft.prohibitedItemsConfirmed}
                onChange={(event) =>
                  change({
                    prohibitedItemsConfirmed: event.target.checked,
                  })
                }
                type="checkbox"
              />
              تأكيد خلو الطلب من المواد المحظورة — إجباري
              <FieldError
                errors={formErrors}
                field="prohibitedItemsConfirmed"
              />
            </label>
          </div>
        </section>

        <section className="panel price-submit-panel">
          <p className="eyebrow">٥ · السعر والمسافة</p>
          <h2>احسب السعر من الموقع المحدد</h2>
          <p>
            يحسب الخادم المسافة والسعر تلقائياً بعد التحقق من الفرع وموقع
            التسليم وحد المسافة الفعلية.
          </p>
          <button
            className="primary submit-order"
            title={
              canRequestQuote(
                draft.locationConfirmed,
                draft.locationEligibility,
              )
                ? undefined
                : 'حدد موقع التسليم وراجعه أولاً.'
            }
          >
            حساب سعر التوصيل
          </button>
        </section>
      </form>

      {mapOpen && pendingMapPoint && (
        <MapPicker
          guidance={pendingMapGuidance}
          initialPoint={pendingMapPoint}
          onCancel={() => setMapOpen(false)}
          onConfirm={(point) =>
            confirmLocation(point, pendingMapSource, pendingMapsUrl)
          }
          storePoint={storePoint}
        />
      )}
    </>
  );
}

export type { QuoteRequestPayload };
