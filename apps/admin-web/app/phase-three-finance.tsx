'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type Token = { accessToken: string };
type User = {
  displayName: string;
  phone: string;
  role: 'operations_admin' | 'finance_admin' | 'super_admin' | string;
};
type Settings = {
  id: string;
  version: number;
  defaultCommissionBasisPoints: number;
  settlementCycle: 'WEEKLY';
  gracePeriodDays: number;
  operationsTimezone: 'Africa/Cairo';
  effectiveFrom: string;
};
type SettingsResponse = { current: Settings; history: Settings[] };
type Summary = {
  acceptedOrders: number;
  completedOrders: number;
  returnedOrders: number;
  totalCommissionDueMinor: number;
  totalRecordedPaymentsMinor: number;
  totalAdjustmentsMinor: number;
  totalWaivedMinor: number;
  remainingAmountMinor: number;
};
type AccountListItem = {
  courier: {
    id: string;
    fullName: string;
    preferredCity: string | null;
    user: { phone: string; status: string };
    serviceZones: Array<{ serviceZone: { name: string; city: string } }>;
  };
  summary: Summary;
};
type LedgerEntry = {
  id: string;
  type: string;
  amountMinor: number;
  description: string;
  occurredAt: string;
  order?: { orderNumber: string } | null;
};
type Payment = {
  id: string;
  amountMinor: number;
  paidAt: string;
  method: string;
  externalReference: string | null;
  reversedBy: { id: string } | null;
};
type Audit = {
  id: string;
  action: string;
  actorRole?: string | null;
  createdAt: string;
};
type AccountDetail = {
  courier: AccountListItem['courier'];
  summary: Summary;
  entries: LedgerEntry[];
  settlements: Settlement[];
  payments: Payment[];
  audit: Audit[];
};
type Settlement = {
  id: string;
  courierId: string;
  status: string;
  version: number;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  totalDueMinor: number;
  totalPaidMinor: number;
  remainingAmountMinor: number;
  daysRemaining: number;
  courier?: {
    id: string;
    fullName: string;
    user: { phone: string };
  };
  canClose?: boolean;
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
  };
  if (!response.ok) {
    const raw = body.error?.message;
    throw new Error(
      typeof raw === 'string'
        ? raw
        : (raw?.message ?? 'تعذر تنفيذ الإجراء المالي.'),
    );
  }
  return body;
}

const money = (minor: number) =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(minor / 100);

const key = (scope: string) => `${scope}-${crypto.randomUUID()}`;

