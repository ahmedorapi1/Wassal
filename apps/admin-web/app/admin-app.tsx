'use client';

import { useCallback, useState, type FormEvent } from 'react';

import skkaLogo from '../../../logo.png';
import { AdminFinanceWorkspace } from './admin-finance-workspace';
import {
  CourierVerificationWorkspace,
  OrdersByZoneWorkspace,
  PricingOperationsWorkspace,
} from './admin-operations-workspaces';
import { fetchAuthorizedCourierDocument } from './private-document';
import { PhaseFourOperations } from './phase-four-operations';
import { ServiceZoneMap, type ZoneMapPoint } from './service-zone-map';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
const defaultPricingEffectiveFrom = new Date(Date.now() + 3_600_000)
  .toISOString()
  .slice(0, 16);

type Token = { accessToken: string };
type AdminUser = { role: string; displayName: string };
type Snapshot = Record<string, unknown>;
type Dashboard = {
  ordersCreatedToday: number;
  ordersByStatus: Record<string, number>;
  cancelledOrders: number;
  quoteConversionRate: number;
  expiredQuotes: number;
  ordersByZone: Array<{ zoneId: string; zoneName: string; orders: number }>;
};
type Order = {
  id: string;
  orderNumber: string;
  status: string;
  version: number;
  acceptanceExpiresAt?: string | null;
  dispatchAttemptCount?: number;
  merchantTotalMinor: number;
  currency: string;
  createdAt: string;
  updatedAt?: string;
  customerSnapshot: Snapshot;
  pickupAddressSnapshot: Snapshot;
  dropoffAddressSnapshot: Snapshot;
  packageSnapshot: Snapshot;
  routeSnapshot: Snapshot;
  pricingSnapshot: Snapshot;
  pricingVersion: number;
  merchant: { id: string; displayName: string };
  store: { id: string; name: string; status?: string };
  serviceZone: { id: string; name: string; status?: string };
  customer?: { name: string; normalizedPhone: string } | null;
  courier?: {
    id: string;
    fullName: string;
    user?: { displayName: string; phone: string };
  } | null;
  deliveryDispute?: {
    status: string;
    merchantReason: string;
    merchantNote: string | null;
    courierResponse: string | null;
    resolutionNote: string | null;
    createdAt: string;
    resolvedAt: string | null;
  } | null;
  deliveredAt?: string | null;
  deliveryDisputeDeadlineAt?: string | null;
  deliveryFailureReason?: string | null;
  deliveryFailureNote?: string | null;
  returnReportedAt?: string | null;
  returnConfirmedAt?: string | null;
  returnCondition?: string | null;
  cancelledAt?: string | null;
  cancellationReasonCode?: string | null;
  cancellationDetails?: string | null;
  cancelledByRole?: string | null;
  cancelledAfterPickup?: boolean;
  cancellationChargeMinor?: number;
  financialFinalizedAt?: string | null;
  platformCommissionMinor?: number;
  cancelledBy?: {
    id: string;
    displayName: string | null;
    role: string;
  } | null;
  courierLedgerEntries?: Array<{
    id: string;
    type: string;
    amountMinor: number;
    currency: string;
    occurredAt: string;
  }>;
  events?: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string;
    internalMessage: string | null;
    merchantMessage: string | null;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
    actor?: { displayName: string; role: string } | null;
  }>;
  audit?: Array<{
    id: string;
    action: string;
    actorRole: string | null;
    actorId: string | null;
    entityType?: string;
    entityId?: string;
    createdAt: string;
  }>;
};
export type Zone = {
  id: string;
  name: string;
  governorate: string;
  city: string;
  status: 'ACTIVE' | 'INACTIVE';
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  allowedPickup: boolean;
  allowedDropoff: boolean;
  maximumRouteDistanceMeters: number;
  priority: number;
  version: number;
  updatedAt: string;
  geometry: { type: string; coordinates: unknown };
};
export type ZoneFormInput = {
  name: string;
  governorate: string;
  city: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  maximumRouteDistanceKm: number;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE';
};
type PricingRule = {
  id: string;
  ruleFamilyKey: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  city: string;
  governorate: string;
  serviceZoneId: string | null;
  vehicleType: string;
  currency: string;
  baseFeeMinor: number;
  includedDistanceMeters: number;
  perKilometerMinor: number;
  minimumFeeMinor: number;
  maximumDistanceMeters: number;
  smallPackageSurchargeMinor: number;
  mediumPackageSurchargeMinor: number;
  largePackageSurchargeMinor: number;
  weightBands: Array<{ upToGrams: number; surchargeMinor: number }>;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  waitingFeePerMinuteMinor: number;
  returnTripBaseMinor: number;
  commissionType: 'PERCENTAGE' | 'FIXED';
  commissionValue: number;
  taxBasisPoints: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  createdAt: string;
  createdBy: { displayName: string; role: string | null } | null;
  serviceZone: { id: string; name: string } | null;
};
type CourierDocument = {
  id: string;
  type: string;
  status: string;
  reviewVersion: number;
  originalFilename: string;
  reviewNotes: string | null;
  isCurrent: boolean;
};
type Courier = {
  id: string;
  fullName: string;
  verificationStatus: string;
  preferredCity: string | null;
  version: number;
  user: { phone: string; status: string };
  documents?: CourierDocument[];
  vehicles?: Array<{ id: string; plateNumber: string; active: boolean }>;
  _count?: { documents: number; vehicles: number };
};
type Merchant = {
  id: string;
  displayName: string;
  legalName: string;
  businessCategory: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  status: string;
  version: number;
  _count: { stores: number; memberships: number };
  stores?: Array<{
    id: string;
    name: string;
    phone: string | null;
    addressLine: string;
    governorate: string | null;
    city: string;
    area: string;
    street: string | null;
    addressDetails: string | null;
    latitude: number | null;
    longitude: number | null;
    status: string;
  }>;
  memberships?: Array<{
    id: string;
    role: string;
    active: boolean;
    user: {
      id: string;
      displayName: string | null;
      phone: string;
      status: string;
    };
  }>;
};
type Tab =
  | 'dashboard'
  | 'orders'
  | 'zones'
  | 'pricing'
  | 'couriers'
  | 'merchants'
  | 'finance'
  | 'disputes'
  | 'proofs'
  | 'operational-settings'
  | 'notifications';

async function request<T>(
  path: string,
  token?: Token,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token.accessToken}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { message?: string | { message?: string } };
  };
  if (!response.ok) {
    const raw = body.error?.message;
    throw new Error(
      typeof raw === 'string'
        ? raw
        : (raw?.message ?? 'تعذر تنفيذ الإجراء الإداري.'),
    );
  }
  return body;
}

const money = (minor: number) =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(minor / 100);

const orderStatus: Record<string, string> = {
  DRAFT: 'مسودة',
  QUOTED: 'تم التسعير',
  SEARCHING_COURIER: 'يبحث عن مندوب',
  NO_COURIER_AVAILABLE: 'لم يتوفر مندوب',
  NO_COURIER_AVAILABLE_FINAL: 'لم يتوفر مندوب بعد محاولتين',
  COURIER_ASSIGNED: 'قبله مندوب',
  COURIER_ARRIVING_PICKUP: 'في الطريق إلى الاستلام',
  AT_PICKUP: 'عند المتجر',
  PICKED_UP: 'تم الاستلام',
  IN_TRANSIT: 'في الطريق للعميل',
  AT_DROPOFF: 'عند العميل',
  DELIVERED: 'تم التسليم',
  DELIVERY_FAILED: 'تعذر التسليم',
  RETURNING_TO_STORE: 'في طريق العودة',
  RETURNED: 'أُعيد إلى المتجر',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
};

function idem(scope: string) {
  return `${scope}-${crypto.randomUUID()}`;
}

