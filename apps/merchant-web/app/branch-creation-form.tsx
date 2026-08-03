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

export type BranchCreationInput = {
  active: true;
  addressDetails: string;
  addressLine: string;
  area: string;
  city: string;
  governorate: string;
  latitude: number;
  longitude: number;
  name: string;
  phone: string;
  sourceMapsUrl?: string;
  street: string;
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
  normalizedUrl: string;
  originalUrl: string;
  status: 'COORDINATES_FOUND' | 'MANUAL_SELECTION_REQUIRED';
  latitude: number | null;
  longitude: number | null;
  userMessage: string | null;
  validation: LocationValidation | null;
};

type BranchDraft = {
  addressDetails: string;
  area: string;
  city: string;
  governorate: string;
  latitude: string;
  longitude: string;
  mapsUrl: string;
  name: string;
  phone: string;
  street: string;
};

export function canManageBranches(role: 'OWNER' | 'MANAGER' | 'STAFF') {
  return role === 'OWNER' || role === 'MANAGER';
}

export function branchCreationErrorMessage(error: unknown) {
  const locationMessage = locationRequestErrorMessage(error);
  if (
    error instanceof TypeError ||
    /[\u0600-\u06ff]/u.test(error instanceof Error ? error.message : '')
  ) {
    return locationMessage;
  }
  return 'تعذر إنشاء الفرع. راجع البيانات وحاول مرة أخرى.';
}

