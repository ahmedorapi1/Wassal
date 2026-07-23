'use client';

import { useCallback, useState, type FormEvent } from 'react';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type Token = { accessToken: string };
type Courier = {
  id: string;
  fullName: string;
  verificationStatus: string;
  preferredCity: string | null;
  version: number;
  statusReason: string | null;
  user: { phone: string; status: string };
  _count?: { documents: number; vehicles: number };
  documents?: Document[];
  vehicles?: Array<{ id: string; plateNumber: string; active: boolean }>;
};
type Document = {
  id: string;
  type: string;
  status: string;
  reviewVersion: number;
  originalFilename: string;
  expiresAt: string | null;
  reviewNotes: string | null;
  isCurrent: boolean;
};
type Merchant = {
  id: string;
  displayName: string;
  legalName: string;
  status: string;
  _count: { stores: number; memberships: number };
};
type MerchantDetail = Merchant & {
  stores: Array<{ id: string; name: string; city: string; status: string }>;
  memberships: Array<{
    id: string;
    role: string;
    active: boolean;
    user: { displayName: string | null; phone: string };
  }>;
};
type Audit = {
  id: string;
  action: string;
  createdAt: string;
  actorRole: string | null;
};

async function request<T>(
  path: string,
  token: Token | undefined,
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
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(body.error?.message ?? 'تعذر تنفيذ الإجراء');
  return body;
}

const statusArabic: Record<string, string> = {
  INCOMPLETE: 'غير مكتمل',
  PENDING_REVIEW: 'قيد المراجعة',
  CHANGES_REQUESTED: 'مطلوب تعديل',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  SUSPENDED: 'موقوف',
  PENDING: 'بانتظار المراجعة',
};