export function AdminApp() {
  const [phone, setPhone] = useState('01001000005');
  const [password, setPassword] = useState('AdminDemo123');
  const [token, setToken] = useState<Token>();
  const [adminUser, setAdminUser] = useState<AdminUser>();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [_orders, setOrders] = useState<Order[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [_pricing, setPricing] = useState<PricingRule[]>([]);
  const [_couriers, setCouriers] = useState<Courier[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order>();
  const [selectedCourier, setSelectedCourier] = useState<Courier>();
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant>();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (activeToken: Token, target: Tab) => {
    if (target === 'dashboard') {
      setDashboard(await request('/admin/phase-2/dashboard', activeToken));
    } else if (target === 'orders') {
      const page = await request<{ items: Order[] }>(
        '/admin/orders',
        activeToken,
      );
      setOrders(page.items);
    } else if (target === 'zones') {
      setZones(await request('/admin/service-zones', activeToken));
    } else if (target === 'pricing') {
      setPricing(await request('/admin/pricing-rules', activeToken));
    } else if (target === 'couriers') {
      setCouriers(await request('/admin/couriers', activeToken));
    } else if (target === 'merchants') {
      setMerchants(await request('/admin/merchants', activeToken));
    }
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await request<{ tokens: Token; user: AdminUser }>(
        '/auth/login',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify({ phone, password }),
        },
      );
      setToken(result.tokens);
      setAdminUser(result.user);
      await load(result.tokens, 'dashboard');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function navigate(next: Tab) {
    setTab(next);
    setSelectedOrder(undefined);
    setSelectedCourier(undefined);
    setSelectedMerchant(undefined);
    setError('');
    setMessage('');
    if (token) {
      setLoading(true);
      try {
        await load(token, next);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }

  async function openOrder(orderId: string) {
    if (!token) return;
    try {
      setSelectedOrder(await request<Order>(`/admin/orders/${orderId}`, token));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function cancelOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedOrder) return;
    const form = new FormData(event.currentTarget);
    try {
      const updated = await request<Order>(
        `/admin/orders/${selectedOrder.id}/cancel`,
        token,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idem('admin-cancel') },
          body: JSON.stringify({
            reasonCode: form.get('reasonCode'),
            details: form.get('details') || undefined,
            version: selectedOrder.version,
          }),
        },
      );
      setSelectedOrder(updated);
      setMessage('تم إلغاء الطلب وتسجيل قرار الإدارة.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function createZone(input: ZoneFormInput) {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      await request('/admin/service-zones', token, {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          countryCode: 'EG',
          governorate: input.governorate,
          city: input.city,
          centerLatitude: input.centerLatitude,
          centerLongitude: input.centerLongitude,
          radiusKm: input.radiusKm,
          allowedPickup: true,
          allowedDropoff: true,
          maximumRouteDistanceMeters: Math.round(
            input.maximumRouteDistanceKm * 1000,
          ),
          priority: input.priority,
        }),
      });
      setZones(await request('/admin/service-zones', token));
      setMessage(
        'تم إنشاء منطقة الخدمة بنجاح بحالة متوقفة حتى تتم مراجعتها وتفعيلها.',
      );
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }

  async function updateZone(zone: Zone, input: ZoneFormInput) {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      await request(`/admin/service-zones/${zone.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          name: input.name,
          countryCode: 'EG',
          governorate: input.governorate,
          city: input.city,
          centerLatitude: input.centerLatitude,
          centerLongitude: input.centerLongitude,
          radiusKm: input.radiusKm,
          maximumRouteDistanceMeters: Math.round(
            input.maximumRouteDistanceKm * 1000,
          ),
          priority: input.priority,
          status: input.status,
          version: zone.version,
        }),
      });
      setZones(await request('/admin/service-zones', token));
      setMessage('تم تحديث منطقة الخدمة نفسها بنجاح دون إنشاء منطقة مكررة.');
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }

  async function toggleZone(zone: Zone) {
    if (!token) return;
    const action = zone.status === 'ACTIVE' ? 'deactivate' : 'activate';
    setLoading(true);
    setError('');
    try {
      await request(`/admin/service-zones/${zone.id}/${action}`, token, {
        method: 'POST',
      });
      setZones(await request('/admin/service-zones', token));
      setMessage(
        zone.status === 'ACTIVE'
          ? 'تم إيقاف منطقة الخدمة. لن تستخدم للطلبات أو الفروع الجديدة.'
          : 'تم تفعيل منطقة الخدمة وأصبحت متاحة للتحقق من المواقع الجديدة.',
      );
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }

  async function deleteZone(zone: Zone) {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      await request<{ deleted: true; id: string }>(
        `/admin/service-zones/${zone.id}`,
        token,
        { method: 'DELETE' },
      );
      setZones(await request('/admin/service-zones', token));
      setMessage('تم حذف منطقة الخدمة نهائيًا بعد التأكد من عدم وجود مراجع.');
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }

  async function _createPricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    try {
      await request('/admin/pricing-rules', token, {
        method: 'POST',
        body: JSON.stringify({
          ruleFamilyKey: form.get('family'),
          countryCode: 'EG',
          governorate: form.get('governorate'),
          city: form.get('city'),
          serviceZoneId: form.get('serviceZoneId') || undefined,
          vehicleType: form.get('vehicleType'),
          currency: 'EGP',
          baseFeeMinor: Math.round(Number(form.get('baseFee')) * 100),
          includedDistanceMeters: Math.round(
            Number(form.get('includedDistanceKm')) * 1000,
          ),
          perKilometerMinor: Math.round(Number(form.get('perKm')) * 100),
          minimumFeeMinor: Math.round(Number(form.get('minimumFee')) * 100),
          maximumDistanceMeters: Math.round(
            Number(form.get('maximumDistanceKm')) * 1000,
          ),
          smallPackageSurchargeMinor: Math.round(
            Number(form.get('smallPackageSurcharge')) * 100,
          ),
          mediumPackageSurchargeMinor: Math.round(
            Number(form.get('mediumPackageSurcharge')) * 100,
          ),
          largePackageSurchargeMinor: Math.round(
            Number(form.get('largePackageSurcharge')) * 100,
          ),
          weightBands: [
            {
              upToGrams: Math.round(Number(form.get('weightLimit1')) * 1000),
              surchargeMinor: Math.round(
                Number(form.get('weightSurcharge1')) * 100,
              ),
            },
            {
              upToGrams: Math.round(Number(form.get('weightLimit2')) * 1000),
              surchargeMinor: Math.round(
                Number(form.get('weightSurcharge2')) * 100,
              ),
            },
            {
              upToGrams: Math.round(Number(form.get('weightLimit3')) * 1000),
              surchargeMinor: Math.round(
                Number(form.get('weightSurcharge3')) * 100,
              ),
            },
          ],
          fragileSurchargeMinor: Math.round(
            Number(form.get('fragileSurcharge')) * 100,
          ),
          thermalBagSurchargeMinor: Math.round(
            Number(form.get('thermalSurcharge')) * 100,
          ),
          waitingFeePerMinuteMinor: Math.round(
            Number(form.get('waitingFee')) * 100,
          ),
          returnTripBaseMinor: Math.round(
            Number(form.get('returnTripBase')) * 100,
          ),
          commissionType: form.get('commissionType'),
          commissionValue:
            form.get('commissionType') === 'PERCENTAGE'
              ? Math.round(Number(form.get('commissionPercent')) * 100)
              : Math.round(Number(form.get('commissionFixed')) * 100),
          taxBasisPoints: Math.round(Number(form.get('taxPercent')) * 100),
          effectiveFrom: new Date(
            String(form.get('effectiveFrom')),
          ).toISOString(),
          priority: Number(form.get('priority')),
        }),
      });
      setPricing(await request('/admin/pricing-rules', token));
      setMessage('تم إنشاء نسخة تسعير جديدة بحالة مسودة.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function _newPricingVersion(rule: PricingRule) {
    if (!token) return;
    try {
      await request(`/admin/pricing-rules/${rule.id}/new-version`, token, {
        method: 'POST',
        body: JSON.stringify({ effectiveFrom: new Date().toISOString() }),
      });
      setPricing(await request('/admin/pricing-rules', token));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function _togglePricing(rule: PricingRule) {
    if (!token) return;
    const action = rule.status === 'ACTIVE' ? 'deactivate' : 'activate';
    try {
      await request(`/admin/pricing-rules/${rule.id}/${action}`, token, {
        method: 'POST',
      });
      setPricing(await request('/admin/pricing-rules', token));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function _validateOverlaps() {
    if (!token) return;
    try {
      const overlaps = await request<unknown[]>(
        '/admin/pricing-rules/validate-overlaps',
        token,
        { method: 'POST', body: '{}' },
      );
      setMessage(
        overlaps.length === 0
          ? 'لا توجد قواعد نشطة متداخلة.'
          : `تم العثور على ${overlaps.length} تداخل يحتاج المراجعة.`,
      );
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function openCourier(courierId: string) {
    if (!token) return;
    try {
      setSelectedCourier(
        await request<Courier>(`/admin/couriers/${courierId}`, token),
      );
      setReason('');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function openMerchant(merchantId: string) {
    if (!token) return;
    try {
      setSelectedMerchant(
        await request<Merchant>(`/admin/merchants/${merchantId}`, token),
      );
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function _reviewDocument(
    document: CourierDocument,
    action: 'approve' | 'reject' | 'request-replacement',
  ) {
    if (!token || !selectedCourier) return;
    if (action !== 'approve' && reason.trim().length < 3) {
      setError('اكتب سبباً واضحاً للقرار.');
      return;
    }
    try {
      await request(
        `/admin/couriers/${selectedCourier.id}/documents/${document.id}/${action}`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            version: document.reviewVersion,
            ...(action === 'approve' ? {} : { reason }),
          }),
        },
      );
      await openCourier(selectedCourier.id);
      setMessage('تم حفظ قرار مراجعة المستند.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function _openCourierDocument(courierDocument: CourierDocument) {
    if (!token) return;
    const viewer = window.open('about:blank', '_blank');
    if (viewer) viewer.opener = null;
    try {
      const file = await fetchAuthorizedCourierDocument(
        apiUrl,
        courierDocument.id,
        token.accessToken,
      );
      const objectUrl = URL.createObjectURL(
        new Blob([file.blob], { type: file.contentType }),
      );
      if (viewer) {
        viewer.location.replace(objectUrl);
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (caught) {
      viewer?.close();
      setError((caught as Error).message);
    }
  }

  async function _transitionCourier(
    action: 'approve' | 'reject' | 'suspend' | 'reactivate',
  ) {
    if (!token || !selectedCourier) return;
    try {
      await request(`/admin/couriers/${selectedCourier.id}/${action}`, token, {
        method: 'POST',
        body: JSON.stringify({
          version: selectedCourier.version,
          ...(['reject', 'suspend'].includes(action) ? { reason } : {}),
        }),
      });
      setSelectedCourier(undefined);
      await load(token, 'couriers');
      setMessage('تم تحديث حالة المندوب.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function transitionMerchant(
    merchant: Merchant,
    action: 'approve' | 'reject' | 'request_changes' | 'suspend' | 'reactivate',
  ) {
    if (!token) return;
    const reasonRequired = ['reject', 'request_changes', 'suspend'].includes(
      action,
    );
    const merchantReason = reasonRequired
      ? window.prompt('اكتب سبب القرار الإداري:')
      : undefined;
    if (
      reasonRequired &&
      (!merchantReason || merchantReason.trim().length < 3)
    ) {
      setError('يتطلب هذا القرار سبباً واضحاً.');
      return;
    }
    try {
      await request(
        `/admin/merchants/${merchant.id}/${
          action === 'request_changes' ? 'request-changes' : action
        }`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            version: merchant.version,
            ...(merchantReason ? { reason: merchantReason } : {}),
          }),
        },
      );
      await load(token, 'merchants');
      setSelectedMerchant(
        await request<Merchant>(`/admin/merchants/${merchant.id}`, token),
      );
      setMessage('تم تحديث حالة التاجر وتسجيل القرار في سجل التدقيق.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  if (!token) {
    return (
      <main className="admin-login">
        <section className="login-panel">
          <img className="login-logo" src={skkaLogo.src} alt="شعار سِكّة" />
          <p className="kicker">بوابة تشغيل داخلية</p>
          <h1>تسجيل دخول الإدارة</h1>
          <p>إدارة الطلبات والمناطق والتسعير وسجلات التحقق في مساحة مدققة.</p>
          <form onSubmit={verify}>
            <label>
              رقم الموبايل
              <input
                dir="ltr"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
            <label>
              كلمة المرور
              <input
                dir="ltr"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button disabled={loading}>دخول لوحة العمليات</button>
          </form>
          <p>
            <a href="http://localhost:3002/privacy">الخصوصية</a> ·{' '}
            <a href="http://localhost:3002/terms">الشروط</a>
          </p>
          {error && <p className="alert">{error}</p>}
        </section>
        <aside className="security-note">
          <span>SKKA · OPERATIONS</span>
          <p>كل طلب له سكة</p>
          <h2>كل قرار تشغيلي موثق.</h2>
          <p>
            عروض الأسعار والطلبات ومناطق الخدمة تحتفظ بتاريخ واضح وقابل للتدقيق.
          </p>
        </aside>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <AdminNav tab={tab} setTab={navigate} />
      <main className="admin-main">
        <header className="dashboard-header">
          <div>
            <p className="kicker">المرحلة الثالثة</p>
            <h1>لوحة تشغيل سِكّة</h1>
            <p>
              سوق توصيل مباشر، دورة طلب كاملة، وتسويات أسبوعية قابلة للتدقيق.
            </p>
          </div>
          <span className="live-indicator">النظام يعمل</span>
        </header>
        {loading && <p className="alert success">جارٍ التحميل…</p>}
        {message && <p className="alert success">{message}</p>}
        {error && <p className="alert">{error}</p>}

        {tab === 'dashboard' && dashboard && (
          <DashboardView dashboard={dashboard} />
        )}
        {tab === 'orders' &&
          (selectedOrder ? (
            <OrderDetail
              order={selectedOrder}
              adminRole={adminUser?.role}
              onBack={() => setSelectedOrder(undefined)}
              onCancel={cancelOrder}
            />
          ) : (
            <OrdersByZoneWorkspace
              token={token}
              role={adminUser?.role}
              onOpen={openOrder}
            />
          ))}
        {tab === 'zones' && (
          <ZonesView
            busy={loading}
            zones={zones}
            onCreate={createZone}
            onDelete={deleteZone}
            onUpdate={updateZone}
            onToggle={toggleZone}
          />
        )}
        {tab === 'pricing' && (
          <PricingOperationsWorkspace token={token} role={adminUser?.role} />
        )}
        {tab === 'couriers' && <CourierVerificationWorkspace token={token} />}
        {tab === 'merchants' && (
          <>
            {selectedMerchant ? (
              <MerchantDetail
                merchant={selectedMerchant}
                onBack={() => setSelectedMerchant(undefined)}
                onTransition={(action) =>
                  void transitionMerchant(selectedMerchant, action)
                }
              />
            ) : (
              <MerchantsView
                merchants={merchants}
                onOpen={openMerchant}
                onTransition={transitionMerchant}
              />
            )}
          </>
        )}
        {tab === 'finance' && (
          <AdminFinanceWorkspace token={token} role={adminUser?.role} />
        )}
        {(
          [
            'disputes',
            'proofs',
            'operational-settings',
            'notifications',
          ] as Tab[]
        ).includes(tab) && (
          <PhaseFourOperations
            token={token}
            workspace={
              tab as
                'disputes' | 'proofs' | 'operational-settings' | 'notifications'
            }
          />
        )}
      </main>
    </div>
  );
}

function AdminNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: Array<[Tab, string]> = [
    ['dashboard', 'نظرة عامة'],
    ['orders', 'الطلبات'],
    ['zones', 'مناطق الخدمة'],
    ['pricing', 'قواعد التسعير'],
    ['couriers', 'توثيق المندوبين'],
    ['merchants', 'التجار'],
    ['finance', 'المالية والتسويات'],
    ['disputes', 'اعتراضات التسليم'],
    ['proofs', 'إثباتات الدفع'],
    ['operational-settings', 'إعدادات التشغيل'],
    ['notifications', 'الإشعارات'],
  ];
  return (
    <aside className="admin-nav">
      <div className="admin-brand">
        <img src={skkaLogo.src} alt="شعار سِكّة" />
        <strong>سِكّة</strong>
      </div>
      <p>إدارة العمليات</p>
      <nav>
        {items.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <small>Phase 3 · سوق مباشر بلا تتبع حي</small>
    </aside>
  );
}

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const cards = [
    ['طلبات اليوم', dashboard.ordersCreatedToday],
    ['تبحث عن مندوب', dashboard.ordersByStatus.SEARCHING_COURIER ?? 0],
    ['طلبات ملغاة', dashboard.cancelledOrders],
    ['عروض منتهية', dashboard.expiredQuotes],
    ['تحويل العروض', `${Math.round(dashboard.quoteConversionRate * 100)}%`],
  ];
  return (
    <>
      <section className="summary-grid phase-two-summary">
        {cards.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="admin-card table-card">
        <p className="kicker">التغطية</p>
        <h2>الطلبات حسب المنطقة</h2>
        {dashboard.ordersByZone.map((zone) => (
          <div className="metric-row" key={zone.zoneId}>
            <strong>{zone.zoneName}</strong>
            <span>{zone.orders} طلبات</span>
          </div>
        ))}
      </section>
    </>
  );
}

function _OrdersView({
  orders,
  onOpen,
}: {
  orders: Order[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="admin-card table-card">
      <div className="card-title">
        <div>
          <p className="kicker">التشغيل المبكر</p>
          <h2>كل الطلبات</h2>
        </div>
      </div>
      <div className="responsive-table order-admin-table">
        <div className="table-head">
          <span>الطلب</span>
          <span>التاجر / الفرع</span>
          <span>الاستلام والتسليم</span>
          <span>المندوب</span>
          <span>الحالة</span>
          <span>الإجمالي</span>
        </div>
        {orders.map((order) => (
          <article className="table-row" key={order.id}>
            <div>
              <strong dir="ltr">{order.orderNumber}</strong>
              <small>{new Date(order.createdAt).toLocaleString('ar-EG')}</small>
            </div>
            <span>
              {order.merchant.displayName} · {order.store.name}
            </span>
            <span>
              <strong>{order.customer?.name ?? 'عميل غير محفوظ'}</strong>
              <small dir="ltr">{order.customer?.normalizedPhone}</small>
              {snapshotText(order.pickupAddressSnapshot, 'label') ||
                order.store.name}
              {' ← '}
              {snapshotText(order.dropoffAddressSnapshot, 'addressLine1')}
              <small>
                {formatDistance(
                  snapshotNumber(order.routeSnapshot, 'distanceMeters'),
                )}
              </small>
              {(order.deliveryDispute || order.returnReportedAt) && (
                <small className="warning">
                  {order.deliveryDispute ? 'يوجد اعتراض' : ''}
                  {order.deliveryDispute && order.returnReportedAt ? ' · ' : ''}
                  {order.returnReportedAt ? 'يوجد إرجاع' : ''}
                </small>
              )}
            </span>
            <span>{order.courier?.fullName ?? 'غير معيّن'}</span>
            <span className={`state state-${order.status.toLowerCase()}`}>
              {orderStatus[order.status] ?? order.status}
            </span>
            <span>{money(order.merchantTotalMinor)}</span>
            <button onClick={() => onOpen(order.id)}>فتح</button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function OrderDetail({
  order,
  adminRole,
  onBack,
  onCancel,
}: {
  order: Order;
  adminRole?: string;
  onBack: () => void;
  onCancel: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const canSeeFinance = ['finance_admin', 'super_admin'].includes(
    adminRole ?? '',
  );
  const visiblePricingSnapshot = Object.fromEntries(
    Object.entries(order.pricingSnapshot).filter(
      ([key]) =>
        canSeeFinance ||
        (!key.toLowerCase().includes('commission') &&
          !key.toLowerCase().includes('courierearning')),
    ),
  );
  return (
    <>
      <button className="back" onClick={onBack}>
        → العودة إلى الطلبات
      </button>
      <header className="case-header">
        <div>
          <p className="kicker">سجل الطلب الكامل</p>
          <h1 dir="ltr">{order.orderNumber}</h1>
          <p>
            {order.merchant.displayName} · {order.store.name}
          </p>
        </div>
        <span className={`state state-${order.status.toLowerCase()}`}>
          {orderStatus[order.status] ?? order.status}
        </span>
      </header>
      <section className="admin-card order-overview">
        <div>
          <span>التاجر والفرع</span>
          <strong>
            {order.merchant.displayName} · {order.store.name}
          </strong>
        </div>
        <div>
          <span>العميل</span>
          <strong>{snapshotText(order.customerSnapshot, 'name')}</strong>
        </div>
        <div>
          <span>المندوب</span>
          <strong>{order.courier?.fullName ?? 'لم يُعيّن بعد'}</strong>
        </div>
        <div>
          <span>المسافة التقديرية</span>
          <strong>
            {formatDistance(
              snapshotNumber(order.routeSnapshot, 'distanceMeters'),
            )}
          </strong>
        </div>
        <div>
          <span>المدة التقديرية</span>
          <strong>
            {formatDuration(
              snapshotNumber(order.routeSnapshot, 'durationSeconds'),
            )}
          </strong>
        </div>
        <div>
          <span>الإجمالي</span>
          <strong>{money(order.merchantTotalMinor)}</strong>
        </div>
        <div>
          <span>منطقة الخدمة</span>
          <strong>{order.serviceZone.name}</strong>
        </div>
        <div>
          <span>تاريخ الإنشاء (القاهرة)</span>
          <strong>{formatDate(order.createdAt)}</strong>
        </div>
        <div>
          <span>آخر تحديث (القاهرة)</span>
          <strong>{formatDate(order.updatedAt)}</strong>
        </div>
        <div>
          <span>نسخة الطلب</span>
          <strong>{order.version}</strong>
        </div>
        <div>
          <span>محاولات نشر الطلب</span>
          <strong>{order.dispatchAttemptCount ?? 0} من 2</strong>
        </div>
        <div>
          <span>انتهاء مهلة القبول الحالية</span>
          <strong>{formatDate(order.acceptanceExpiresAt)}</strong>
        </div>
        <div>
          <span>حالة الاعتراض</span>
          <strong>{humanLabel(order.deliveryDispute?.status)}</strong>
        </div>
      </section>
      <section className="admin-card">
        <p className="kicker">التوزيع والإلغاء</p>
        <h2>محاولات البحث والأثر المالي</h2>
        <div className="readable-grid">
          <ReadableField
            label="عدد محاولات البحث"
            value={`${order.dispatchAttemptCount ?? 0} من 2`}
          />
          <ReadableField
            label="سبب الإلغاء"
            value={order.cancellationReasonCode}
          />
          <ReadableField
            label="تفاصيل الإلغاء"
            value={order.cancellationDetails}
          />
          <ReadableField
            label="وقت الإلغاء"
            value={formatDate(order.cancelledAt)}
          />
          <ReadableField
            label="من ألغى"
            value={
              order.cancelledBy?.displayName ??
              humanLabel(order.cancelledByRole)
            }
          />
          <ReadableField
            label="توقيت الإلغاء"
            value={
              order.cancelledAt
                ? order.cancelledAfterPickup
                  ? 'بعد استلام المندوب'
                  : 'قبل استلام المندوب'
                : '—'
            }
          />
          <ReadableField
            label="قيمة التوصيل المستحقة بسبب الإلغاء"
            value={money(order.cancellationChargeMinor ?? 0)}
          />
          <ReadableField
            label="القيد المالي الناتج"
            value={
              order.courierLedgerEntries?.length
                ? order.courierLedgerEntries
                    .map(
                      (entry) =>
                        `${humanLabel(entry.type)}: ${money(entry.amountMinor)}`,
                    )
                    .join(' · ')
                : order.cancelledAfterPickup
                  ? 'ينتظر تأكيد استلام المرتجع قبل تثبيت العمولة'
                  : 'لا يوجد قيد مالي'
            }
          />
        </div>
        <div className="readable-history">
          {order.events
            ?.filter((event) =>
              [
                'COURIER_SEARCH_REQUESTED',
                'COURIER_SEARCH_RESTARTED',
                'COURIER_SEARCH_EXPIRED',
                'COURIER_ACCEPTED',
              ].includes(event.eventType),
            )
            .map((event) => (
              <article key={`dispatch-${event.id}`}>
                <strong>{humanLabel(event.eventType)}</strong>
                <span>
                  المحاولة {String(event.metadata?.attempt ?? '—')} · النشر{' '}
                  {formatDate(metadataString(event.metadata, 'publishedAt'))} ·
                  الانتهاء{' '}
                  {formatDate(
                    metadataString(event.metadata, 'expiresAt') ??
                      metadataString(event.metadata, 'expiredAt'),
                  )}
                </span>
              </article>
            ))}
        </div>
      </section>
      <div className="case-grid">
        <section className="admin-card">
          <p className="kicker">بيانات الطلب المحفوظة</p>
          <h2>العميل والعناوين والطرد</h2>
          <ReadableSection title="العميل" value={order.customerSnapshot} />
          <ReadableLocation
            title="موقع الاستلام"
            value={order.pickupAddressSnapshot}
          />
          <ReadableLocation
            title="موقع التسليم"
            value={order.dropoffAddressSnapshot}
          />
          <ReadableSection title="بيانات الطرد" value={order.packageSnapshot} />
          <ReadableSection title="المسار" value={order.routeSnapshot} />
        </section>
        <aside>
          <section className="admin-card">
            <p className="kicker">التسعير</p>
            <h2>{money(order.merchantTotalMinor)}</h2>
            <p>نسخة القاعدة: {order.pricingVersion}</p>
            <ReadableSection
              title="تفصيل السعر"
              value={visiblePricingSnapshot}
            />
            {!canSeeFinance && (
              <p className="muted-note">
                تفاصيل العمولة والحسابات الداخلية متاحة لمسؤول المالية فقط.
              </p>
            )}
            {canSeeFinance && (
              <div className="finance-summary">
                <span>
                  العمولة:{' '}
                  {money(
                    snapshotNumber(
                      order.pricingSnapshot,
                      'platformCommissionMinor',
                    ),
                  )}
                </span>
                <span>
                  استحقاق المندوب:{' '}
                  {money(
                    snapshotNumber(
                      order.pricingSnapshot,
                      'estimatedCourierEarningMinor',
                    ),
                  )}
                </span>
              </div>
            )}
          </section>
          {[
            'DRAFT',
            'QUOTED',
            'SEARCHING_COURIER',
            'NO_COURIER_AVAILABLE',
            'NO_COURIER_AVAILABLE_FINAL',
            'COURIER_ASSIGNED',
            'COURIER_ARRIVING_PICKUP',
            'AT_PICKUP',
          ].includes(order.status) && (
            <form className="admin-card decision-card" onSubmit={onCancel}>
              <h2>إلغاء إداري</h2>
              <label>
                السبب
                <select name="reasonCode" defaultValue="operational_issue">
                  <option value="merchant_request">طلب التاجر</option>
                  <option value="suspected_fraud">اشتباه احتيال</option>
                  <option value="unsupported_item">طرد غير مدعوم</option>
                  <option value="service_area_issue">مشكلة منطقة الخدمة</option>
                  <option value="operational_issue">سبب تشغيلي</option>
                  <option value="duplicate_order">طلب مكرر</option>
                  <option value="other">آخر</option>
                </select>
              </label>
              <label>
                التفاصيل
                <textarea name="details" />
              </label>
              <input type="hidden" name="version" value={order.version} />
              <button className="danger">إلغاء الطلب</button>
            </form>
          )}
        </aside>
      </div>
      {(order.deliveryDispute ||
        order.deliveryFailureReason ||
        order.returnReportedAt) && (
        <section className="admin-card">
          <p className="kicker">الاستثناءات التشغيلية</p>
          <h2>النزاع أو فشل التسليم أو الإرجاع</h2>
          <div className="readable-grid">
            <ReadableField
              label="سبب فشل التسليم"
              value={order.deliveryFailureReason}
            />
            <ReadableField
              label="ملاحظة الفشل"
              value={order.deliveryFailureNote}
            />
            <ReadableField
              label="تم الإبلاغ عن الإرجاع"
              value={formatDate(order.returnReportedAt)}
            />
            <ReadableField
              label="تم تأكيد الإرجاع"
              value={formatDate(order.returnConfirmedAt)}
            />
            <ReadableField label="حالة المرتجع" value={order.returnCondition} />
            <ReadableField
              label="حالة الاعتراض"
              value={order.deliveryDispute?.status}
            />
            <ReadableField
              label="سبب الاعتراض"
              value={order.deliveryDispute?.merchantReason}
            />
            <ReadableField
              label="رد المندوب"
              value={order.deliveryDispute?.courierResponse}
            />
            <ReadableField
              label="قرار الإدارة"
              value={order.deliveryDispute?.resolutionNote}
            />
          </div>
        </section>
      )}
      <section className="admin-card timeline">
        <p className="kicker">السجل غير القابل للتعديل</p>
        <h2>الأحداث والتدقيق</h2>
        {order.events?.map((event) => (
          <div key={event.id}>
            <span className="timeline-dot" />
            <strong>{humanLabel(event.eventType)}</strong>
            <span>
              {event.actor?.displayName ?? humanLabel(event.actor?.role)}
              {event.fromStatus || event.toStatus
                ? ` · ${humanLabel(event.fromStatus)} ← ${humanLabel(
                    event.toStatus,
                  )}`
                : ''}
              {event.merchantMessage || event.internalMessage
                ? ` · ${event.merchantMessage ?? event.internalMessage}`
                : ''}
            </span>
            <time>{formatDate(event.createdAt)}</time>
          </div>
        ))}
        {order.audit?.map((entry) => (
          <div key={entry.id}>
            <span className="timeline-dot audit-dot" />
            <strong>{humanLabel(entry.action)}</strong>
            <span>
              {humanLabel(entry.actorRole)} ·{' '}
              {humanLabel(entry.entityType ?? 'DeliveryOrder')}
            </span>
            <time>{formatDate(entry.createdAt)}</time>
          </div>
        ))}
      </section>
    </>
  );
}

const fieldLabels: Record<string, string> = {
  name: 'الاسم',
  normalizedPhone: 'رقم الهاتف',
  phone: 'رقم الهاتف',
  label: 'الاسم المختصر',
  addressLine1: 'العنوان',
  addressLine2: 'تفاصيل العنوان',
  landmark: 'علامة مميزة',
  latitude: 'خط العرض',
  longitude: 'خط الطول',
  locationSource: 'مصدر الموقع',
  category: 'الفئة',
  packageSize: 'حجم الطرد',
  weightGrams: 'الوزن',
  itemCount: 'عدد القطع',
  fragile: 'قابل للكسر',
  thermalBagRequired: 'حقيبة حرارية',
  declaredValueMinor: 'القيمة المعلنة',
  distanceMeters: 'المسافة',
  durationSeconds: 'المدة',
  provider: 'مزود حساب المسار',
  baseFeeMinor: 'الرسم الأساسي',
  distanceChargeMinor: 'تكلفة المسافة',
  packageSurchargeMinor: 'إضافة حجم الطرد',
  weightSurchargeMinor: 'إضافة الوزن',
  fragileSurchargeMinor: 'إضافة قابل للكسر',
  thermalBagSurchargeMinor: 'إضافة الحقيبة الحرارية',
  discountMinor: 'الخصم',
  taxMinor: 'الضريبة',
  merchantTotalMinor: 'إجمالي التاجر',
  currency: 'العملة',
};

function humanLabel(value?: string | null) {
  if (!value) return '—';
  return (
    fieldLabels[value] ??
    value.replaceAll('.', ' ').replaceAll('_', ' ').toLocaleLowerCase('ar-EG')
  );
}

function snapshotText(snapshot: Snapshot, key: string) {
  const value = snapshot[key];
  return typeof value === 'string' && value ? value : '—';
}

function snapshotNumber(snapshot: Snapshot, key: string) {
  const value = snapshot[key];
  return typeof value === 'number' ? value : 0;
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function formatDistance(value: number) {
  return value > 0 ? `${(value / 1000).toFixed(1)} كم` : '—';
}

function formatDuration(value: number) {
  return value > 0 ? `${Math.max(1, Math.round(value / 60))} دقيقة` : '—';
}

function formatDate(value?: string | null) {
  return value
    ? new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })
    : '—';
}

function readableValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') {
    if (key.endsWith('Minor')) return money(value);
    if (key.toLowerCase().includes('distance')) return formatDistance(value);
    if (key.toLowerCase().includes('duration')) return formatDuration(value);
    if (key === 'weightGrams') return `${(value / 1000).toFixed(1)} كجم`;
    return new Intl.NumberFormat('ar-EG').format(value);
  }
  return humanLabel(String(value));
}

function ReadableField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="readable-field">
      <dt>{label}</dt>
      <dd>{readableValue('', value)}</dd>
    </div>
  );
}

function ReadableSection({ title, value }: { title: string; value: Snapshot }) {
  return (
    <section className="readable-section">
      <h3>{title}</h3>
      <dl className="readable-grid">
        {Object.entries(value)
          .filter(
            ([key, fieldValue]) =>
              !['id', 'providerMetadata'].includes(key) &&
              typeof fieldValue !== 'object',
          )
          .map(([key, fieldValue]) => (
            <div className="readable-field" key={key}>
              <dt>{fieldLabels[key] ?? humanLabel(key)}</dt>
              <dd>{readableValue(key, fieldValue)}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

function ReadableLocation({
  title,
  value,
}: {
  title: string;
  value: Snapshot;
}) {
  const latitude = snapshotNumber(value, 'latitude');
  const longitude = snapshotNumber(value, 'longitude');
  return (
    <section className="readable-section">
      <div className="card-title">
        <h3>{title}</h3>
        {latitude !== 0 && longitude !== 0 && (
          <a
            className="map-link"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${latitude},${longitude}`,
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            فتح الموقع على الخريطة
          </a>
        )}
      </div>
      <ReadableSection title="" value={value} />
    </section>
  );
}