export function resolvedBranchMapPoint(
  resolved: Pick<ResolvedMapsLink, 'latitude' | 'longitude'>,
  currentPoint: MapPoint | null,
  fallbackPoint: MapPoint,
) {
  if (resolved.latitude !== null && resolved.longitude !== null) {
    return {
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
  }
  return currentPoint ?? fallbackPoint;
}

export function BranchCreationForm({
  fallbackPoint,
  onCancel,
  onCreate,
  onResolveMapsLink,
  onValidateLocation,
}: {
  fallbackPoint: MapPoint;
  onCancel: () => void;
  onCreate: (input: BranchCreationInput) => Promise<void>;
  onResolveMapsLink: (value: string) => Promise<ResolvedMapsLink>;
  onValidateLocation: (point: MapPoint) => Promise<LocationValidation>;
}) {
  const [draft, setDraft] = useState<BranchDraft>({
    addressDetails: '',
    area: '',
    city: 'دمياط',
    governorate: 'دمياط',
    latitude: fallbackPoint.latitude.toFixed(6),
    longitude: fallbackPoint.longitude.toFixed(6),
    mapsUrl: '',
    name: '',
    phone: '',
    street: '',
  });
  const [eligibility, setEligibility] =
    useState<LocationEligibility>('UNVALIDATED');
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [serviceZoneName, setServiceZoneName] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingMapPoint, setPendingMapPoint] =
    useState<MapPoint>(fallbackPoint);
  const [mapGuidance, setMapGuidance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const numericPoint = {
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
  };
  const validPoint =
    Number.isFinite(numericPoint.latitude) &&
    numericPoint.latitude >= -90 &&
    numericPoint.latitude <= 90 &&
    Number.isFinite(numericPoint.longitude) &&
    numericPoint.longitude >= -180 &&
    numericPoint.longitude <= 180;
  const selectedPoint = validPoint ? numericPoint : null;
  const canSubmit = canRequestQuote(locationConfirmed, eligibility);

  function change(fields: Partial<BranchDraft>, invalidatesLocation = false) {
    setDraft((current) => ({ ...current, ...fields }));
    if (invalidatesLocation) {
      setLocationConfirmed(false);
      setEligibility('UNVALIDATED');
      setServiceZoneName('');
    }
  }

  async function confirmPoint(point: MapPoint) {
    setBusy(true);
    setError('');
    try {
      const validation = await onValidateLocation(point);
      change({
        latitude: point.latitude.toFixed(6),
        longitude: point.longitude.toFixed(6),
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

  function openMap(point = selectedPoint ?? fallbackPoint, guidance = '') {
    setPendingMapPoint(point);
    setMapGuidance(guidance);
    setMapOpen(true);
    setError('');
  }

  async function resolveMapsLink() {
    const mapsUrl = draft.mapsUrl.trim();
    if (!mapsUrl) {
      setError('الصق رابط Google Maps أولاً.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const resolved = await onResolveMapsLink(mapsUrl);
      setPendingMapPoint(
        resolvedBranchMapPoint(
          resolved,
          locationConfirmed ? selectedPoint : null,
          fallbackPoint,
        ),
      );
      setMapGuidance(
        resolved.status === 'MANUAL_SELECTION_REQUIRED'
          ? (resolved.userMessage ?? manualMapsLinkMessage)
          : '',
      );
      setMapOpen(true);
    } catch (caught) {
      setError(locationRequestErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function validateManualCoordinates() {
    if (!selectedPoint) {
      setError('أدخل إحداثيات صحيحة قبل التحقق.');
      return;
    }
    await confirmPoint(selectedPoint);
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
        const point = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setBusy(false);
        openMap(
          point,
          'راجع موقع الجهاز على الخريطة وحرك العلامة إلى مدخل الفرع ثم أكد النقطة.',
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!selectedPoint || !locationConfirmed) {
      setError('حدد موقع الفرع على الخريطة وأكد النقطة أولاً.');
      return;
    }
    if (!canSubmit) {
      setError(outsideServiceZoneMessage);
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        active: true,
        addressDetails: draft.addressDetails.trim(),
        addressLine: [
          draft.street,
          draft.addressDetails,
          draft.area,
          draft.city,
          draft.governorate,
        ]
          .map((value) => value.trim())
          .filter(Boolean)
          .join('، '),
        area: draft.area.trim(),
        city: draft.city.trim(),
        governorate: draft.governorate.trim(),
        latitude: selectedPoint.latitude,
        longitude: selectedPoint.longitude,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        ...(draft.mapsUrl.trim()
          ? { sourceMapsUrl: draft.mapsUrl.trim() }
          : {}),
        street: draft.street.trim(),
      });
      onCancel();
    } catch (caught) {
      setError(branchCreationErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel branch-creation-card"
      aria-labelledby="new-branch-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">فرع إضافي لنفس حساب التاجر</p>
          <h3 id="new-branch-title">إضافة فرع جديد</h3>
        </div>
        <button className="text-button" onClick={onCancel} type="button">
          إلغاء
        </button>
      </div>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label>
          اسم الفرع
          <input
            minLength={2}
            required
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <label>
          رقم هاتف الفرع
          <input
            dir="ltr"
            inputMode="tel"
            placeholder="01000000000"
            required
            value={draft.phone}
            onChange={(event) => change({ phone: event.target.value })}
          />
        </label>
        <label>
          المحافظة
          <input
            minLength={2}
            required
            value={draft.governorate}
            onChange={(event) => change({ governorate: event.target.value })}
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
          العنوان التفصيلي
          <input
            minLength={5}
            required
            value={draft.addressDetails}
            onChange={(event) => change({ addressDetails: event.target.value })}
          />
        </label>
        <div className="span-2 branch-location-block">
          <div className="section-heading">
            <div>
              <strong>موقع الفرع ونطاق الخدمة</strong>
              <p className="location-explanation">
                يجب مراجعة النقطة والتأكد من وجود الفرع داخل نطاق خدمة نشط.
              </p>
            </div>
            <div className="button-row">
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
          </div>
          <div className="maps-link-row">
            <label>
              لصق رابط Google Maps
              <input
                dir="ltr"
                placeholder="https://www.google.com/maps/... أو https://maps.app.goo.gl/..."
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
            <summary>متقدم: إدخال إحداثيات الفرع يدوياً</summary>
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
                disabled={busy}
                onClick={() => void validateManualCoordinates()}
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
                <button
                  className="text-button"
                  onClick={() => openMap(selectedPoint)}
                  type="button"
                >
                  تعديل النقطة
                </button>
              </div>
            </div>
          )}
        </div>
        {error && <p className="notice error span-2">{error}</p>}
        <div className="button-row span-2">
          <button className="primary" disabled={busy || !canSubmit}>
            حفظ الفرع الجديد
          </button>
          <button className="secondary" onClick={onCancel} type="button">
            إلغاء
          </button>
        </div>
      </form>
      {mapOpen && (
        <MapPicker
          guidance={mapGuidance}
          initialPoint={pendingMapPoint}
          onCancel={() => setMapOpen(false)}
          onConfirm={confirmPoint}
          storePoint={fallbackPoint}
          title="اختيار موقع الفرع الجديد"
        />
      )}
    </section>
  );
}
