'use client';

import { useState, type FormEvent } from 'react';

import {
  canRequestQuote,
  insideServiceZoneMessage,
  locationRequestErrorMessage,
  manualMapsLinkMessage,
  outsideServiceZoneMessage,
  type LocationEligibility,
} from './location-selection';
import { MapPicker, OpenMapPreview } from './map-picker';
import type { MapPoint } from './open-map';

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
  validation: LocationValidation | null;
};

export type MerchantRegistrationPayload = {
  ownerFullName: string;
  phone: string;
  password: string;
  passwordConfirmation: string;
  business: {
    name: string;
    category: string;
    contactPhone: string;
    email?: string;
  };
  firstBranch: {
    name: string;
    phone: string;
    governorate: string;
    city: string;
    area: string;
    street: string;
    addressDetails: string;
    addressLine: string;
    sourceMapsUrl?: string;
    latitude: number;
    longitude: number;
  };
};

type RegistrationDraft = {
  ownerFullName: string;
  phone: string;
  password: string;
  passwordConfirmation: string;
  businessName: string;
  businessCategory: string;
  contactPhone: string;
  email: string;
  branchName: string;
  branchPhone: string;
  governorate: string;
  city: string;
  area: string;
  street: string;
  addressDetails: string;
  mapsUrl: string;
  latitude: string;
  longitude: string;
};

