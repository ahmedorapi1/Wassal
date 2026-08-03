'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { fetchAuthorizedCourierDocument } from './private-document';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
const defaultEffectiveFrom = new Date(Date.now() + 3_600_000)
  .toISOString()
  .slice(0, 16);

type Token = { accessToken: string };
type Zone = {
  id: string;
  name: string;
  governorate: string;
  city: string;
  status: 'ACTIVE' | 'INACTIVE';
  radiusKm: number;
  maximumRouteDistanceMeters: number;
};
type PricingRule = {
  id: string;
  ruleFamilyKey: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  baseFeeMinor: number;
  includedDistanceMeters: number;
  perKilometerMinor: number;
  weightBands: Array<{ upToGrams: number; surchargeMinor: number }>;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  returnTripPercentageBasisPoints: number;
  commissionType: 'PERCENTAGE' | 'FIXED';
  commissionValue: number;
  effectiveFrom: string;
  updatedAt: string;
  serviceZone: Zone | null;
  _count: { quotes: number; orders: number };
};
type CourierDocument = {
  id: string;
  type: string;
  status: string;
  reviewVersion: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  expiresAt: string | null;
  reviewNotes: string | null;
  isCurrent: boolean;
};
type CourierListItem = {
  id: string;
  fullName: string;
  preferredCity: string | null;
  verificationStatus: string;
  submittedAt: string | null;
  statusReason: string | null;
  version: number;
  user: { phone: string; status: string };
  serviceZones: Array<{ serviceZone: Zone }>;
  missingDocumentTypes: string[];
  rejectedDocumentCount: number;
  reviewDate: string | null;
  reviewer: { displayName: string | null } | null;
};
type CourierDetailRecord = CourierListItem & {
  vehicles: Array<{
    id: string;
    type: string;
    make: string | null;
    model: string | null;
    plateNumber: string;
    active: boolean;
  }>;
  documents: CourierDocument[];
  verificationEvents: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    createdAt: string;
    actor: { displayName: string | null; role: string } | null;
  }>;
};
type OrderZone = Zone & {
  ordersToday: number;
  activeOrders: number;
  completedToday: number;
  returnedToday: number;
};
type AdminOrder = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  courierAcceptedAt: string | null;
  merchantTotalMinor: number;
  routeDistanceMeters: number;
  pickupAddressSnapshot: Record<string, unknown>;
  dropoffAddressSnapshot: Record<string, unknown>;
  merchant: { id: string; displayName: string };
  store: { id: string; name: string };
  customer: { name: string; normalizedPhone: string } | null;
  courier: { id: string; fullName: string } | null;
  serviceZone: { id: string; name: string };
  deliveryDispute: { status: string } | null;
  returnReportedAt: string | null;
  acceptanceExpiresAt: string | null;
  dispatchAttemptCount: number;
  cancelledAt: string | null;
  cancellationReasonCode: string | null;
  cancelledAfterPickup: boolean;
  cancellationChargeMinor: number;
};