export function PhaseThreeFinance({ token }: { token: Token }) {
  const [user, setUser] = useState<User>();
  const [settings, setSettings] = useState<SettingsResponse>();
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [selected, setSelected] = useState<AccountDetail>();
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const currentUser = await request<User>('/me', token);
      setError('');
      setUser(currentUser);
      if (!['finance_admin', 'super_admin'].includes(currentUser.role)) {
        setSettings(undefined);
        setAccounts([]);
        setSettlements([]);
        return;
      }
      const [currentSettings, accountPage, settlementPage] = await Promise.all([
        request<SettingsResponse>('/admin/financial-settings', token),
        request<{ items: AccountListItem[] }>(
          `/admin/courier-accounts?page=1&pageSize=100${filter ? `&city=${encodeURIComponent(filter)}` : ''}`,
          token,
        ),
        request<{ items: Settlement[] }>(
          '/admin/settlements?page=1&pageSize=100',
          token,
        ),
      ]);
      setSettings(currentSettings);
      setAccounts(accountPage.items);
      const loadedAt = Date.now();
      setSettlements(
        settlementPage.items.map((period) => ({
          ...period,
          canClose: new Date(period.periodEnd).getTime() <= loadedAt,
        })),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [filter, token]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  async function openAccount(courierId: string) {
    setBusy(true);
    try {
      setSelected(
        await request<AccountDetail>(
          `/admin/couriers/${courierId}/account`,
          token,
        ),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || user?.role !== 'super_admin') return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request('/admin/financial-settings', token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: settings.current.version,
          defaultCommissionBasisPoints: Number(form.get('basisPoints')),
          settlementCycle: 'WEEKLY',
          gracePeriodDays: Number(form.get('graceDays')),
          operationsTimezone: 'Africa/Cairo',
        }),
      });
      setMessage('تم إنشاء نسخة جديدة من الإعدادات المالية.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeSettlement(period: Settlement) {
    setBusy(true);
    try {
      await request(`/admin/settlements/${period.id}/close`, token, {
        method: 'POST',
        headers: { 'Idempotency-Key': key('close-settlement') },
        body: JSON.stringify({ version: period.version }),
      });
      setMessage('تم إغلاق التسوية وتثبيت سطورها.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request(
        `/admin/couriers/${selected.courier.id}/external-payments`,
        token,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key('external-payment') },
          body: JSON.stringify({
            amountMinor: Math.round(Number(form.get('amount')) * 100),
            currency: 'EGP',
            paidAt: new Date(String(form.get('paidAt'))).toISOString(),
            method: form.get('method'),
            externalReference: form.get('reference') || undefined,
            note: form.get('note') || undefined,
          }),
        },
      );
      setMessage('تم تسجيل الدفعة الخارجية وتوزيعها على أقدم مستحقات أولاً.');
      await openAccount(selected.courier.id);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || user?.role !== 'super_admin') return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request(
        `/admin/couriers/${selected.courier.id}/adjustments`,
        token,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key('adjustment') },
          body: JSON.stringify({
            type: form.get('type'),
            amountMinor: Math.round(Number(form.get('amount')) * 100),
            reason: form.get('reason'),
          }),
        },
      );
      setMessage('تمت إضافة قيد مستقل دون تعديل السجل التاريخي.');
      await openAccount(selected.courier.id);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment(payment: Payment) {
    if (!selected || user?.role !== 'super_admin') return;
    setBusy(true);
    try {
      await request(`/admin/external-payments/${payment.id}/reverse`, token, {
        method: 'POST',
        headers: { 'Idempotency-Key': key('reverse-payment') },
      });
      setMessage('تم عكس الدفعة بقيد جديد، وبقي الأصل محفوظاً.');
      await openAccount(selected.courier.id);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (user && !['finance_admin', 'super_admin'].includes(user.role)) {
    return (
      <section className="admin-card finance-denied">
        <p className="kicker">صلاحيات منفصلة</p>
        <h2>مساحة المالية غير متاحة لدور العمليات</h2>
        <p>
          الحساب الحالي ({user.displayName}) يستطيع إدارة العمليات، لكنه لا يملك
          قراءة حسابات المندوبين أو تسجيل الدفعات.
        </p>
      </section>
    );
  }

  return (
    <div className="finance-workspace">
      {busy && <p className="alert success">جارٍ تحديث البيانات…</p>}
      {message && <p className="alert success">{message}</p>}
      {error && <p className="alert">{error}</p>}
      <section className="summary-grid">
        <article>
          <span>حسابات المندوبين</span>
          <strong>{accounts.length}</strong>
        </article>
        <article>
          <span>تسويات مفتوحة</span>
          <strong>
            {settlements.filter((row) => row.status === 'OPEN').length}
          </strong>
        </article>
        <article>
          <span>متأخرة</span>
          <strong>
            {settlements.filter((row) => row.status === 'OVERDUE').length}
          </strong>
        </article>
        <article>
          <span>إجمالي المتبقي</span>
          <strong>
            {money(
              accounts.reduce(
                (sum, row) => sum + row.summary.remainingAmountMinor,
                0,
              ),
            )}
          </strong>
        </article>
      </section>

      {settings && (
        <section className="admin-card">
          <p className="kicker">إعدادات مالية بإصدارات</p>
          <h2>السياسة الحالية</h2>
          <form className="finance-settings" onSubmit={saveSettings}>
            <label>
              العمولة (نقطة أساس)
              <input
                name="basisPoints"
                type="number"
                min="0"
                max="10000"
                defaultValue={settings.current.defaultCommissionBasisPoints}
                readOnly={user?.role !== 'super_admin'}
              />
            </label>
            <label>
              أيام المهلة
              <input
                name="graceDays"
                type="number"
                min="0"
                max="60"
                defaultValue={settings.current.gracePeriodDays}
                readOnly={user?.role !== 'super_admin'}
              />
            </label>
            <label>
              الدورة
              <input value="أسبوعية" readOnly />
            </label>
            <label>
              المنطقة الزمنية
              <input value="Africa/Cairo" readOnly dir="ltr" />
            </label>
            {user?.role === 'super_admin' && <button>حفظ كنسخة جديدة</button>}
          </form>
          <details>
            <summary>سجل النسخ ({settings.history.length})</summary>
            <div className="readable-history">
              {settings.history.map((version) => (
                <article key={version.id}>
                  <strong>النسخة {version.version}</strong>
                  <span>
                    العمولة {version.defaultCommissionBasisPoints / 100}%
                  </span>
                  <span>المهلة {version.gracePeriodDays} أيام</span>
                  <span>
                    سارية من{' '}
                    {new Date(version.effectiveFrom).toLocaleString('ar-EG', {
                      timeZone: 'Africa/Cairo',
                    })}
                  </span>
                </article>
              ))}
            </div>
          </details>
        </section>
      )}

      <section className="admin-card table-card">
        <div className="finance-toolbar">
          <div>
            <p className="kicker">كشف حساب مستقل</p>
            <h2>حسابات المندوبين</h2>
          </div>
          <label>
            المدينة
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="دمياط"
            />
          </label>
        </div>
        <div className="finance-table">
          {accounts.map((row) => (
            <button
              className="finance-row"
              key={row.courier.id}
              onClick={() => void openAccount(row.courier.id)}
            >
              <span>
                <strong>{row.courier.fullName}</strong>
                <small dir="ltr">{row.courier.user.phone}</small>
              </span>
              <span>{row.courier.preferredCity ?? '—'}</span>
              <span>{row.summary.completedOrders} مكتمل</span>
              <strong>{money(row.summary.remainingAmountMinor)}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="admin-card table-card">
        <p className="kicker">الدورات الأسبوعية</p>
        <h2>التسويات</h2>
        {settlements.map((period) => (
          <div className="finance-row" key={period.id}>
            <span>
              <strong>{period.courier?.fullName ?? period.courierId}</strong>
              <small>{period.status}</small>
            </span>
            <span>{money(period.totalDueMinor)} مستحق</span>
            <span>{money(period.remainingAmountMinor)} متبقٍ</span>
            <span>{period.daysRemaining} يوم</span>
            {period.status === 'OPEN' && period.canClose && (
              <button onClick={() => void closeSettlement(period)}>
                إغلاق
              </button>
            )}
            <a
              href={`${apiUrl}/admin/settlements/${period.id}/export.csv`}
              onClick={(event) => {
                event.preventDefault();
                void fetch(
                  `${apiUrl}/admin/settlements/${period.id}/export.csv`,
                  {
                    headers: {
                      Authorization: `Bearer ${token.accessToken}`,
                    },
                  },
                )
                  .then((response) => response.blob())
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `skka-settlement-${period.id}.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  });
              }}
            >
              CSV
            </a>
          </div>
        ))}
      </section>

      {selected && (
        <section className="admin-card finance-detail">
          <button className="back" onClick={() => setSelected(undefined)}>
            إغلاق كشف الحساب
          </button>
          <h2>{selected.courier.fullName}</h2>
          <p dir="ltr">{selected.courier.user.phone}</p>
          <div className="summary-grid">
            <article>
              <span>العمولة</span>
              <strong>{money(selected.summary.totalCommissionDueMinor)}</strong>
            </article>
            <article>
              <span>الدفعات</span>
              <strong>
                {money(selected.summary.totalRecordedPaymentsMinor)}
              </strong>
            </article>
            <article>
              <span>التعديلات/الإعفاءات</span>
              <strong>
                {money(
                  selected.summary.totalAdjustmentsMinor -
                    selected.summary.totalWaivedMinor,
                )}
              </strong>
            </article>
            <article>
              <span>المتبقي</span>
              <strong>{money(selected.summary.remainingAmountMinor)}</strong>
            </article>
          </div>
          <div className="management-grid">
            <form className="management-form" onSubmit={recordPayment}>
              <h3>تسجيل دفعة خارجية</h3>
              <label>
                المبلغ بالجنيه
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <label>
                وقت الدفع
                <input
                  name="paidAt"
                  type="datetime-local"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                  required
                />
              </label>
              <label>
                الوسيلة
                <select name="method" defaultValue="CASH">
                  <option value="CASH">نقدي</option>
                  <option value="BANK_TRANSFER">تحويل بنكي</option>
                  <option value="MOBILE_WALLET_EXTERNAL">محفظة خارجية</option>
                  <option value="OTHER">أخرى</option>
                </select>
              </label>
              <label>
                مرجع خارجي
                <input name="reference" />
              </label>
              <label>
                ملاحظة
                <textarea name="note" />
              </label>
              <button>تسجيل وتوزيع الدفعة</button>
            </form>
            {user?.role === 'super_admin' && (
              <form className="management-form" onSubmit={addAdjustment}>
                <h3>تعديل أو إعفاء</h3>
                <label>
                  النوع
                  <select name="type">
                    <option value="ADJUSTMENT_DEBIT">مدين</option>
                    <option value="ADJUSTMENT_CREDIT">دائن</option>
                    <option value="WAIVER">إعفاء</option>
                  </select>
                </label>
                <label>
                  المبلغ بالجنيه
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  السبب
                  <textarea name="reason" minLength={3} required />
                </label>
                <button>إضافة قيد مستقل</button>
              </form>
            )}
          </div>
          <h3>القيود</h3>
          {selected.entries.map((entry) => (
            <div className="finance-row" key={entry.id}>
              <span>{entry.type}</span>
              <span>{entry.order?.orderNumber ?? entry.description}</span>
              <span>{new Date(entry.occurredAt).toLocaleString('ar-EG')}</span>
              <strong>{money(entry.amountMinor)}</strong>
            </div>
          ))}
          <h3>الدفعات</h3>
          {selected.payments.map((payment) => (
            <div className="finance-row" key={payment.id}>
              <span>{payment.method}</span>
              <span>{payment.externalReference ?? 'بلا مرجع'}</span>
              <strong>{money(payment.amountMinor)}</strong>
              {user?.role === 'super_admin' && !payment.reversedBy && (
                <button onClick={() => void reversePayment(payment)}>
                  عكس الدفعة
                </button>
              )}
            </div>
          ))}
          <details>
            <summary>سجل التدقيق ({selected.audit.length})</summary>
            <div className="readable-history">
              {selected.audit.map((entry) => (
                <article key={entry.id}>
                  <strong>
                    {entry.action.replaceAll('.', ' ').replaceAll('_', ' ')}
                  </strong>
                  <span>
                    {entry.actorRole?.replaceAll('_', ' ') ?? 'النظام'}
                  </span>
                  <time>
                    {new Date(entry.createdAt).toLocaleString('ar-EG', {
                      timeZone: 'Africa/Cairo',
                    })}
                  </time>
                </article>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