export function ZonesView({
  busy,
  zones,
  onCreate,
  onDelete,
  onUpdate,
  onToggle,
}: {
  busy: boolean;
  zones: Zone[];
  onCreate: (input: ZoneFormInput) => Promise<void>;
  onDelete: (zone: Zone) => Promise<void>;
  onUpdate: (zone: Zone, input: ZoneFormInput) => Promise<void>;
  onToggle: (zone: Zone) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Zone | 'new'>();
  const [viewing, setViewing] = useState<Zone>();
  const [pendingToggle, setPendingToggle] = useState<Zone>();
  const [pendingDelete, setPendingDelete] = useState<Zone>();
  const [deleteError, setDeleteError] = useState('');

  return (
    <>
      <section className="admin-card zones-section">
        <div className="section-heading">
          <div>
            <p className="kicker">PostGIS · دوائر تغطية</p>
            <h2>مناطق الخدمة</h2>
          </div>
          <button
            className="approve"
            disabled={busy}
            onClick={() => setEditing('new')}
            type="button"
          >
            إضافة منطقة خدمة
          </button>
        </div>
        <p className="form-help">
          نصف قطر التغطية يحدد المواقع الجغرافية المقبولة، بينما الحد الأقصى
          لمسافة المسار يراجع طريق التوصيل الفعلي بصورة مستقلة.
        </p>
        <div className="zone-card-grid">
          {zones.map((zone) => (
            <article className="zone-card" key={zone.id}>
              <button
                className="zone-card-title"
                disabled={busy}
                onClick={() => setEditing(zone)}
                type="button"
              >
                {zone.name}
              </button>
              <span className={`state state-${zone.status.toLowerCase()}`}>
                {zone.status === 'ACTIVE' ? 'فعّالة' : 'متوقفة'}
              </span>
              <dl>
                <div>
                  <dt>المحافظة والمدينة</dt>
                  <dd>
                    {zone.governorate}
                    {zone.city ? ` · ${zone.city}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>نصف قطر الخدمة</dt>
                  <dd>{zone.radiusKm} كم</dd>
                </div>
                <div>
                  <dt>أقصى مسافة للمسار</dt>
                  <dd>{zone.maximumRouteDistanceMeters / 1000} كم</dd>
                </div>
                <div>
                  <dt>آخر تحديث</dt>
                  <dd>
                    {new Intl.DateTimeFormat('ar-EG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(zone.updatedAt))}
                  </dd>
                </div>
              </dl>
              <details>
                <summary>تفاصيل المركز</summary>
                <p dir="ltr">
                  {zone.centerLatitude.toFixed(6)},{' '}
                  {zone.centerLongitude.toFixed(6)}
                </p>
              </details>
              <div className="zone-card-actions">
                <button
                  aria-label={`عرض على الخريطة: ${zone.name}`}
                  disabled={busy}
                  onClick={() => setViewing(zone)}
                  title="عرض على الخريطة"
                  type="button"
                >
                  <span aria-hidden="true" className="zone-action-icon">
                    ⌖
                  </span>
                  <span>عرض على الخريطة</span>
                </button>
                <button
                  aria-label={`تعديل: ${zone.name}`}
                  disabled={busy}
                  onClick={() => setEditing(zone)}
                  title="تعديل"
                  type="button"
                >
                  <span aria-hidden="true" className="zone-action-icon">
                    ✎
                  </span>
                  <span>تعديل</span>
                </button>
                <button
                  aria-label={`${
                    zone.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'
                  }: ${zone.name}`}
                  className={zone.status === 'ACTIVE' ? 'reject' : 'approve'}
                  disabled={busy}
                  onClick={() => setPendingToggle(zone)}
                  title={zone.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
                  type="button"
                >
                  <span aria-hidden="true" className="zone-action-icon">
                    {zone.status === 'ACTIVE' ? 'Ⅱ' : '▶'}
                  </span>
                  <span>{zone.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}</span>
                </button>
                <button
                  aria-label={`حذف: ${zone.name}`}
                  className="delete-zone-action"
                  disabled={busy}
                  onClick={() => {
                    setDeleteError('');
                    setPendingDelete(zone);
                  }}
                  title="حذف"
                  type="button"
                >
                  <span aria-hidden="true" className="zone-action-icon">
                    🗑
                  </span>
                  <span>حذف</span>
                </button>
              </div>
            </article>
          ))}
        </div>
        {zones.length === 0 && (
          <p className="empty-state">لا توجد مناطق خدمة مسجلة بعد.</p>
        )}
      </section>

      {editing && (
        <ZoneEditor
          busy={busy}
          key={editing === 'new' ? 'new-zone' : editing.id}
          onCancel={() => setEditing(undefined)}
          onSave={async (input) => {
            if (editing === 'new') {
              await onCreate(input);
            } else {
              await onUpdate(editing, input);
            }
            setEditing(undefined);
          }}
          zone={editing === 'new' ? undefined : editing}
        />
      )}

      {viewing && (
        <ServiceZoneMap
          initialPoint={{
            latitude: viewing.centerLatitude,
            longitude: viewing.centerLongitude,
          }}
          initialRadiusKm={viewing.radiusKm}
          onCancel={() => setViewing(undefined)}
          readOnly
        />
      )}

      {pendingToggle && (
        <div className="zone-map-backdrop" role="presentation">
          <section
            aria-labelledby="zone-status-dialog-title"
            aria-modal="true"
            className="confirmation-dialog"
            role="dialog"
          >
            <h2 id="zone-status-dialog-title">
              {pendingToggle.status === 'ACTIVE'
                ? 'إيقاف منطقة الخدمة'
                : 'تفعيل منطقة الخدمة'}
            </h2>
            <p>
              {pendingToggle.status === 'ACTIVE'
                ? `هل تريد إيقاف منطقة ${pendingToggle.name}؟ لن يتم قبول فروع أو طلبات جديدة داخل هذه المنطقة، ولن تتأثر الطلبات الجارية حاليًا.`
                : `هل تريد تفعيل منطقة ${pendingToggle.name}؟ ستستخدم فورًا للتحقق من الفروع والطلبات الجديدة.`}
            </p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => setPendingToggle(undefined)}
                type="button"
              >
                إلغاء
              </button>
              <button
                className={
                  pendingToggle.status === 'ACTIVE' ? 'reject' : 'approve'
                }
                disabled={busy}
                onClick={() => {
                  void onToggle(pendingToggle).then(() =>
                    setPendingToggle(undefined),
                  );
                }}
                type="button"
              >
                {pendingToggle.status === 'ACTIVE'
                  ? 'تأكيد الإيقاف'
                  : 'تأكيد التفعيل'}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingDelete && (
        <div className="zone-map-backdrop" role="presentation">
          <section
            aria-labelledby="zone-delete-dialog-title"
            aria-modal="true"
            className="confirmation-dialog"
            role="dialog"
          >
            <h2 id="zone-delete-dialog-title">حذف منطقة الخدمة</h2>
            <p>
              هل تريد حذف منطقة الخدمة نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            {deleteError && (
              <p className="notice error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => {
                  setPendingDelete(undefined);
                  setDeleteError('');
                }}
                type="button"
              >
                إلغاء
              </button>
              {deleteError && pendingDelete.status === 'ACTIVE' && (
                <button
                  className="approve"
                  disabled={busy}
                  onClick={() => {
                    void onToggle(pendingDelete).then(() => {
                      setPendingDelete(undefined);
                      setDeleteError('');
                    });
                  }}
                  type="button"
                >
                  إيقاف المنطقة بدلًا من حذفها
                </button>
              )}
              <button
                className="reject"
                disabled={busy}
                onClick={() => {
                  setDeleteError('');
                  void onDelete(pendingDelete)
                    .then(() => setPendingDelete(undefined))
                    .catch((caught: unknown) =>
                      setDeleteError((caught as Error).message),
                    );
                }}
                type="button"
              >
                تأكيد الحذف
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function ZoneEditor({
  busy,
  onCancel,
  onSave,
  zone,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (input: ZoneFormInput) => Promise<void>;
  zone?: Zone;
}) {
  const [name, setName] = useState(zone?.name ?? '');
  const [governorate, setGovernorate] = useState(zone?.governorate ?? 'دمياط');
  const [city, setCity] = useState(zone?.city ?? 'دمياط الجديدة');
  const [radiusKm, setRadiusKm] = useState(zone?.radiusKm ?? 25);
  const [maximumRouteDistanceKm, setMaximumRouteDistanceKm] = useState(
    (zone?.maximumRouteDistanceMeters ?? 30_000) / 1000,
  );
  const [priority, setPriority] = useState(zone?.priority ?? 10);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(
    zone?.status ?? 'INACTIVE',
  );
  const [point, setPoint] = useState<ZoneMapPoint | null>(
    zone
      ? {
          latitude: zone.centerLatitude,
          longitude: zone.centerLongitude,
        }
      : null,
  );
  const [mapOpen, setMapOpen] = useState(false);
  const [localError, setLocalError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    if (!name.trim()) {
      setLocalError('اسم منطقة الخدمة مطلوب.');
      return;
    }
    if (!governorate.trim()) {
      setLocalError('المحافظة مطلوبة.');
      return;
    }
    if (!point) {
      setLocalError('حدد مركز منطقة الخدمة على الخريطة أولًا.');
      return;
    }
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      setLocalError('نصف قطر الخدمة يجب أن يكون أكبر من صفر.');
      return;
    }
    if (
      !Number.isFinite(maximumRouteDistanceKm) ||
      maximumRouteDistanceKm <= 0
    ) {
      setLocalError('الحد الأقصى لمسافة المسار يجب أن يكون أكبر من صفر.');
      return;
    }
    try {
      await onSave({
        name: name.trim(),
        governorate: governorate.trim(),
        city: city.trim(),
        centerLatitude: point.latitude,
        centerLongitude: point.longitude,
        radiusKm,
        maximumRouteDistanceKm,
        priority,
        status,
      });
    } catch {
      // The parent displays the API error and leaves the editor open.
    }
  }

  return (
    <div className="zone-map-backdrop" role="presentation">
      <form
        aria-labelledby="zone-editor-title"
        aria-modal="true"
        className="zone-editor-dialog"
        onSubmit={submit}
        role="dialog"
      >
        <div className="section-heading">
          <div>
            <p className="kicker">بيانات المنطقة والتغطية</p>
            <h2 id="zone-editor-title">
              {zone ? 'تعديل منطقة الخدمة' : 'إنشاء منطقة خدمة'}
            </h2>
          </div>
          <button disabled={busy} onClick={onCancel} type="button">
            إغلاق
          </button>
        </div>
        <div className="compact-form-grid">
          <label>
            اسم منطقة الخدمة
            <input
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label>
            المحافظة
            <input
              disabled={busy}
              onChange={(event) => setGovernorate(event.target.value)}
              required
              value={governorate}
            />
          </label>
          <label>
            المدينة
            <input
              disabled={busy}
              onChange={(event) => setCity(event.target.value)}
              value={city}
            />
          </label>
          <label>
            نصف قطر الخدمة بالكيلومتر
            <input
              disabled={busy}
              max="500"
              min="0.1"
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              required
              step="0.1"
              type="number"
              value={radiusKm}
            />
          </label>
          <label>
            الحد الأقصى لمسافة المسار بالكيلومتر
            <input
              disabled={busy}
              min="0.1"
              onChange={(event) =>
                setMaximumRouteDistanceKm(Number(event.target.value))
              }
              required
              step="0.1"
              type="number"
              value={maximumRouteDistanceKm}
            />
          </label>
          <label>
            الأولوية
            <input
              disabled={busy}
              onChange={(event) => setPriority(Number(event.target.value))}
              type="number"
              value={priority}
            />
          </label>
          {zone && (
            <label>
              الحالة
              <select
                disabled={busy}
                onChange={(event) =>
                  setStatus(event.target.value as 'ACTIVE' | 'INACTIVE')
                }
                value={status}
              >
                <option value="ACTIVE">فعّالة</option>
                <option value="INACTIVE">متوقفة</option>
              </select>
            </label>
          )}
        </div>

        <section className="zone-location-summary">
          <div>
            <h3>مركز منطقة الخدمة</h3>
            <p>
              اختر المركز بصريًا. ستُحسب دائرة التغطية وحدود PostGIS تلقائيًا.
            </p>
          </div>
          <button
            className="approve"
            disabled={busy || radiusKm <= 0}
            onClick={() => setMapOpen(true)}
            type="button"
          >
            تحديد مركز المنطقة على الخريطة
          </button>
          {point ? (
            <dl>
              <div>
                <dt>خط العرض</dt>
                <dd dir="ltr">{point.latitude.toFixed(6)}</dd>
              </div>
              <div>
                <dt>خط الطول</dt>
                <dd dir="ltr">{point.longitude.toFixed(6)}</dd>
              </div>
              <div>
                <dt>نصف القطر</dt>
                <dd>{radiusKm} كم</dd>
              </div>
            </dl>
          ) : (
            <p className="notice">لم يتم تحديد مركز المنطقة بعد.</p>
          )}
        </section>

        {localError && <p className="notice error">{localError}</p>}
        <div className="button-row">
          <button
            className="approve"
            disabled={busy || !point || radiusKm <= 0}
          >
            {zone ? 'حفظ تعديلات المنطقة' : 'إنشاء المنطقة للمراجعة'}
          </button>
          <button disabled={busy} onClick={onCancel} type="button">
            إلغاء
          </button>
        </div>

        {mapOpen && (
          <ServiceZoneMap
            initialPoint={point ?? { latitude: 31.4321, longitude: 31.8273 }}
            initialRadiusKm={radiusKm}
            onCancel={() => setMapOpen(false)}
            onConfirm={(selectedPoint, selectedRadius) => {
              setPoint(selectedPoint);
              setRadiusKm(selectedRadius);
              setMapOpen(false);
            }}
          />
        )}
      </form>
    </div>
  );
}

export function PricingView({
  rules,
  zones,
  onCreate,
  onVersion,
  onToggle,
  onValidate,
}: {
  rules: PricingRule[];
  zones: Zone[];
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onVersion: (rule: PricingRule) => void;
  onToggle: (rule: PricingRule) => void;
  onValidate: () => void;
}) {
  return (
    <div className="management-grid">
      <section className="admin-card">
        <div className="card-title">
          <div>
            <p className="kicker">إصدارات محفوظة</p>
            <h2>قواعد التسعير</h2>
          </div>
          <button className="refresh" onClick={onValidate}>
            فحص التداخل
          </button>
        </div>
        {rules.map((rule) => (
          <article className="management-row pricing-row" key={rule.id}>
            <div>
              <strong>{rule.ruleFamilyKey}</strong>
              <small>
                نسخة {rule.version} · {money(rule.baseFeeMinor)} أساسي ·{' '}
                {money(rule.perKilometerMinor)}/كم
              </small>
              <small>
                {rule.serviceZone?.name ?? `${rule.city} بالكامل`} · ساري من{' '}
                {formatDate(rule.effectiveFrom)}
              </small>
              <small>
                {humanLabel(rule.vehicleType)} · أنشأها{' '}
                {rule.createdBy?.displayName ?? 'بيانات تأسيسية'} ·{' '}
                {formatDate(rule.createdAt)}
              </small>
            </div>
            <span className={`state state-${rule.status.toLowerCase()}`}>
              {rule.status}
            </span>
            <div className="row-actions">
              <button onClick={() => onVersion(rule)}>نسخة جديدة</button>
              <button onClick={() => onToggle(rule)}>
                {rule.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
              </button>
            </div>
            <details className="pricing-details">
              <summary>عرض كل تفاصيل القاعدة</summary>
              <dl className="readable-grid">
                <ReadableField
                  label="المسافة المشمولة"
                  value={`${rule.includedDistanceMeters / 1000} كم`}
                />
                <ReadableField
                  label="أقصى مسافة"
                  value={`${rule.maximumDistanceMeters / 1000} كم`}
                />
                <ReadableField
                  label="الحد الأدنى"
                  value={money(rule.minimumFeeMinor)}
                />
                <ReadableField
                  label="طرد صغير"
                  value={money(rule.smallPackageSurchargeMinor)}
                />
                <ReadableField
                  label="طرد متوسط"
                  value={money(rule.mediumPackageSurchargeMinor)}
                />
                <ReadableField
                  label="طرد كبير"
                  value={money(rule.largePackageSurchargeMinor)}
                />
                <ReadableField
                  label="قابل للكسر"
                  value={money(rule.fragileSurchargeMinor)}
                />
                <ReadableField
                  label="حقيبة حرارية"
                  value={money(rule.thermalBagSurchargeMinor)}
                />
                <ReadableField
                  label="انتظار / دقيقة"
                  value={money(rule.waitingFeePerMinuteMinor)}
                />
                <ReadableField
                  label="أساس رحلة العودة"
                  value={money(rule.returnTripBaseMinor)}
                />
                <ReadableField
                  label="العمولة"
                  value={
                    rule.commissionType === 'PERCENTAGE'
                      ? `${rule.commissionValue / 100}%`
                      : money(rule.commissionValue)
                  }
                />
                <ReadableField
                  label="الضريبة"
                  value={`${rule.taxBasisPoints / 100}%`}
                />
                <ReadableField label="الأولوية" value={rule.priority} />
                <ReadableField
                  label="نهاية السريان"
                  value={formatDate(rule.effectiveTo)}
                />
              </dl>
              <h4>شرائح الوزن</h4>
              <div className="weight-band-list">
                {rule.weightBands.map((band) => (
                  <span key={band.upToGrams}>
                    حتى {band.upToGrams / 1000} كجم:{' '}
                    {money(band.surchargeMinor)}
                  </span>
                ))}
              </div>
            </details>
          </article>
        ))}
      </section>
      <form className="admin-card management-form" onSubmit={onCreate}>
        <p className="kicker">حقول مالية واضحة بالجنيه</p>
        <h2>قاعدة تسعير جديدة</h2>
        <label>
          معرف العائلة
          <input name="family" defaultValue="damietta-custom" required />
        </label>
        <label>
          منطقة الخدمة
          <select name="serviceZoneId">
            <option value="">قاعدة على مستوى المدينة</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
        <div className="compact-form-grid">
          <label>
            المحافظة
            <input name="governorate" defaultValue="دمياط" required />
          </label>
          <label>
            المدينة
            <input name="city" defaultValue="دمياط" required />
          </label>
        </div>
        <label>
          نوع المركبة
          <select name="vehicleType" defaultValue="MOTORCYCLE">
            <option value="MOTORCYCLE">دراجة نارية</option>
            <option value="BICYCLE">دراجة</option>
            <option value="CAR">سيارة</option>
            <option value="VAN">شاحنة صغيرة</option>
          </select>
        </label>
        <label>
          الرسم الأساسي بالجنيه
          <input name="baseFee" type="number" step="0.01" defaultValue="15" />
        </label>
        <label>
          سعر الكيلومتر
          <input name="perKm" type="number" step="0.01" defaultValue="5" />
        </label>
        <div className="compact-form-grid">
          <label>
            مسافة مشمولة (كم)
            <input
              name="includedDistanceKm"
              type="number"
              step="0.1"
              defaultValue="1"
            />
          </label>
          <label>
            أقصى مسافة (كم)
            <input
              name="maximumDistanceKm"
              type="number"
              step="0.1"
              defaultValue="25"
            />
          </label>
        </div>
        <label>
          الحد الأدنى
          <input
            name="minimumFee"
            type="number"
            step="0.01"
            defaultValue="20"
          />
        </label>
        <fieldset>
          <legend>إضافات حجم الطرد بالجنيه</legend>
          <div className="compact-form-grid">
            <label>
              صغير
              <input
                name="smallPackageSurcharge"
                type="number"
                step="0.01"
                defaultValue="0"
              />
            </label>
            <label>
              متوسط
              <input
                name="mediumPackageSurcharge"
                type="number"
                step="0.01"
                defaultValue="2"
              />
            </label>
            <label>
              كبير
              <input
                name="largePackageSurcharge"
                type="number"
                step="0.01"
                defaultValue="5"
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>شرائح الوزن</legend>
          {[1, 2, 3].map((index) => (
            <div className="weight-band-form" key={index}>
              <label>
                حتى (كجم)
                <input
                  name={`weightLimit${index}`}
                  type="number"
                  step="0.1"
                  defaultValue={index === 1 ? 5 : index === 2 ? 15 : 25}
                />
              </label>
              <label>
                الإضافة (جنيه)
                <input
                  name={`weightSurcharge${index}`}
                  type="number"
                  step="0.01"
                  defaultValue={index === 1 ? 0 : index === 2 ? 4 : 8}
                />
              </label>
            </div>
          ))}
        </fieldset>
        <div className="compact-form-grid">
          <label>
            قابل للكسر
            <input
              name="fragileSurcharge"
              type="number"
              step="0.01"
              defaultValue="2.5"
            />
          </label>
          <label>
            حقيبة حرارية
            <input
              name="thermalSurcharge"
              type="number"
              step="0.01"
              defaultValue="1.5"
            />
          </label>
          <label>
            انتظار / دقيقة
            <input
              name="waitingFee"
              type="number"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label>
            أساس العودة
            <input
              name="returnTripBase"
              type="number"
              step="0.01"
              defaultValue="0"
            />
          </label>
        </div>
        <fieldset>
          <legend>العمولة والضريبة</legend>
          <label>
            نوع العمولة
            <select name="commissionType" defaultValue="PERCENTAGE">
              <option value="PERCENTAGE">نسبة مئوية</option>
              <option value="FIXED">مبلغ ثابت</option>
            </select>
          </label>
          <div className="compact-form-grid">
            <label>
              النسبة (%)
              <input
                name="commissionPercent"
                type="number"
                step="0.01"
                defaultValue="15"
              />
            </label>
            <label>
              المبلغ الثابت (جنيه)
              <input
                name="commissionFixed"
                type="number"
                step="0.01"
                defaultValue="0"
              />
            </label>
            <label>
              الضريبة (%)
              <input
                name="taxPercent"
                type="number"
                step="0.01"
                defaultValue="0"
              />
            </label>
          </div>
        </fieldset>
        <label>
          يبدأ التطبيق
          <input
            name="effectiveFrom"
            type="datetime-local"
            defaultValue={defaultPricingEffectiveFrom}
            required
          />
        </label>
        <label>
          الأولوية
          <input name="priority" type="number" defaultValue="10" />
        </label>
        <button className="approve">إنشاء مسودة</button>
      </form>
    </div>
  );
}

function _CouriersView({
  couriers,
  onOpen,
}: {
  couriers: Courier[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="admin-card table-card">
      <p className="kicker">وظائف المرحلة الأولى محفوظة</p>
      <h2>طلبات توثيق المندوبين</h2>
      {couriers.map((courier) => (
        <article className="management-row" key={courier.id}>
          <div>
            <strong>{courier.fullName}</strong>
            <small dir="ltr">{courier.user.phone}</small>
          </div>
          <span
            className={`state state-${courier.verificationStatus.toLowerCase()}`}
          >
            {courier.verificationStatus}
          </span>
          <button onClick={() => onOpen(courier.id)}>فتح الملف</button>
        </article>
      ))}
    </section>
  );
}

function _CourierDetail({
  courier,
  reason,
  setReason,
  onBack,
  onOpenDocument,
  onReview,
  onTransition,
}: {
  courier: Courier;
  reason: string;
  setReason: (value: string) => void;
  onBack: () => void;
  onOpenDocument: (document: CourierDocument) => void;
  onReview: (
    document: CourierDocument,
    action: 'approve' | 'reject' | 'request-replacement',
  ) => void;
  onTransition: (
    action: 'approve' | 'reject' | 'suspend' | 'reactivate',
  ) => void;
}) {
  return (
    <>
      <button className="back" onClick={onBack}>
        → العودة
      </button>
      <header className="case-header">
        <div>
          <p className="kicker">توثيق المندوب</p>
          <h1>{courier.fullName}</h1>
          <p dir="ltr">{courier.user.phone}</p>
        </div>
        <span className="state">{courier.verificationStatus}</span>
      </header>
      <div className="case-grid">
        <section className="admin-card">
          <h2>المركبة والمستندات</h2>
          <p>المركبة: {courier.vehicles?.[0]?.plateNumber ?? 'غير مسجلة'}</p>
          {courier.documents?.map((document) => (
            <article className="document-row" key={document.id}>
              <div>
                <strong>{document.type.replaceAll('_', ' ')}</strong>
                <small>{document.originalFilename}</small>
                {document.reviewNotes && <small>{document.reviewNotes}</small>}
              </div>
              <span className="state">{document.status}</span>
              <div className="row-actions">
                <button onClick={() => onOpenDocument(document)}>
                  فتح آمن
                </button>
                <button onClick={() => onReview(document, 'approve')}>
                  قبول
                </button>
                <button
                  onClick={() => onReview(document, 'request-replacement')}
                >
                  طلب استبدال
                </button>
                <button onClick={() => onReview(document, 'reject')}>
                  رفض
                </button>
              </div>
            </article>
          ))}
        </section>
        <aside>
          <section className="admin-card decision-card">
            <h2>قرار المراجعة</h2>
            <label>
              السبب
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="decision-actions">
              {courier.verificationStatus === 'PENDING_REVIEW' && (
                <>
                  <button
                    className="approve"
                    onClick={() => onTransition('approve')}
                  >
                    اعتماد
                  </button>
                  <button
                    className="danger"
                    onClick={() => onTransition('reject')}
                  >
                    رفض
                  </button>
                </>
              )}
              {courier.verificationStatus === 'APPROVED' && (
                <button
                  className="danger"
                  onClick={() => onTransition('suspend')}
                >
                  تعليق
                </button>
              )}
              {courier.verificationStatus === 'SUSPENDED' && (
                <button
                  className="approve"
                  onClick={() => onTransition('reactivate')}
                >
                  إعادة التفعيل
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function MerchantsView({
  merchants,
  onOpen,
  onTransition,
}: {
  merchants: Merchant[];
  onOpen: (merchantId: string) => void;
  onTransition: (
    merchant: Merchant,
    action: 'approve' | 'reject' | 'request_changes' | 'suspend' | 'reactivate',
  ) => void;
}) {
  return (
    <section className="admin-card table-card">
      <p className="kicker">دليل المؤسسات</p>
      <h2>التجار</h2>
      {merchants.map((merchant) => (
        <article className="management-row" key={merchant.id}>
          <div>
            <strong>{merchant.displayName}</strong>
            <small>{merchant.legalName}</small>
          </div>
          <span>{merchant._count.stores} فروع</span>
          <span>{merchant._count.memberships} أعضاء</span>
          <span className="state state-active">{merchant.status}</span>
          <div className="action-row">
            <button onClick={() => onOpen(merchant.id)}>عرض الطلب</button>
            {merchant.status === 'PENDING' && (
              <>
                <button onClick={() => onTransition(merchant, 'approve')}>
                  اعتماد
                </button>
                <button
                  onClick={() => onTransition(merchant, 'request_changes')}
                >
                  طلب تعديلات
                </button>
                <button
                  className="danger"
                  onClick={() => onTransition(merchant, 'reject')}
                >
                  رفض
                </button>
              </>
            )}
            {merchant.status === 'CHANGES_REQUESTED' && (
              <>
                <button onClick={() => onTransition(merchant, 'approve')}>
                  اعتماد بعد التعديل
                </button>
                <button
                  className="danger"
                  onClick={() => onTransition(merchant, 'reject')}
                >
                  رفض
                </button>
              </>
            )}
            {merchant.status === 'ACTIVE' && (
              <button
                className="danger"
                onClick={() => onTransition(merchant, 'suspend')}
              >
                إيقاف
              </button>
            )}
            {merchant.status === 'SUSPENDED' && (
              <button onClick={() => onTransition(merchant, 'reactivate')}>
                إعادة التفعيل
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

function MerchantDetail({
  merchant,
  onBack,
  onTransition,
}: {
  merchant: Merchant;
  onBack: () => void;
  onTransition: (
    action: 'approve' | 'reject' | 'request_changes' | 'suspend' | 'reactivate',
  ) => void;
}) {
  const owner = merchant.memberships?.find(
    (membership) => membership.role === 'OWNER' && membership.active,
  );
  return (
    <>
      <button className="back" onClick={onBack}>
        ← العودة إلى طلبات التجار
      </button>
      <div className="detail-grid merchant-registration-detail">
        <section className="admin-card">
          <p className="kicker">طلب تسجيل تاجر</p>
          <h2>{merchant.displayName}</h2>
          <dl className="detail-list">
            <div>
              <dt>الاسم القانوني</dt>
              <dd>{merchant.legalName}</dd>
            </div>
            <div>
              <dt>فئة النشاط</dt>
              <dd>{merchant.businessCategory || 'غير مسجلة'}</dd>
            </div>
            <div>
              <dt>هاتف التواصل</dt>
              <dd dir="ltr">{merchant.contactPhone || '—'}</dd>
            </div>
            <div>
              <dt>البريد الإلكتروني</dt>
              <dd dir="ltr">{merchant.contactEmail || '—'}</dd>
            </div>
            <div>
              <dt>اسم المالك</dt>
              <dd>{owner?.user.displayName || '—'}</dd>
            </div>
            <div>
              <dt>هاتف دخول المالك</dt>
              <dd dir="ltr">{owner?.user.phone || '—'}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>{merchant.status}</dd>
            </div>
          </dl>
          {merchant.reviewNotes && (
            <p className="notice error">
              آخر ملاحظة مراجعة: {merchant.reviewNotes}
            </p>
          )}
        </section>

        <aside>
          {(merchant.stores ?? []).map((store) => (
            <section className="admin-card" key={store.id}>
              <p className="kicker">الفرع المسجل</p>
              <h3>{store.name}</h3>
              <dl className="detail-list">
                <div>
                  <dt>الهاتف</dt>
                  <dd dir="ltr">{store.phone || '—'}</dd>
                </div>
                <div>
                  <dt>العنوان</dt>
                  <dd>{store.addressLine}</dd>
                </div>
                <div>
                  <dt>المحافظة والمدينة</dt>
                  <dd>
                    {store.governorate || '—'} · {store.city}
                  </dd>
                </div>
                <div>
                  <dt>المنطقة والشارع</dt>
                  <dd>
                    {store.area} · {store.street || '—'}
                  </dd>
                </div>
                <div>
                  <dt>الإحداثيات</dt>
                  <dd dir="ltr">
                    {store.latitude ?? '—'}, {store.longitude ?? '—'}
                  </dd>
                </div>
              </dl>
              {store.latitude !== null && store.longitude !== null && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${store.latitude},${store.longitude}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  فتح موقع الفرع في Google Maps
                </a>
              )}
            </section>
          ))}
          <section className="admin-card">
            <h3>قرار المراجعة</h3>
            <div className="action-row">
              {['PENDING', 'CHANGES_REQUESTED'].includes(merchant.status) && (
                <>
                  <button
                    className="approve"
                    onClick={() => onTransition('approve')}
                  >
                    اعتماد التاجر
                  </button>
                  {merchant.status === 'PENDING' && (
                    <button onClick={() => onTransition('request_changes')}>
                      طلب تعديلات مع السبب
                    </button>
                  )}
                  <button
                    className="danger"
                    onClick={() => onTransition('reject')}
                  >
                    رفض مع السبب
                  </button>
                </>
              )}
              {merchant.status === 'ACTIVE' && (
                <button
                  className="danger"
                  onClick={() => onTransition('suspend')}
                >
                  إيقاف التاجر
                </button>
              )}
              {merchant.status === 'SUSPENDED' && (
                <button onClick={() => onTransition('reactivate')}>
                  إعادة التفعيل
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