export function validPilotPassword(password: string) {
  return (
    password.length >= 10 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

export function merchantRegistrationErrorMessage(error: unknown) {
  if (error instanceof TypeError) {
    return 'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.';
  }
  const message = error instanceof Error ? error.message : '';
  return /[\u0600-\u06ff]/u.test(message)
    ? message
    : 'تعذر إرسال طلب التسجيل. راجع البيانات وحاول مرة أخرى.';
}

export function MerchantRegistrationForm({
  fallbackPoint,
  onCancel,
  onResolveMapsLink,
  onSubmit,
  onValidateLocation,
}: {
  fallbackPoint: MapPoint;
  onCancel: () => void;
  onResolveMapsLink: (value: string) => Promise<ResolvedMapsLink>;
  onSubmit: (payload: MerchantRegistrationPayload) => Promise<void>;
  onValidateLocation: (point: MapPoint) => Promise<LocationValidation>;
}) {
  const [draft, setDraft] = useState<RegistrationDraft>({
    ownerFullName: '',
    phone: '',
    password: '',
    passwordConfirmation: '',
    businessName: '',
    businessCategory: 'متجر تجزئة',
    contactPhone: '',
    email: '',
    branchName: 'الفرع الرئيسي',
    branchPhone: '',
    governorate: 'دمياط',
    city: 'دمياط',
    area: '',
    street: '',
    addressDetails: '',
    mapsUrl: '',
    latitude: fallbackPoint.latitude.toFixed(6),
    longitude: fallbackPoint.longitude.toFixed(6),
  });
  const [eligibility, setEligibility] =
    useState<LocationEligibility>('UNVALIDATED');
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [serviceZoneName, setServiceZoneName] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingPoint, setPendingPoint] = useState(fallbackPoint);
  const [mapGuidance, setMapGuidance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const point = {
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
  };
  const validPoint =
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180;
  const selectedPoint = validPoint ? point : null;
  const canSubmit = canRequestQuote(locationConfirmed, eligibility);

  function change(
    fields: Partial<RegistrationDraft>,
    invalidatesLocation = false,
  ) {
    setDraft((current) => ({ ...current, ...fields }));
    if (invalidatesLocation) {
      setLocationConfirmed(false);
      setEligibility('UNVALIDATED');
      setServiceZoneName('');
    }
  }

  function openMap(nextPoint = selectedPoint ?? fallbackPoint, guidance = '') {
    setPendingPoint(nextPoint);
    setMapGuidance(guidance);
    setMapOpen(true);
    setError('');
  }

  async function confirmPoint(nextPoint: MapPoint) {
    setBusy(true);
    setError('');
    try {
      const validation = await onValidateLocation(nextPoint);
      change({
        latitude: nextPoint.latitude.toFixed(6),
        longitude: nextPoint.longitude.toFixed(6),
      });
      setLocationConfirmed(true);
      setEligibility(validation.supported ? 'INSIDE' : 'OUTSIDE');
      setServiceZoneName(validation.serviceZone?.name ?? '');
      setMapOpen(false);
    } catch (caught) {
      setError(locationRequestErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function useCurrentLocation() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation?.getCurrentPosition
    ) {
      setError('تحديد موقع الجهاز غير متاح في هذا المتصفح.');
      return;
    }
    setBusy(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        openMap(
          {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          'راجع موقع الجهاز وحرك العلامة إلى مدخل الفرع الأول ثم أكد النقطة.',
        );
      },
      () => {
        setBusy(false);
        setError(
          'تعذر الوصول إلى موقع الجهاز. اسمح بالوصول أو حدد الموقع على الخريطة.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
    );
  }

  async function resolveMapsLink() {
    if (!draft.mapsUrl.trim()) {
      setError('الصق رابط Google Maps أولاً.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resolved = await onResolveMapsLink(draft.mapsUrl.trim());
      setPendingPoint(
        resolved.latitude !== null && resolved.longitude !== null
          ? {
              latitude: resolved.latitude,
              longitude: resolved.longitude,
            }
          : (selectedPoint ?? fallbackPoint),
      );
      setMapGuidance(
        resolved.status === 'MANUAL_SELECTION_REQUIRED'
          ? (resolved.userMessage ?? manualMapsLinkMessage)
          : '',
      );
      setMapOpen(true);
    } catch (caught) {
      setError(merchantRegistrationErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!validPilotPassword(draft.password)) {
      setError(
        'كلمة المرور يجب أن تكون 10 أحرف على الأقل وتحتوي حرفاً كبيراً وصغيراً ورقماً.',
      );
      return;
    }
    if (draft.password !== draft.passwordConfirmation) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }
    if (!selectedPoint || !locationConfirmed) {
      setError('حدد موقع الفرع الأول على الخريطة وأكد النقطة.');
      return;
    }
    if (!canSubmit) {
      setError(outsideServiceZoneMessage);
      return;
    }

    setBusy(true);
    try {
      const addressLine = [
        draft.street,
        draft.addressDetails,
        draft.area,
        draft.city,
        draft.governorate,
      ]
        .map((value) => value.trim())
        .filter(Boolean)
        .join('، ');
      await onSubmit({
        ownerFullName: draft.ownerFullName.trim(),
        phone: draft.phone.trim(),
        password: draft.password,
        passwordConfirmation: draft.passwordConfirmation,
        business: {
          name: draft.businessName.trim(),
          category: draft.businessCategory.trim(),
          contactPhone: draft.contactPhone.trim(),
          ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
        },
        firstBranch: {
          name: draft.branchName.trim(),
          phone: (draft.branchPhone || draft.contactPhone).trim(),
          governorate: draft.governorate.trim(),
          city: draft.city.trim(),
          area: draft.area.trim(),
          street: draft.street.trim(),
          addressDetails: draft.addressDetails.trim(),
          addressLine,
          ...(draft.mapsUrl.trim()
            ? { sourceMapsUrl: draft.mapsUrl.trim() }
            : {}),
          latitude: selectedPoint.latitude,
          longitude: selectedPoint.longitude,
        },
      });
    } catch (caught) {
      setError(merchantRegistrationErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="registration-card"
      aria-labelledby="merchant-registration-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">تسجيل تجريبي بكلمة مرور</p>
          <h2 id="merchant-registration-title">إنشاء حساب تاجر جديد</h2>
        </div>
        <button className="text-button" onClick={onCancel} type="button">
          العودة لتسجيل الدخول
        </button>
      </div>
      <p className="notice">
        التسجيل متاح للبرنامج التجريبي فقط. لن تتمكن من إنشاء طلبات قبل مراجعة
        الحساب واعتماده.
      </p>
      <form
        className="registration-form"
        onSubmit={(event) => void submit(event)}
      >
        <fieldset>
          <legend>بيانات الحساب</legend>
          <div className="form-grid">
            <label>
              الاسم الكامل للمالك
              <input
                minLength={3}
                required
                value={draft.ownerFullName}
                onChange={(event) =>
                  change({ ownerFullName: event.target.value })
                }
              />
            </label>
            <label>
              رقم الموبايل المصري
              <input
                dir="ltr"
                inputMode="tel"
                minLength={11}
                required
                value={draft.phone}
                onChange={(event) => change({ phone: event.target.value })}
              />
            </label>
            <label>
              كلمة المرور
              <input
                dir="ltr"
                minLength={10}
                required
                type="password"
                value={draft.password}
                onChange={(event) => change({ password: event.target.value })}
              />
            </label>
            <label>
              تأكيد كلمة المرور
              <input
                dir="ltr"
                minLength={10}
                required
                type="password"
                value={draft.passwordConfirmation}
                onChange={(event) =>
                  change({ passwordConfirmation: event.target.value })
                }
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>بيانات النشاط</legend>
          <div className="form-grid">
            <label>
              اسم النشاط أو التاجر
              <input
                minLength={2}
                required
                value={draft.businessName}
                onChange={(event) =>
                  change({ businessName: event.target.value })
                }
              />
            </label>
            <label>
              فئة النشاط
              <select
                required
                value={draft.businessCategory}
                onChange={(event) =>
                  change({ businessCategory: event.target.value })
                }
              >
                <option>متجر تجزئة</option>
                <option>مطعم</option>
                <option>صيدلية</option>
                <option>مخبوزات وحلويات</option>
                <option>مستندات وشحنات</option>
                <option>أخرى</option>
              </select>
            </label>
            <label>
              رقم التواصل
              <input
                dir="ltr"
                inputMode="tel"
                minLength={11}
                required
                value={draft.contactPhone}
                onChange={(event) =>
                  change({ contactPhone: event.target.value })
                }
              />
            </label>
            <label>
              البريد الإلكتروني — اختياري
              <input
                dir="ltr"
                type="email"
                value={draft.email}
                onChange={(event) => change({ email: event.target.value })}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>الفرع الأول</legend>
          <div className="form-grid">
            <label>
              اسم الفرع
              <input
                minLength={2}
                required
                value={draft.branchName}
                onChange={(event) => change({ branchName: event.target.value })}
              />
            </label>
            <label>
              هاتف الفرع — اتركه فارغاً لاستخدام رقم التواصل
              <input
                dir="ltr"
                inputMode="tel"
                value={draft.branchPhone}
                onChange={(event) =>
                  change({ branchPhone: event.target.value })
                }
              />
            </label>
            <label>
              المحافظة
              <input
                minLength={2}
                required
                value={draft.governorate}
                onChange={(event) =>
                  change({ governorate: event.target.value })
                }
              />
            </label>
            <label>
              المدينة
              <input
                minLength={2}
                required
                value={draft.city}
                onChange={(event) => change({ city: event.target.value })}
              />
            </label>
            <label>
              المنطقة
              <input
                minLength={2}
                required
                value={draft.area}
                onChange={(event) => change({ area: event.target.value })}
              />
            </label>
            <label>
              الشارع
              <input
                minLength={2}
                required
                value={draft.street}
                onChange={(event) => change({ street: event.target.value })}
              />
            </label>
            <label className="span-2">
              العنوان النصي الكامل والتفاصيل
              <input
                minLength={5}
                required
                value={draft.addressDetails}
                onChange={(event) =>
                  change({ addressDetails: event.target.value })
                }
              />
            </label>
          </div>

          <div className="location-actions">
            <button
              className="secondary"
              onClick={() => openMap()}
              type="button"
            >
              تحديد موقع الفرع على الخريطة
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={useCurrentLocation}
              type="button"
            >
              استخدام موقعي الحالي
            </button>
          </div>
          <div className="maps-link-row">
            <label>
              لصق رابط Google Maps
              <input
                dir="ltr"
                placeholder="https://www.google.com/maps/..."
                value={draft.mapsUrl}
                onChange={(event) => change({ mapsUrl: event.target.value })}
              />
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void resolveMapsLink()}
              type="button"
            >
              فتح الرابط وتحديد الموقع
            </button>
          </div>
          <details className="manual-coordinates">
            <summary>متقدم: إدخال الإحداثيات يدوياً</summary>
            <div className="form-grid">
              <label>
                خط العرض
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={draft.latitude}
                  onChange={(event) =>
                    change({ latitude: event.target.value }, true)
                  }
                />
              </label>
              <label>
                خط الطول
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={draft.longitude}
                  onChange={(event) =>
                    change({ longitude: event.target.value }, true)
                  }
                />
              </label>
              <button
                className="secondary"
                disabled={busy || !selectedPoint}
                onClick={() =>
                  selectedPoint ? void confirmPoint(selectedPoint) : undefined
                }
                type="button"
              >
                التحقق من الإحداثيات
              </button>
            </div>
          </details>
          {locationConfirmed && selectedPoint && (
            <div
              className={`selected-location-card${
                eligibility === 'OUTSIDE' ? ' outside-zone' : ''
              }`}
            >
              <OpenMapPreview point={selectedPoint} />
              <div>
                <strong>{serviceZoneName || 'لا يوجد نطاق خدمة مطابق'}</strong>
                <p dir="ltr">
                  {selectedPoint.latitude.toFixed(6)},{' '}
                  {selectedPoint.longitude.toFixed(6)}
                </p>
                <p
                  className={`notice ${
                    eligibility === 'INSIDE' ? 'success' : 'error'
                  }`}
                >
                  {eligibility === 'INSIDE'
                    ? insideServiceZoneMessage
                    : outsideServiceZoneMessage}
                </p>
              </div>
            </div>
          )}
        </fieldset>

        {error && <p className="notice error">{error}</p>}
        <button
          className="primary registration-submit"
          disabled={busy || !canSubmit}
        >
          إرسال طلب التسجيل للمراجعة
        </button>
      </form>
      {mapOpen && (
        <MapPicker
          guidance={mapGuidance}
          initialPoint={pendingPoint}
          onCancel={() => setMapOpen(false)}
          onConfirm={confirmPoint}
          storePoint={fallbackPoint}
          title="اختيار موقع الفرع الأول"
        />
      )}
    </section>
  );
}