async function request<T>(
  path: string,
  token: Token,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token.accessToken}`,
      ...options.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { message?: string | { message?: string } };
    message?: string;
  };
  if (!response.ok) {
    const raw = body.error?.message;
    throw new Error(
      typeof raw === 'string'
        ? raw
        : (raw?.message ?? body.message ?? 'تعذر تنفيذ الإجراء الإداري.'),
    );
  }
  return body;
}

const money = (minor: number) =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(minor / 100);

const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString('ar-EG', {
        timeZone: 'Africa/Cairo',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

const statusLabel: Record<string, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشطة',
  INACTIVE: 'متوقفة',
  RETIRED: 'مؤرشفة',
  PENDING_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  CHANGES_REQUESTED: 'مطلوب تعديل',
  SUSPENDED: 'موقوف',
  REJECTED: 'مرفوض',
  SEARCHING_COURIER: 'يبحث عن مندوب',
  NO_COURIER_AVAILABLE: 'لم يتوفر مندوب',
  NO_COURIER_AVAILABLE_FINAL: 'لم يتوفر مندوب بعد محاولتين',
  COURIER_ASSIGNED: 'تم تعيين مندوب',
  COURIER_ARRIVING_PICKUP: 'المندوب في طريقه للاستلام',
  AT_PICKUP: 'المندوب عند المتجر',
  PICKED_UP: 'تم استلام الطلب',
  IN_TRANSIT: 'في الطريق',
  AT_DROPOFF: 'المندوب عند العميل',
  DELIVERED: 'تم التسليم',
  DELIVERY_DISPUTED: 'عليه اعتراض تسليم',
  DELIVERY_FAILED: 'تعذر التسليم',
  RETURNING_TO_STORE: 'راجع إلى المتجر',
  RETURN_AWAITING_MERCHANT_CONFIRMATION: 'بانتظار تأكيد الإرجاع',
  RETURNED: 'مرتجع',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
  NEW: 'جديدة',
  AVAILABLE: 'متاحة للمناديب',
  ACCEPTED: 'مقبولة',
  PICKING_UP: 'جارٍ الاستلام',
  IN_DELIVERY: 'قيد التوصيل',
  COMPLETED_GROUP: 'مكتملة',
  RETURNED_GROUP: 'مرتجعة',
  CANCELLED_GROUP: 'ملغاة',
  DISPUTED: 'متنازع عليها',
  OPEN: 'مفتوحة',
  NOT_DUE: 'غير مستحقة بعد',
  DUE_SOON: 'تستحق قريباً',
  PARTIALLY_PAID: 'مدفوعة جزئياً',
  PAID: 'مدفوعة',
  OVERDUE: 'متأخرة',
  WAIVED: 'معفاة',
  ADJUSTED: 'معدلة',
  CLOSED: 'مكتملة',
};

const orderFilterStatuses = [
  'DRAFT',
  'QUOTED',
  'SEARCHING_COURIER',
  'NO_COURIER_AVAILABLE',
  'NO_COURIER_AVAILABLE_FINAL',
  'COURIER_ASSIGNED',
  'COURIER_ARRIVING_PICKUP',
  'AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DROPOFF',
  'DELIVERED',
  'DELIVERY_DISPUTED',
  'DELIVERY_FAILED',
  'RETURNING_TO_STORE',
  'RETURN_AWAITING_MERCHANT_CONFIRMATION',
  'RETURNED',
  'COMPLETED',
  'CANCELLED',
] as const;

function snapshotText(
  snapshot: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '—';
}

export function PricingOperationsWorkspace({
  token,
  role,
}: {
  token: Token;
  role?: string;
}) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<PricingRule | null>();
  const [pendingDelete, setPendingDelete] = useState<PricingRule>();
  const [formOpen, setFormOpen] = useState(false);
  const [formZoneId, setFormZoneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canManage = role === 'super_admin';

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [loadedRules, loadedZones] = await Promise.all([
        request<PricingRule[]>(
          `/admin/pricing-rules?includeArchived=${includeArchived}`,
          token,
        ),
        request<Zone[]>('/admin/service-zones', token),
      ]);
      setRules(loadedRules);
      setZones(loadedZones);
      setError('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [includeArchived, token]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const zone = zones.find((item) => item.id === form.get('serviceZoneId'));
    if (!zone) {
      setError('اختر منطقة خدمة صحيحة.');
      return;
    }
    if (
      zone.status === 'INACTIVE' &&
      !window.confirm(
        'منطقة الخدمة المختارة متوقفة. ستُحفظ القاعدة للإعداد المستقبلي ولن تستخدم حتى تفعيل المنطقة. هل تريد المتابعة؟',
      )
    ) {
      return;
    }
    const commissionType = String(form.get('commissionType'));
    const weightLimits = form.getAll('weightLimitKg');
    const weightSurcharges = form.getAll('weightSurcharge');
    const weightBands = weightLimits
      .map((limit, index) => ({
        upToGrams: Math.round(Number(limit) * 1_000),
        surchargeMinor: Math.round(Number(weightSurcharges[index] ?? 0) * 100),
      }))
      .filter((band) => band.upToGrams > 0)
      .sort((left, right) => left.upToGrams - right.upToGrams);
    const payload = {
      ruleFamilyKey: String(form.get('ruleName')),
      serviceZoneId: zone.id,
      baseFeeMinor: Math.round(Number(form.get('baseFee')) * 100),
      includedDistanceMeters: Math.round(
        Number(form.get('includedDistanceKm')) * 1_000,
      ),
      perKilometerMinor: Math.round(Number(form.get('perKm')) * 100),
      returnTripPercentageBasisPoints: 7_000,
      commissionType,
      commissionValue:
        commissionType === 'PERCENTAGE'
          ? Math.round(Number(form.get('commissionValue')) * 100)
          : Math.round(Number(form.get('commissionValue')) * 100),
      weightBands:
        weightBands.length > 0
          ? weightBands
          : [{ upToGrams: 25_000, surchargeMinor: 0 }],
      fragileSurchargeMinor: Math.round(
        Number(form.get('fragileSurcharge')) * 100,
      ),
      thermalBagSurchargeMinor: Math.round(
        Number(form.get('thermalSurcharge')) * 100,
      ),
      effectiveFrom: new Date(String(form.get('effectiveFrom'))).toISOString(),
    };
    setBusy(true);
    try {
      await request(
        editing
          ? `/admin/pricing-rules/${editing.id}/new-version`
          : '/admin/pricing-rules',
        token,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setMessage(
        editing
          ? 'تم حفظ التعديل كنسخة جديدة قابلة للتدقيق.'
          : 'تم إنشاء قاعدة التسعير كمسودة بنجاح.',
      );
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: PricingRule) {
    const activating = rule.status !== 'ACTIVE';
    if (
      activating &&
      !window.confirm(
        `سيؤدي تفعيل «${rule.ruleFamilyKey}» إلى إيقاف أي قاعدة نشطة أخرى للمنطقة تلقائياً مع الاحتفاظ بتاريخها. هل تريد المتابعة؟`,
      )
    ) {
      return;
    }
    if (
      activating &&
      rule.serviceZone?.status === 'INACTIVE' &&
      !window.confirm(
        'المنطقة نفسها متوقفة، لذلك لن تستخدم هذه القاعدة للطلبات الجديدة حتى تفعيل المنطقة. هل تريد تفعيل القاعدة للإعداد المستقبلي؟',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await request(
        `/admin/pricing-rules/${rule.id}/${activating ? 'activate' : 'deactivate'}`,
        token,
        { method: 'POST' },
      );
      setMessage(
        activating
          ? 'تم تفعيل القاعدة وإيقاف القاعدة السابقة للمنطقة إن وجدت.'
          : 'تم إيقاف قاعدة التسعير.',
      );
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archive(rule: PricingRule) {
    if (
      !window.confirm(
        `أرشفة «${rule.ruleFamilyKey}»؟ ستختفي افتراضياً ولن تُستخدم للطلبات الجديدة، مع بقاء السجل التاريخي.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await request(`/admin/pricing-rules/${rule.id}/archive`, token, {
        method: 'POST',
      });
      setMessage('تمت أرشفة قاعدة التسعير مع الاحتفاظ بتاريخها.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: PricingRule) {
    setBusy(true);
    try {
      const result = await request<{
        deleted: boolean;
        archived: boolean;
        message?: string;
      }>(`/admin/pricing-rules/${rule.id}`, token, { method: 'DELETE' });
      setMessage(
        result.archived
          ? (result.message ??
              'لا يمكن حذف قاعدة مستخدمة في طلبات سابقة، لذلك تم أرشفتها للحفاظ على السجلات المالية.')
          : 'تم حذف قاعدة التسعير غير المستخدمة نهائياً.',
      );
      setPendingDelete(undefined);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedFormZone = zones.find((zone) => zone.id === formZoneId);

  return (
    <div className="operations-workspace">
      <div className="workspace-toolbar">
        <div>
          <p className="kicker">إعدادات تشغيلية مرتبطة بالمناطق</p>
          <h2>قواعد التسعير</h2>
        </div>
        <div className="row-actions">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            عرض المؤرشف
          </label>
          <button onClick={() => void load()} disabled={busy}>
            تحديث
          </button>
          {canManage && (
            <button
              className="approve"
              onClick={() => {
                setEditing(null);
                setFormZoneId('');
                setFormOpen(true);
              }}
            >
              إضافة قاعدة تسعير
            </button>
          )}
        </div>
      </div>
      {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
      {message && <p className="alert success">{message}</p>}
      {error && <p className="alert">{error}</p>}
      {!canManage && (
        <p className="notice">
          يمكنك عرض القواعد، بينما الإنشاء والتعديل والتفعيل والحذف متاح لمسؤول
          النظام الأعلى فقط.
        </p>
      )}
      <section className="admin-card table-card">
        <div className="responsive-table operations-table pricing-operations-table">
          <div className="table-head">
            <span>القاعدة والمنطقة</span>
            <span>الحالة</span>
            <span>التسعير</span>
            <span>العودة والعمولة</span>
            <span>آخر تحديث</span>
            <span>الإجراءات</span>
          </div>
          {rules.map((rule) => (
            <article className="table-row" key={rule.id}>
              <div>
                <strong>{rule.ruleFamilyKey}</strong>
                <small>
                  {rule.serviceZone?.name ?? 'منطقة غير مرتبطة'} ·{' '}
                  {rule.serviceZone?.governorate} / {rule.serviceZone?.city}
                </small>
                <small>
                  المنطقة: {statusLabel[rule.serviceZone?.status ?? ''] ?? '—'}{' '}
                  · نصف القطر {rule.serviceZone?.radiusKm ?? '—'} كم
                </small>
              </div>
              <span className={`state state-${rule.status.toLowerCase()}`}>
                {statusLabel[rule.status]}
              </span>
              <span>
                {money(rule.baseFeeMinor)} لأول{' '}
                {rule.includedDistanceMeters / 1_000} كم
                <small>{money(rule.perKilometerMinor)} / كم إضافي</small>
              </span>
              <span>
                العودة {rule.returnTripPercentageBasisPoints / 100}%
                <small>
                  العمولة{' '}
                  {rule.commissionType === 'PERCENTAGE'
                    ? `${rule.commissionValue / 100}%`
                    : money(rule.commissionValue)}
                </small>
              </span>
              <span>{formatDate(rule.updatedAt)}</span>
              <div className="row-actions">
                <details>
                  <summary>عرض</summary>
                  <div className="inline-details">
                    <span>الإصدار {rule.version}</span>
                    <span>
                      شرائح الوزن:{' '}
                      {rule.weightBands
                        .map(
                          (band) =>
                            `حتى ${band.upToGrams / 1_000} كجم مقابل ${money(
                              band.surchargeMinor,
                            )}`,
                        )
                        .join(' · ')}
                    </span>
                    <span>
                      قابل للكسر {money(rule.fragileSurchargeMinor)} · حراري{' '}
                      {money(rule.thermalBagSurchargeMinor)}
                    </span>
                    <span>
                      المراجع التاريخية: {rule._count.orders} طلبات،{' '}
                      {rule._count.quotes} عروض
                    </span>
                  </div>
                </details>
                {canManage && rule.status !== 'RETIRED' && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(rule);
                        setFormZoneId(rule.serviceZone?.id ?? '');
                        setFormOpen(true);
                      }}
                    >
                      تعديل
                    </button>
                    {rule.serviceZone ? (
                      <button disabled={busy} onClick={() => void toggle(rule)}>
                        {rule.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
                      </button>
                    ) : (
                      <small className="warning">
                        أنشئ نسخة مرتبطة بمنطقة قبل التفعيل
                      </small>
                    )}
                    {rule.status !== 'ACTIVE' && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => void archive(rule)}
                        >
                          أرشفة
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => setPendingDelete(rule)}
                        >
                          حذف
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
          {rules.length === 0 && (
            <p className="empty-state">لا توجد قواعد تطابق المرشح الحالي.</p>
          )}
        </div>
      </section>
      {pendingDelete && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="admin-card operations-dialog confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="pricing-delete-title"
            aria-describedby="pricing-delete-description"
          >
            <h2 id="pricing-delete-title">حذف قاعدة التسعير</h2>
            <p id="pricing-delete-description">
              هل تريد حذف قاعدة التسعير نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.
            </p>
            <p className="notice">
              إذا كانت «{pendingDelete.ruleFamilyKey}» مستخدمة تاريخيًا فسيتم
              أرشفتها تلقائيًا بدل حذفها.
            </p>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => setPendingDelete(undefined)}
                disabled={busy}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void remove(pendingDelete)}
                disabled={busy}
              >
                تأكيد الحذف
              </button>
            </div>
          </section>
        </div>
      )}
      {formOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="admin-card operations-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pricing-form-title"
          >
            <div className="card-title">
              <div>
                <p className="kicker">دراجة نارية · جنيه مصري</p>
                <h2 id="pricing-form-title">
                  {editing ? 'تعديل قاعدة التسعير' : 'إضافة قاعدة تسعير'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setEditing(null);
                }}
              >
                إغلاق
              </button>
            </div>
            <form className="operations-form" onSubmit={save}>
              <label>
                اسم قاعدة التسعير — إجباري
                <input
                  name="ruleName"
                  defaultValue={editing?.ruleFamilyKey ?? ''}
                  minLength={2}
                  required
                />
              </label>
              <label>
                منطقة الخدمة — إجباري
                <select
                  name="serviceZoneId"
                  value={formZoneId}
                  onChange={(event) => setFormZoneId(event.target.value)}
                  required
                >
                  <option value="">اختر المنطقة</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name} · {zone.governorate} / {zone.city} ·{' '}
                      {statusLabel[zone.status]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="notice">
                تُشتق المحافظة والمدينة وحالة المنطقة ونصف القطر والحد الأقصى
                للمسار من منطقة الخدمة المختارة، ولا تُدخل يدوياً.
              </p>
              {selectedFormZone && (
                <dl className="zone-derived-info" aria-label="بيانات المنطقة">
                  <div>
                    <dt>المحافظة</dt>
                    <dd>{selectedFormZone.governorate}</dd>
                  </div>
                  <div>
                    <dt>المدينة</dt>
                    <dd>{selectedFormZone.city}</dd>
                  </div>
                  <div>
                    <dt>حالة المنطقة</dt>
                    <dd>{statusLabel[selectedFormZone.status]}</dd>
                  </div>
                  <div>
                    <dt>نصف القطر</dt>
                    <dd>{selectedFormZone.radiusKm} كم</dd>
                  </div>
                  <div>
                    <dt>أقصى مسافة مسار</dt>
                    <dd>
                      {selectedFormZone.maximumRouteDistanceMeters / 1_000} كم
                    </dd>
                  </div>
                </dl>
              )}
              <div className="operations-form-grid">
                <label>
                  السعر الأساسي — إجباري (جنيه)
                  <input
                    name="baseFee"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={(editing?.baseFeeMinor ?? 1_500) / 100}
                    required
                  />
                </label>
                <label>
                  المسافة المشمولة في السعر الأساسي — إجباري (كم)
                  <input
                    name="includedDistanceKm"
                    type="number"
                    min="0"
                    step="0.1"
                    defaultValue={
                      (editing?.includedDistanceMeters ?? 1_000) / 1_000
                    }
                    required
                  />
                </label>
                <label>
                  سعر الكيلومتر الإضافي — إجباري (جنيه)
                  <input
                    name="perKm"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={(editing?.perKilometerMinor ?? 500) / 100}
                    required
                  />
                </label>
              </div>
              <details>
                <summary>إضافات اختيارية</summary>
                <div className="operations-form-grid optional-pricing-fields">
                  {[5, 10, 25].map((fallbackLimit, index) => (
                    <div className="pricing-tier-row" key={fallbackLimit}>
                      <label>
                        الحد الأقصى للوزن — الشريحة {index + 1} (كجم)
                        <input
                          name="weightLimitKg"
                          type="number"
                          min="0.1"
                          step="0.1"
                          defaultValue={
                            (editing?.weightBands[index]?.upToGrams ??
                              fallbackLimit * 1_000) / 1_000
                          }
                        />
                      </label>
                      <label>
                        الإضافة — الشريحة {index + 1} (جنيه)
                        <input
                          name="weightSurcharge"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={
                            (editing?.weightBands[index]?.surchargeMinor ?? 0) /
                            100
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <label>
                    إضافة قابل للكسر (جنيه)
                    <input
                      name="fragileSurcharge"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={(editing?.fragileSurchargeMinor ?? 0) / 100}
                    />
                  </label>
                  <label>
                    إضافة الحقيبة الحرارية (جنيه)
                    <input
                      name="thermalSurcharge"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        (editing?.thermalBagSurchargeMinor ?? 0) / 100
                      }
                    />
                  </label>
                </div>
              </details>
              <fieldset>
                <legend>المرتجع</legend>
                <label>
                  رحلة العودة
                  <input
                    value="70% من سعر الرحلة الأصلية دون العمولة"
                    readOnly
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>عمولة سِكّة</legend>
                <div className="operations-form-grid">
                  <label>
                    النوع
                    <select
                      name="commissionType"
                      defaultValue={editing?.commissionType ?? 'PERCENTAGE'}
                    >
                      <option value="PERCENTAGE">نسبة مئوية</option>
                      <option value="FIXED">مبلغ ثابت</option>
                    </select>
                  </label>
                  <label>
                    القيمة (% أو جنيه حسب النوع)
                    <input
                      name="commissionValue"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        editing?.commissionType === 'FIXED'
                          ? editing.commissionValue / 100
                          : (editing?.commissionValue ?? 1_500) / 100
                      }
                      required
                    />
                  </label>
                </div>
              </fieldset>
              <label>
                تاريخ بدء التطبيق
                <input
                  name="effectiveFrom"
                  type="datetime-local"
                  defaultValue={
                    editing
                      ? new Date(editing.effectiveFrom)
                          .toISOString()
                          .slice(0, 16)
                      : defaultEffectiveFrom
                  }
                  required
                />
              </label>
              <div className="dialog-actions">
                <button className="approve" disabled={busy}>
                  {editing ? 'حفظ كنسخة جديدة' : 'حفظ كمسودة'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFormOpen(false)}
                >
                  إلغاء
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export function CourierVerificationWorkspace({ token }: { token: Token }) {
  const [summary, setSummary] = useState({
    pendingReview: 0,
    approved: 0,
    changesRequested: 0,
    suspended: 0,
  });
  const [couriers, setCouriers] = useState<CourierListItem[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [filters, setFilters] = useState({
    search: '',
    serviceZoneId: '',
    city: '',
    submittedFrom: '',
    submittedTo: '',
    documentExpiryBefore: '',
  });
  const [selected, setSelected] = useState<CourierDetailRecord>();
  const [page, setPage] = useState(1);
  const [audit, setAudit] = useState<
    Array<{ id: string; action: string; actorRole: string; createdAt: string }>
  >([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      for (const [key, value] of Object.entries(filters)) {
        if (value) query.set(key, value);
      }
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?workspace=couriers&${query.toString()}`,
      );
      const [loadedSummary, loadedCouriers, loadedZones] = await Promise.all([
        request<typeof summary>('/admin/courier-verification/summary', token),
        request<CourierListItem[]>(`/admin/couriers?${query}`, token),
        request<Zone[]>('/admin/service-zones', token),
      ]);
      setSummary(loadedSummary);
      setCouriers(loadedCouriers);
      setZones(loadedZones);
      setError('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [filters, status, token]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  async function openCourier(courierId: string) {
    setBusy(true);
    try {
      const [detail, logs] = await Promise.all([
        request<CourierDetailRecord>(`/admin/couriers/${courierId}`, token),
        request<typeof audit>(`/admin/couriers/${courierId}/audit-log`, token),
      ]);
      setSelected(detail);
      setAudit(logs);
      setReason('');
      setError('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    action: 'approve' | 'request-changes' | 'suspend' | 'reactivate',
  ) {
    if (!selected) return;
    const needsReason = ['request-changes', 'suspend'].includes(action);
    if (needsReason && reason.trim().length < 3) {
      setError('اكتب سبباً واضحاً لا يقل عن ثلاثة أحرف.');
      return;
    }
    if (
      !window.confirm(
        action === 'approve'
          ? 'اعتماد هذا المندوب بعد مراجعة بياناته ومركبته ومستنداته؟'
          : action === 'reactivate'
            ? 'إعادة تفعيل المندوب بعد التأكد من استمرار صلاحية المتطلبات؟'
            : 'تأكيد القرار الإداري وتسجيل سببه في سجل التحقق؟',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await request(`/admin/couriers/${selected.id}/${action}`, token, {
        method: 'POST',
        body: JSON.stringify({
          version: selected.version,
          ...(needsReason ? { reason } : {}),
        }),
      });
      setMessage('تم حفظ القرار وتحديث العدادات وسجل التحقق.');
      setSelected(undefined);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reviewDocument(
    document: CourierDocument,
    action: 'approve' | 'reject' | 'request-replacement',
  ) {
    if (!selected) return;
    if (action !== 'approve' && reason.trim().length < 3) {
      setError('اكتب سبب رفض المستند أو طلب استبداله.');
      return;
    }
    setBusy(true);
    try {
      await request(
        `/admin/couriers/${selected.id}/documents/${document.id}/${action}`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            version: document.reviewVersion,
            ...(action === 'approve' ? {} : { reason }),
          }),
        },
      );
      setMessage('تم حفظ قرار المستند في سجل التحقق.');
      await openCourier(selected.id);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(document: CourierDocument) {
    const viewer = window.open('about:blank', '_blank');
    if (viewer) viewer.opener = null;
    try {
      const file = await fetchAuthorizedCourierDocument(
        apiUrl,
        document.id,
        token.accessToken,
      );
      const objectUrl = URL.createObjectURL(
        new Blob([file.blob], { type: file.contentType }),
      );
      if (viewer) viewer.location.replace(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (caught) {
      viewer?.close();
      setError((caught as Error).message);
    }
  }

  if (selected) {
    return (
      <div className="operations-workspace">
        <button className="back" onClick={() => setSelected(undefined)}>
          → العودة إلى طلبات التوثيق
        </button>
        {busy && <p className="alert success">جارٍ حفظ القرار…</p>}
        {message && <p className="alert success">{message}</p>}
        {error && <p className="alert">{error}</p>}
        <header className="case-header">
          <div>
            <p className="kicker">ملف توثيق المندوب</p>
            <h1>{selected.fullName}</h1>
            <p dir="ltr">{selected.user.phone}</p>
          </div>
          <span
            className={`state state-${selected.verificationStatus.toLowerCase()}`}
          >
            {statusLabel[selected.verificationStatus] ??
              selected.verificationStatus}
          </span>
        </header>
        <div className="case-grid">
          <div>
            <section className="admin-card readable-section">
              <h2>البيانات الشخصية والخدمة</h2>
              <div className="readable-grid">
                <span>المدينة: {selected.preferredCity ?? '—'}</span>
                <span>حالة الحساب: {selected.user.status}</span>
                <span>تاريخ التقديم: {formatDate(selected.submittedAt)}</span>
                <span>
                  مناطق الخدمة:{' '}
                  {selected.serviceZones
                    .map((membership) => membership.serviceZone.name)
                    .join('، ') || 'لم تُربط منطقة بعد'}
                </span>
              </div>
              {selected.statusReason && (
                <p className="notice">آخر ملاحظة: {selected.statusReason}</p>
              )}
            </section>
            <section className="admin-card">
              <h2>المركبة</h2>
              {selected.vehicles.map((vehicle) => (
                <article className="document-row" key={vehicle.id}>
                  <strong>{vehicle.plateNumber}</strong>
                  <span>
                    {vehicle.make} {vehicle.model} · {vehicle.type}
                  </span>
                  <span>{vehicle.active ? 'نشطة' : 'متوقفة'}</span>
                </article>
              ))}
              {selected.vehicles.length === 0 && (
                <p className="empty-state">لا توجد مركبة مسجلة.</p>
              )}
            </section>
            <section className="admin-card">
              <h2>المستندات</h2>
              {selected.documents.map((document) => (
                <article className="document-row" key={document.id}>
                  <div>
                    <strong>{document.type.replaceAll('_', ' ')}</strong>
                    <small>{document.originalFilename}</small>
                    <small>
                      {document.contentType} ·{' '}
                      {Math.ceil(document.sizeBytes / 1_024)} ك.ب · ينتهي{' '}
                      {formatDate(document.expiresAt)}
                    </small>
                    {document.reviewNotes && (
                      <small className="warning">{document.reviewNotes}</small>
                    )}
                  </div>
                  <span>{statusLabel[document.status] ?? document.status}</span>
                  <div className="row-actions">
                    <button
                      disabled={busy}
                      onClick={() => void openDocument(document)}
                    >
                      فتح آمن
                    </button>
                    {document.isCurrent && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void reviewDocument(document, 'approve')
                          }
                        >
                          اعتماد
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void reviewDocument(document, 'request-replacement')
                          }
                        >
                          طلب استبدال
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            void reviewDocument(document, 'reject')
                          }
                        >
                          رفض
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </section>
            <section className="admin-card">
              <h2>سجل التحقق</h2>
              <div className="readable-history">
                {selected.verificationEvents.slice(0, 50).map((event) => (
                  <article key={event.id}>
                    <strong>{event.action}</strong>
                    <span>
                      {event.actor?.displayName ?? 'النظام'} ·{' '}
                      {formatDate(event.createdAt)}
                    </span>
                    <span>
                      {event.fromStatus ?? '—'} ← {event.toStatus ?? '—'}
                    </span>
                    {event.reason && <span>{event.reason}</span>}
                  </article>
                ))}
                {selected.verificationEvents.length > 50 && (
                  <p className="muted-note">
                    يعرض أحدث 50 حدثاً من أصل{' '}
                    {selected.verificationEvents.length}. السجل الكامل محفوظ في
                    قاعدة البيانات.
                  </p>
                )}
              </div>
            </section>
            <section className="admin-card">
              <details>
                <summary>سجل التدقيق ({audit.length})</summary>
                <div className="readable-history">
                  {audit.map((entry) => (
                    <article key={entry.id}>
                      <strong>{entry.action}</strong>
                      <span>
                        {entry.actorRole} · {formatDate(entry.createdAt)}
                      </span>
                    </article>
                  ))}
                </div>
              </details>
            </section>
          </div>
          <aside>
            <section className="admin-card decision-card sticky-decision">
              <h2>قرار المراجعة</h2>
              <label>
                سبب القرار أو ملاحظات المستند
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="اكتب سبباً واضحاً عند طلب التعديل أو التعليق"
                />
              </label>
              <div className="decision-actions">
                {selected.verificationStatus === 'PENDING_REVIEW' && (
                  <>
                    <button
                      className="approve"
                      disabled={busy}
                      onClick={() => void transition('approve')}
                    >
                      اعتماد المندوب
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void transition('request-changes')}
                    >
                      طلب تعديلات
                    </button>
                  </>
                )}
                {selected.verificationStatus === 'APPROVED' && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => void transition('suspend')}
                  >
                    تعليق المندوب
                  </button>
                )}
                {selected.verificationStatus === 'SUSPENDED' && (
                  <button
                    className="approve"
                    disabled={busy}
                    onClick={() => void transition('reactivate')}
                  >
                    إعادة التفعيل
                  </button>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    );
  }

  const cards: Array<[string, string, number, string]> = [
    ['PENDING_REVIEW', 'تحت المراجعة', summary.pendingReview, '◷'],
    ['APPROVED', 'معتمدون', summary.approved, '✓'],
    ['CHANGES_REQUESTED', 'مطلوب تعديل', summary.changesRequested, '↺'],
    ['SUSPENDED', 'موقوفون', summary.suspended, '⏸'],
  ];
  const visibleCouriers = couriers.slice((page - 1) * 25, page * 25);
  return (
    <div className="operations-workspace">
      <div className="workspace-toolbar">
        <div>
          <p className="kicker">عمليات التحقق</p>
          <h2>توثيق المندوبين</h2>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      </div>
      {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
      {message && <p className="alert success">{message}</p>}
      {error && <p className="alert">{error}</p>}
      <section className="summary-grid clickable-summary">
        {cards.map(([value, label, count, icon]) => (
          <button
            key={value}
            className={status === value ? 'selected-summary' : ''}
            onClick={() => {
              setPage(1);
              setStatus(value);
            }}
          >
            <span>
              <b aria-hidden="true">{icon}</b> {label}
            </span>
            <strong>{count}</strong>
          </button>
        ))}
      </section>
      <form
        className="admin-card operations-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <label>
          الحالة
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">كل الحالات</option>
            {Object.entries(statusLabel)
              .filter(([value]) =>
                [
                  'PENDING_REVIEW',
                  'APPROVED',
                  'CHANGES_REQUESTED',
                  'SUSPENDED',
                  'REJECTED',
                ].includes(value),
              )
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label>
          منطقة الخدمة
          <select
            value={filters.serviceZoneId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                serviceZoneId: event.target.value,
              }))
            }
          >
            <option value="">كل المناطق</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          المدينة
          <input
            value={filters.city}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                city: event.target.value,
              }))
            }
          />
        </label>
        <label>
          بحث بالاسم أو الهاتف
          <input
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                search: event.target.value,
              }))
            }
          />
        </label>
        <label>
          تقديم من
          <input
            type="date"
            value={filters.submittedFrom}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                submittedFrom: event.target.value,
              }))
            }
          />
        </label>
        <label>
          تقديم إلى
          <input
            type="date"
            value={filters.submittedTo}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                submittedTo: event.target.value,
              }))
            }
          />
        </label>
        <label>
          انتهاء مستند قبل
          <input
            type="date"
            value={filters.documentExpiryBefore}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                documentExpiryBefore: event.target.value,
              }))
            }
          />
        </label>
        <button>تطبيق المرشحات</button>
      </form>
      <section className="admin-card table-card">
        <div className="responsive-table operations-table courier-review-table">
          <div className="table-head">
            <span>المندوب</span>
            <span>المدينة والمنطقة</span>
            <span>التقديم</span>
            <span>الحالة والمستندات</span>
            <span>آخر مراجعة</span>
            <span>الإجراء</span>
          </div>
          {visibleCouriers.map((courier) => (
            <article className="table-row" key={courier.id}>
              <div>
                <strong>{courier.fullName}</strong>
                <small dir="ltr">{courier.user.phone}</small>
              </div>
              <span>
                {courier.preferredCity ?? '—'}
                <small>
                  {courier.serviceZones
                    .map((membership) => membership.serviceZone.name)
                    .join('، ') || 'لم تُربط منطقة'}
                </small>
              </span>
              <span>{formatDate(courier.submittedAt)}</span>
              <span>
                {statusLabel[courier.verificationStatus] ??
                  courier.verificationStatus}
                <small>
                  ناقص {courier.missingDocumentTypes.length} · مرفوض/منتهي{' '}
                  {courier.rejectedDocumentCount}
                </small>
              </span>
              <span>
                {formatDate(courier.reviewDate)}
                <small>{courier.reviewer?.displayName ?? '—'}</small>
              </span>
              <button onClick={() => void openCourier(courier.id)}>
                فتح الملف
              </button>
            </article>
          ))}
          {couriers.length === 0 && (
            <p className="empty-state">لا توجد طلبات تطابق المرشحات.</p>
          )}
        </div>
        {couriers.length > 25 && (
          <div className="pagination-controls" aria-label="صفحات المناديب">
            <button
              disabled={page === 1 || busy}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              السابق
            </button>
            <span>
              الصفحة {page} من {Math.ceil(couriers.length / 25)}
            </span>
            <button
              disabled={page >= Math.ceil(couriers.length / 25) || busy}
              onClick={() => setPage((current) => current + 1)}
            >
              التالي
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export function OrdersByZoneWorkspace({
  token,
  role,
  onOpen,
}: {
  token: Token;
  role?: string;
  onOpen: (orderId: string) => void;
}) {
  const [zones, setZones] = useState<OrderZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string>();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    orderNumber: '',
    merchantId: '',
    storeId: '',
    courierId: '',
    customerPhone: '',
    status: '',
    statusGroup: '',
    createdFrom: '',
    createdTo: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadZones = useCallback(async () => {
    setBusy(true);
    try {
      const response = await request<{ zones: OrderZone[] }>(
        '/admin/order-zones',
        token,
      );
      setZones(response.zones);
      setError('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    const handle = window.setTimeout(() => void loadZones(), 0);
    return () => window.clearTimeout(handle);
  }, [loadZones]);

  const loadOrders = useCallback(
    async (zoneId: string | undefined) => {
      setBusy(true);
      try {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: '25',
        });
        if (zoneId) query.set('serviceZoneId', zoneId);
        for (const [key, value] of Object.entries(filters)) {
          if (!value) continue;
          query.set(
            key,
            ['createdFrom', 'createdTo'].includes(key)
              ? new Date(value).toISOString()
              : value,
          );
        }
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}?workspace=orders&${query.toString()}`,
        );
        const [orderPage, zoneSummary] = await Promise.all([
          request<{ items: AdminOrder[]; total: number }>(
            `/admin/orders?${query}`,
            token,
          ),
          zoneId
            ? request<{ counts: Record<string, number> }>(
                `/admin/order-zones/${zoneId}/summary`,
                token,
              )
            : Promise.resolve({ counts: {} }),
        ]);
        setOrders(orderPage.items);
        setTotal(orderPage.total);
        setSummary(zoneSummary.counts);
        setError('');
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [filters, page, token],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (selectedZoneId !== undefined) {
        void loadOrders(selectedZoneId || undefined);
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [loadOrders, selectedZoneId]);

  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);
  if (selectedZoneId === undefined) {
    return (
      <div className="operations-workspace">
        <div className="workspace-toolbar">
          <div>
            <p className="kicker">تشغيل معزول حسب نطاق الخدمة</p>
            <h2>الطلبات حسب المنطقة</h2>
          </div>
          <div className="row-actions">
            {role === 'super_admin' && (
              <button onClick={() => setSelectedZoneId('')}>
                عرض كل المناطق
              </button>
            )}
            <button onClick={() => void loadZones()} disabled={busy}>
              تحديث
            </button>
          </div>
        </div>
        {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
        {error && <p className="alert">{error}</p>}
        <section className="zone-card-grid">
          {zones.map((zone) => (
            <button
              className="admin-card zone-operations-card"
              key={zone.id}
              onClick={() => {
                setPage(1);
                setSelectedZoneId(zone.id);
              }}
            >
              <span className={`state state-${zone.status.toLowerCase()}`}>
                {statusLabel[zone.status]}
              </span>
              <h3>{zone.name}</h3>
              <p>
                {zone.governorate} · {zone.city}
              </p>
              <dl>
                <div>
                  <dt>طلبات اليوم</dt>
                  <dd>{zone.ordersToday}</dd>
                </div>
                <div>
                  <dt>نشطة الآن</dt>
                  <dd>{zone.activeOrders}</dd>
                </div>
                <div>
                  <dt>مكتملة اليوم</dt>
                  <dd>{zone.completedToday}</dd>
                </div>
                <div>
                  <dt>مرتجعة اليوم</dt>
                  <dd>{zone.returnedToday}</dd>
                </div>
              </dl>
            </button>
          ))}
        </section>
      </div>
    );
  }

  const statusCards = Object.entries(summary).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <div className="operations-workspace">
      <button className="back" onClick={() => setSelectedZoneId(undefined)}>
        → العودة إلى المناطق
      </button>
      <div className="workspace-toolbar">
        <div>
          <p className="kicker">
            {selectedZone
              ? `${selectedZone.governorate} · ${selectedZone.city}`
              : 'عرض إداري شامل'}
          </p>
          <h2>{selectedZone?.name ?? 'كل المناطق'}</h2>
        </div>
        <button onClick={() => void loadOrders(selectedZoneId || undefined)}>
          تحديث
        </button>
      </div>
      {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
      {error && <p className="alert">{error}</p>}
      {selectedZone && (
        <section className="summary-grid compact-summary">
          {statusCards.map(([status, count]) => (
            <button
              key={status}
              onClick={() => {
                setPage(1);
                setFilters((current) => ({
                  ...current,
                  status: '',
                  statusGroup: status,
                }));
              }}
            >
              <span>{statusLabel[status] ?? status}</span>
              <strong>{count}</strong>
            </button>
          ))}
        </section>
      )}
      <form
        className="admin-card operations-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (page === 1) {
            void loadOrders(selectedZoneId || undefined);
          } else {
            setPage(1);
          }
        }}
      >
        {(
          [
            ['orderNumber', 'رقم الطلب'],
            ['merchantId', 'معرّف التاجر'],
            ['storeId', 'معرّف الفرع'],
            ['courierId', 'معرّف المندوب'],
            ['customerPhone', 'هاتف العميل'],
          ] as const
        ).map(([name, label]) => (
          <label key={name}>
            {label}
            <input
              value={filters[name as keyof typeof filters]}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
              dir={name === 'orderNumber' ? 'ltr' : undefined}
            />
          </label>
        ))}
        <label>
          الحالة
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value,
                statusGroup: '',
              }))
            }
          >
            <option value="">كل الحالات</option>
            {orderFilterStatuses.map((value) => (
              <option key={value} value={value}>
                {statusLabel[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label>
          من تاريخ
          <input
            type="date"
            value={filters.createdFrom}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                createdFrom: event.target.value,
              }))
            }
          />
        </label>
        <label>
          إلى تاريخ
          <input
            type="date"
            value={filters.createdTo}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                createdTo: event.target.value,
              }))
            }
          />
        </label>
        <button>تطبيق المرشحات</button>
      </form>
      <section className="admin-card table-card">
        <div className="responsive-table operations-table zone-orders-table">
          <div className="table-head">
            <span>الطلب</span>
            <span>التاجر والفرع</span>
            <span>الاستلام والتسليم</span>
            <span>المندوب والتعيين</span>
            <span>الحالة</span>
            <span>الإجمالي</span>
            <span>الإجراء</span>
          </div>
          {orders.map((order) => (
            <article className="table-row" key={order.id}>
              <div>
                <strong dir="ltr">{order.orderNumber}</strong>
                <small>{formatDate(order.createdAt)}</small>
              </div>
              <span>
                {order.merchant.displayName}
                <small>{order.store.name}</small>
              </span>
              <span>
                {snapshotText(
                  order.pickupAddressSnapshot,
                  'addressLine',
                  'label',
                )}
                {' ← '}
                {snapshotText(
                  order.dropoffAddressSnapshot,
                  'label',
                  'addressLine',
                  'addressLine1',
                )}
                <small>
                  المستلم {order.customer?.name ?? '—'} ·{' '}
                  {order.customer?.normalizedPhone ?? '—'}
                </small>
              </span>
              <span>
                {order.courier?.fullName ?? 'غير معين'}
                <small>القبول: {formatDate(order.courierAcceptedAt)}</small>
              </span>
              <span>
                {statusLabel[order.status] ?? order.status}
                <small>محاولة البحث {order.dispatchAttemptCount} من 2</small>
                <small>آخر تحديث {formatDate(order.updatedAt)}</small>
                {(order.deliveryDispute || order.returnReportedAt) && (
                  <small className="warning">
                    {order.deliveryDispute ? 'اعتراض' : ''}
                    {order.deliveryDispute && order.returnReportedAt
                      ? ' · '
                      : ''}
                    {order.returnReportedAt ? 'إرجاع' : ''}
                  </small>
                )}
              </span>
              <span>
                {money(order.merchantTotalMinor)}
                <small>
                  {(order.routeDistanceMeters / 1_000).toFixed(1)} كم ·{' '}
                  {order.serviceZone.name}
                </small>
              </span>
              <button onClick={() => onOpen(order.id)}>فتح</button>
            </article>
          ))}
          {orders.length === 0 && (
            <p className="empty-state">لا توجد طلبات تطابق المرشحات.</p>
          )}
        </div>
        {total > 25 && (
          <div className="pagination-controls" aria-label="صفحات الطلبات">
            <button
              disabled={page === 1 || busy}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              السابق
            </button>
            <span>
              الصفحة {page} من {Math.ceil(total / 25)}
            </span>
            <button
              disabled={page >= Math.ceil(total / 25) || busy}
              onClick={() => setPage((current) => current + 1)}
            >
              التالي
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export type ZoneFinanceDashboard = {
  zones: Array<{
    id: string;
    name: string;
    city: string;
    governorate: string;
    status: string;
    courierCount: number;
    openSettlements: number;
    overdueSettlements: number;
    outstandingMinor: number;
    collectedTodayMinor: number;
    collectedMonthMinor: number;
    lastActivityAt: string | null;
  }>;
};

export type ZoneFinanceDetail = {
  zone: { id: string; name: string; city: string; governorate: string };
  summary: {
    courierCount: number;
    openSettlements: number;
    overdueSettlements: number;
    dueMinor: number;
    paidMinor: number;
    outstandingMinor: number;
    collectedTodayMinor: number;
    collectedMonthMinor: number;
  };
  couriers: Array<{
    courier: {
      id: string;
      fullName: string;
      preferredCity: string | null;
      user: { phone: string; status: string };
    };
    settlementStatus: string;
    dueAt: string | null;
    dueMinor: number;
    paidMinor: number;
    completedOrders: number;
    returnedOrders: number;
    grossOrderValueMinor: number;
    platformCommissionDueMinor: number;
    outstandingMinor: number;
    lastPaymentAt: string | null;
    lastActivityAt: string | null;
  }>;
};

export function ZoneFinanceView({
  token,
  onOpenGeneral,
}: {
  token: Token;
  onOpenGeneral: () => void;
}) {
  const [dashboard, setDashboard] = useState<ZoneFinanceDashboard>();
  const [selected, setSelected] = useState<ZoneFinanceDetail>();
  const [search, setSearch] = useState('');
  const [settlementStatus, setSettlementStatus] = useState('');
  const [activityFrom, setActivityFrom] = useState('');
  const [activityTo, setActivityTo] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setDashboard(
        await request<ZoneFinanceDashboard>('/admin/finance/zones', token),
      );
      setError('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token]);
  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  async function openZone(zoneId: string) {
    setBusy(true);
    setPage(1);
    try {
      setSelected(
        await request<ZoneFinanceDetail>(
          `/admin/finance/zones/${zoneId}`,
          token,
        ),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    const filteredCouriers = selected.couriers.filter((row) => {
      const activity = row.lastActivityAt ? new Date(row.lastActivityAt) : null;
      const from = activityFrom ? new Date(activityFrom) : null;
      const to = activityTo ? new Date(`${activityTo}T23:59:59.999`) : null;
      return (
        (!search ||
          row.courier.fullName.includes(search) ||
          row.courier.user.phone.includes(search)) &&
        (!settlementStatus || row.settlementStatus === settlementStatus) &&
        (!from || (activity && activity >= from)) &&
        (!to || (activity && activity <= to))
      );
    });
    const visibleCouriers = filteredCouriers.slice((page - 1) * 25, page * 25);
    return (
      <div className="operations-workspace">
        <button className="back" onClick={() => setSelected(undefined)}>
          → العودة إلى المناطق
        </button>
        {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
        {error && <p className="alert">{error}</p>}
        <div className="workspace-toolbar">
          <div>
            <p className="kicker">
              {selected.zone.governorate} · {selected.zone.city}
            </p>
            <h2>مالية {selected.zone.name}</h2>
          </div>
          <button onClick={() => void openZone(selected.zone.id)}>تحديث</button>
        </div>
        <section className="summary-grid">
          {[
            ['المندوبون', selected.summary.courierCount],
            ['تسويات مفتوحة', selected.summary.openSettlements],
            ['تسويات متأخرة', selected.summary.overdueSettlements],
            ['إجمالي المستحق', money(selected.summary.dueMinor)],
            ['المدفوع المؤكد', money(selected.summary.paidMinor)],
            ['المتبقي', money(selected.summary.outstandingMinor)],
            ['محصل اليوم', money(selected.summary.collectedTodayMinor)],
            ['محصل الشهر', money(selected.summary.collectedMonthMinor)],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
        <section className="admin-card operations-filters">
          <label>
            بحث باسم المندوب أو الهاتف
            <input
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </label>
          <label>
            حالة التسوية
            <select
              value={settlementStatus}
              onChange={(event) => {
                setPage(1);
                setSettlementStatus(event.target.value);
              }}
            >
              <option value="">كل الحالات</option>
              {[
                'OPEN',
                'NOT_DUE',
                'DUE_SOON',
                'PARTIALLY_PAID',
                'PAID',
                'OVERDUE',
                'WAIVED',
                'ADJUSTED',
                'CLOSED',
              ].map((status) => (
                <option key={status} value={status}>
                  {statusLabel[status] ?? status}
                </option>
              ))}
            </select>
          </label>
          <label>
            النشاط من
            <input
              type="date"
              value={activityFrom}
              onChange={(event) => {
                setPage(1);
                setActivityFrom(event.target.value);
              }}
            />
          </label>
          <label>
            النشاط إلى
            <input
              type="date"
              value={activityTo}
              onChange={(event) => {
                setPage(1);
                setActivityTo(event.target.value);
              }}
            />
          </label>
        </section>
        <section className="admin-card table-card">
          <div className="responsive-table operations-table finance-zone-table">
            <div className="table-head">
              <span>المندوب</span>
              <span>الحالة</span>
              <span>المستحق</span>
              <span>المدفوع</span>
              <span>المتبقي</span>
              <span>الموعد والنشاط</span>
            </div>
            {visibleCouriers.map((row) => (
              <article className="table-row" key={row.courier.id}>
                <div>
                  <strong>{row.courier.fullName}</strong>
                  <small dir="ltr">{row.courier.user.phone}</small>
                </div>
                <span>
                  {statusLabel[row.settlementStatus] ?? row.settlementStatus}
                  <small>
                    مكتملة {row.completedOrders} · مرتجعة {row.returnedOrders}
                  </small>
                </span>
                <span>
                  {money(row.dueMinor)}
                  <small>قيمة الطلبات {money(row.grossOrderValueMinor)}</small>
                </span>
                <span>
                  {money(row.paidMinor)}
                  <small>آخر دفعة {formatDate(row.lastPaymentAt)}</small>
                </span>
                <span>
                  {money(row.outstandingMinor)}
                  <small>
                    عمولة المنصة {money(row.platformCommissionDueMinor)}
                  </small>
                </span>
                <span>
                  الاستحقاق {formatDate(row.dueAt)}
                  <small>آخر نشاط {formatDate(row.lastActivityAt)}</small>
                </span>
              </article>
            ))}
          </div>
          {filteredCouriers.length > 25 && (
            <div
              className="pagination-controls"
              aria-label="صفحات حسابات المندوبين"
            >
              <button
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                السابق
              </button>
              <span>
                الصفحة {page} من {Math.ceil(filteredCouriers.length / 25)}
              </span>
              <button
                disabled={page >= Math.ceil(filteredCouriers.length / 25)}
                onClick={() => setPage((current) => current + 1)}
              >
                التالي
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="operations-workspace">
      <div className="workspace-toolbar">
        <div>
          <p className="kicker">حسابات من نفس سجل التسويات</p>
          <h2>المالية حسب المنطقة</h2>
        </div>
        <div className="row-actions">
          <button onClick={onOpenGeneral}>الأدوات المالية العامة</button>
          <button onClick={() => void load()} disabled={busy}>
            تحديث
          </button>
        </div>
      </div>
      {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
      {error && <p className="alert">{error}</p>}
      <p className="notice">
        تُعرض الدفعات المؤكدة فقط. يُنسب كل مبلغ إلى مناطق الطلبات داخل فترة
        التسوية نفسها دون خلط أو إنشاء حساب موازٍ. التوقيت: Africa/Cairo.
      </p>
      <section className="zone-card-grid finance-zone-cards">
        {dashboard?.zones.map((zone) => (
          <button
            className="admin-card zone-operations-card"
            key={zone.id}
            onClick={() => void openZone(zone.id)}
          >
            <span className={`state state-${zone.status.toLowerCase()}`}>
              {statusLabel[zone.status] ?? zone.status}
            </span>
            <h3>{zone.name}</h3>
            <p>
              {zone.governorate} · {zone.city}
            </p>
            <dl>
              <div>
                <dt>المندوبون</dt>
                <dd>{zone.courierCount}</dd>
              </div>
              <div>
                <dt>مفتوحة / متأخرة</dt>
                <dd>
                  {zone.openSettlements} / {zone.overdueSettlements}
                </dd>
              </div>
              <div>
                <dt>المتبقي</dt>
                <dd>{money(zone.outstandingMinor)}</dd>
              </div>
              <div>
                <dt>اليوم / الشهر</dt>
                <dd>
                  {money(zone.collectedTodayMinor)} /{' '}
                  {money(zone.collectedMonthMinor)}
                </dd>
              </div>
            </dl>
            <small>آخر نشاط: {formatDate(zone.lastActivityAt)}</small>
          </button>
        ))}
      </section>
    </div>
  );
}