export function AdminApp() {
  const [phone, setPhone] = useState('01001000004');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('123456');
  const [token, setToken] = useState<Token>();
  const [tab, setTab] = useState<
    'queue' | 'approved' | 'exceptions' | 'merchants'
  >('queue');
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantDetail, setMerchantDetail] = useState<MerchantDetail>();
  const [selected, setSelected] = useState<Courier>();
  const [audit, setAudit] = useState<Audit[]>([]);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(
    async (activeToken: Token, activeTab = tab) => {
      if (activeTab === 'merchants') {
        setMerchants(await request('/admin/merchants', activeToken));
        return;
      }
      const status =
        activeTab === 'queue'
          ? 'PENDING_REVIEW'
          : activeTab === 'approved'
            ? 'APPROVED'
            : undefined;
      setCouriers(
        await request(
          `/admin/couriers${status ? `?status=${status}` : ''}`,
          activeToken,
        ),
      );
    },
    [tab],
  );

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await request<{ challengeId: string }>(
        '/auth/request-otp',
        undefined,
        { method: 'POST', body: JSON.stringify({ phone }) },
      );
      setChallengeId(result.challengeId);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await request<{ tokens: Token }>(
        '/auth/verify-otp',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify({ challengeId, code: otp }),
        },
      );
      setToken(result.tokens);
      await load(result.tokens, 'queue');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function openCourier(id: string) {
    if (!token) return;
    const [detail, history] = await Promise.all([
      request<Courier>(`/admin/couriers/${id}`, token),
      request<Audit[]>(`/admin/couriers/${id}/audit-log`, token),
    ]);
    setSelected(detail);
    setAudit(history);
    setReason('');
  }

  async function openMerchant(id: string) {
    if (!token) return;
    setMerchantDetail(
      await request<MerchantDetail>(`/admin/merchants/${id}`, token),
    );
  }

  async function reviewDocument(
    document: Document,
    action: 'approve' | 'reject' | 'request-replacement',
  ) {
    if (!token || !selected) return;
    if (action !== 'approve' && reason.trim().length < 3) {
      setMessage('اكتب سبباً واضحاً قبل تنفيذ الإجراء.');
      return;
    }
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
      await openCourier(selected.id);
      setMessage('تم تسجيل قرار مراجعة المستند.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function transition(
    action: 'approve' | 'reject' | 'suspend' | 'reactivate',
  ) {
    if (!token || !selected) return;
    if (['reject', 'suspend'].includes(action) && reason.trim().length < 3) {
      setMessage('سبب القرار مطلوب.');
      return;
    }
    try {
      await request(`/admin/couriers/${selected.id}/${action}`, token, {
        method: 'POST',
        body: JSON.stringify({
          version: selected.version,
          ...(['reject', 'suspend'].includes(action) ? { reason } : {}),
        }),
      });
      setSelected(undefined);
      await load(token);
      setMessage('تم تحديث حالة المندوب وحفظ سجل التدقيق.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function viewFile(document: Document) {
    if (!token) return;
    const response = await fetch(
      `${apiUrl}/couriers/documents/${document.id}/file`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    );
    if (!response.ok) {
      setMessage('تعذر فتح الملف.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function navigate(nextTab: typeof tab) {
    setTab(nextTab);
    setSelected(undefined);
    setMerchantDetail(undefined);
    if (token) void load(token, nextTab);
  }

  if (!token) {
    return (
      <main className="admin-login">
        <section className="login-panel">
          <div className="admin-brand">
            <span>و</span>
            <strong>واصل · العمليات</strong>
          </div>
          <p className="kicker">بوابة داخلية آمنة</p>
          <h1>{challengeId ? 'تحقق من هويتك' : 'تسجيل دخول الإدارة'}</h1>
          <p>هذه المساحة مخصصة لفريق العمليات والمسؤولين المخولين.</p>
          {!challengeId ? (
            <form onSubmit={requestOtp}>
              <label>
                رقم الموبايل
                <input
                  dir="ltr"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              <button>متابعة</button>
            </form>
          ) : (
            <form onSubmit={verify}>
              <label>
                رمز التحقق
                <input
                  dir="ltr"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                />
              </label>
              <button>دخول لوحة العمليات</button>
            </form>
          )}
          {message && <p className="alert">{message}</p>}
        </section>
        <aside className="security-note">
          <span>مصادقة مطلوبة</span>
          <h2>كل قرار مراجعة موثق.</h2>
          <p>الموافقات والرفض والتعليق تحفظ مع هوية المسؤول ووقت الإجراء.</p>
        </aside>
      </main>
    );
  }

  if (selected) {
    const documents = selected.documents ?? [];
    return (
      <div className="admin-shell">
        <AdminNav tab={tab} setTab={navigate} />
        <main className="admin-main">
          <button className="back" onClick={() => setSelected(undefined)}>
            → العودة إلى القائمة
          </button>
          <header className="case-header">
            <div>
              <p className="kicker">طلب توثيق مندوب</p>
              <h1>{selected.fullName}</h1>
              <p dir="ltr">{selected.user.phone}</p>
            </div>
            <span
              className={`state state-${selected.verificationStatus.toLowerCase()}`}
            >
              {statusArabic[selected.verificationStatus] ??
                selected.verificationStatus}
            </span>
          </header>
          {message && <p className="alert success">{message}</p>}
          <div className="case-grid">
            <section className="admin-card documents">
              <div className="card-title">
                <div>
                  <p className="kicker">المستندات الحالية</p>
                  <h2>مراجعة الملفات</h2>
                </div>
                <span>
                  {documents.filter((row) => row.status === 'APPROVED').length}/
                  {documents.length}
                </span>
              </div>
              {documents.map((document) => (
                <article className="document-row" key={document.id}>
                  <button
                    className="file-icon"
                    onClick={() => viewFile(document)}
                    aria-label={`فتح ${document.originalFilename}`}
                  >
                    PDF
                  </button>
                  <div>
                    <strong>{document.type.replaceAll('_', ' ')}</strong>
                    <small>{document.originalFilename}</small>
                    {document.reviewNotes && (
                      <small className="warning">{document.reviewNotes}</small>
                    )}
                  </div>
                  <span
                    className={`state state-${document.status.toLowerCase()}`}
                  >
                    {statusArabic[document.status] ?? document.status}
                  </span>
                  {document.isCurrent && (
                    <div className="row-actions">
                      <button
                        onClick={() => reviewDocument(document, 'approve')}
                      >
                        قبول
                      </button>
                      <button
                        onClick={() =>
                          reviewDocument(document, 'request-replacement')
                        }
                      >
                        إعادة رفع
                      </button>
                      <button
                        className="danger-link"
                        onClick={() => reviewDocument(document, 'reject')}
                      >
                        رفض
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </section>
            <aside>
              <section className="admin-card">
                <p className="kicker">معلومات الطلب</p>
                <dl>
                  <div>
                    <dt>المدينة</dt>
                    <dd>{selected.preferredCity ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>المركبة</dt>
                    <dd>
                      {selected.vehicles?.[0]?.plateNumber ?? 'غير مسجلة'}
                    </dd>
                  </div>
                  <div>
                    <dt>حالة الحساب</dt>
                    <dd>{selected.user.status}</dd>
                  </div>
                </dl>
              </section>
              <section className="admin-card decision-card">
                <h2>قرار المراجعة</h2>
                <label>
                  سبب الرفض أو التعليق أو إعادة الرفع
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="السبب مطلوب لهذه الإجراءات"
                  />
                </label>
                <div className="decision-actions">
                  {selected.verificationStatus === 'PENDING_REVIEW' && (
                    <>
                      <button
                        className="approve"
                        onClick={() => transition('approve')}
                      >
                        اعتماد الحساب
                      </button>
                      <button
                        className="danger"
                        onClick={() => transition('reject')}
                      >
                        رفض الطلب
                      </button>
                    </>
                  )}
                  {selected.verificationStatus === 'APPROVED' && (
                    <button
                      className="danger"
                      onClick={() => transition('suspend')}
                    >
                      تعليق الحساب
                    </button>
                  )}
                  {selected.verificationStatus === 'SUSPENDED' && (
                    <button
                      className="approve"
                      onClick={() => transition('reactivate')}
                    >
                      إعادة التفعيل
                    </button>
                  )}
                </div>
              </section>
            </aside>
          </div>
          <section className="admin-card timeline">
            <p className="kicker">سجل التدقيق</p>
            <h2>آخر الإجراءات</h2>
            {audit.map((entry) => (
              <div key={entry.id}>
                <span className="timeline-dot" />
                <strong>{entry.action}</strong>
                <time>{new Date(entry.createdAt).toLocaleString('ar-EG')}</time>
              </div>
            ))}
            {audit.length === 0 && <p>لا توجد إجراءات مسجلة بعد.</p>}
          </section>
        </main>
      </div>
    );
  }

  if (merchantDetail) {
    return (
      <div className="admin-shell">
        <AdminNav tab={tab} setTab={navigate} />
        <main className="admin-main">
          <button className="back" onClick={() => setMerchantDetail(undefined)}>
            → العودة إلى التجار
          </button>
          <header className="case-header">
            <div>
              <p className="kicker">تفاصيل المؤسسة</p>
              <h1>{merchantDetail.displayName}</h1>
              <p>{merchantDetail.legalName}</p>
            </div>
            <span className="state state-approved">
              {merchantDetail.status}
            </span>
          </header>
          <div className="case-grid">
            <section className="admin-card">
              <div className="card-title">
                <div>
                  <p className="kicker">المواقع</p>
                  <h2>الفروع</h2>
                </div>
                <span>{merchantDetail.stores.length}</span>
              </div>
              {merchantDetail.stores.map((store) => (
                <article className="document-row merchant-row" key={store.id}>
                  <div>
                    <strong>{store.name}</strong>
                    <small>{store.city}</small>
                  </div>
                  <span
                    className={`state ${store.status === 'ACTIVE' ? 'state-approved' : ''}`}
                  >
                    {store.status}
                  </span>
                </article>
              ))}
            </section>
            <section className="admin-card">
              <div className="card-title">
                <div>
                  <p className="kicker">العضويات</p>
                  <h2>فريق التاجر</h2>
                </div>
                <span>{merchantDetail.memberships.length}</span>
              </div>
              {merchantDetail.memberships.map((membership) => (
                <article className="merchant-member" key={membership.id}>
                  <div>
                    <strong>{membership.user.displayName ?? 'مستخدم'}</strong>
                    <small dir="ltr">{membership.user.phone}</small>
                  </div>
                  <span
                    className={`state ${membership.active ? 'state-approved' : ''}`}
                  >
                    {membership.role}
                  </span>
                </article>
              ))}
            </section>
          </div>
        </main>
      </div>
    );
  }

  const visibleCouriers =
    tab === 'exceptions'
      ? couriers.filter((row) =>
          ['REJECTED', 'SUSPENDED', 'CHANGES_REQUESTED'].includes(
            row.verificationStatus,
          ),
        )
      : couriers;

  return (
    <div className="admin-shell">
      <AdminNav tab={tab} setTab={navigate} />
      <main className="admin-main">
        <header className="dashboard-header">
          <div>
            <p className="kicker">المرحلة الأولى</p>
            <h1>صباح الخير، فريق العمليات</h1>
            <p>راجع طلبات المندوبين وتابع حسابات التجار.</p>
          </div>
          <span className="live-indicator">النظام يعمل</span>
        </header>
        {message && <p className="alert success">{message}</p>}
        <section className="summary-grid">
          <article>
            <span>طلبات تنتظر المراجعة</span>
            <strong>{tab === 'queue' ? couriers.length : '—'}</strong>
            <small>ابدأ بالأقدم</small>
          </article>
          <article>
            <span>مندوبون معتمدون</span>
            <strong>{tab === 'approved' ? couriers.length : '—'}</strong>
            <small>حسابات صالحة</small>
          </article>
          <article>
            <span>حالات تحتاج متابعة</span>
            <strong>
              {tab === 'exceptions' ? visibleCouriers.length : '—'}
            </strong>
            <small>رفض · تعليق · تعديل</small>
          </article>
        </section>
        <section className="admin-card table-card">
          <div className="card-title">
            <div>
              <p className="kicker">
                {tab === 'merchants' ? 'دليل المؤسسات' : 'طابور التحقق'}
              </p>
              <h2>{tab === 'merchants' ? 'التجار' : 'طلبات المندوبين'}</h2>
            </div>
            <button className="refresh" onClick={() => load(token, tab)}>
              تحديث
            </button>
          </div>
          {tab === 'merchants' ? (
            <div className="responsive-table">
              <div className="table-head">
                <span>التاجر</span>
                <span>الفروع</span>
                <span>الفريق</span>
                <span>الحالة</span>
              </div>
              {merchants.map((merchant) => (
                <article className="table-row" key={merchant.id}>
                  <div>
                    <strong>{merchant.displayName}</strong>
                    <small>{merchant.legalName}</small>
                  </div>
                  <span>{merchant._count.stores}</span>
                  <span>{merchant._count.memberships}</span>
                  <span className="state state-approved">
                    {merchant.status}
                  </span>
                  <button onClick={() => openMerchant(merchant.id)}>
                    عرض التفاصيل
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="responsive-table">
              <div className="table-head">
                <span>المندوب</span>
                <span>المدينة</span>
                <span>المستندات</span>
                <span>الحالة</span>
                <span />
              </div>
              {visibleCouriers.map((courier) => (
                <article className="table-row" key={courier.id}>
                  <div>
                    <strong>{courier.fullName}</strong>
                    <small dir="ltr">{courier.user.phone}</small>
                  </div>
                  <span>{courier.preferredCity ?? '—'}</span>
                  <span>{courier._count?.documents ?? 0}</span>
                  <span
                    className={`state state-${courier.verificationStatus.toLowerCase()}`}
                  >
                    {statusArabic[courier.verificationStatus] ??
                      courier.verificationStatus}
                  </span>
                  <button onClick={() => openCourier(courier.id)}>
                    فتح الطلب
                  </button>
                </article>
              ))}
              {visibleCouriers.length === 0 && (
                <p className="empty">لا توجد سجلات في هذا القسم.</p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AdminNav({
  tab,
  setTab,
}: {
  tab: 'queue' | 'approved' | 'exceptions' | 'merchants';
  setTab: (tab: 'queue' | 'approved' | 'exceptions' | 'merchants') => void;
}) {
  return (
    <aside className="admin-nav">
      <div className="admin-brand">
        <span>و</span>
        <strong>واصل</strong>
      </div>
      <p>إدارة العمليات</p>
      <nav>
        <button
          className={tab === 'queue' ? 'active' : ''}
          onClick={() => setTab('queue')}
        >
          طلبات التوثيق
        </button>
        <button
          className={tab === 'approved' ? 'active' : ''}
          onClick={() => setTab('approved')}
        >
          المندوبون المعتمدون
        </button>
        <button
          className={tab === 'exceptions' ? 'active' : ''}
          onClick={() => setTab('exceptions')}
        >
          الرفض والتعليق
        </button>
        <button
          className={tab === 'merchants' ? 'active' : ''}
          onClick={() => setTab('merchants')}
        >
          التجار
        </button>
      </nav>
      <small>Phase 1 · نطاق الهوية والتوثيق</small>
    </aside>
  );
}
