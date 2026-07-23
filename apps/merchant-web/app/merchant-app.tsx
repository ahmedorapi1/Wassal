'use client';

import { useCallback, useState, type FormEvent } from 'react';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type TokenState = { accessToken: string };
type Merchant = {
  id: string;
  legalName: string;
  displayName: string;
  version: number;
};
type Store = {
  id: string;
  name: string;
  city: string;
  area: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
};
type Staff = {
  id: string;
  active: boolean;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  version: number;
  user: { displayName: string | null; phone: string };
};

async function api<T>(
  path: string,
  options: RequestInit = {},
  token?: TokenState,
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
  if (!response.ok) {
    throw new Error(body.error?.message ?? 'تعذر إتمام الطلب');
  }
  return body;
}

export function MerchantApp() {
  const [phone, setPhone] = useState('01001000001');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('123456');
  const [token, setToken] = useState<TokenState>();
  const [merchant, setMerchant] = useState<Merchant>();
  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tab, setTab] = useState<'home' | 'profile' | 'stores' | 'staff'>(
    'home',
  );
  const [message, setMessage] = useState('');

  const loadWorkspace = useCallback(async (nextToken: TokenState) => {
    try {
      const current = await api<Merchant>('/merchants/current', {}, nextToken);
      setMerchant(current);
      const [storeRows, staffRows] = await Promise.all([
        api<Store[]>('/merchants/current/stores', {}, nextToken),
        api<Staff[]>('/merchants/current/staff', {}, nextToken),
      ]);
      setStores(storeRows);
      setStaff(staffRows);
    } catch {
      setMerchant(undefined);
    }
  }, []);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api<{ challengeId: string }>('/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setChallengeId(result.challengeId);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ tokens: TokenState }>('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          challengeId,
          code: otp,
          registrationRole: 'merchant_owner',
        }),
      });
      setToken(result.tokens);
      await loadWorkspace(result.tokens);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const data = new FormData(event.currentTarget);
    try {
      const created = await api<Merchant>(
        '/merchants',
        {
          method: 'POST',
          body: JSON.stringify({
            legalName: data.get('legalName'),
            displayName: data.get('displayName'),
          }),
        },
        token,
      );
      setMerchant(created);
      await loadWorkspace(token);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function addStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const data = new FormData(event.currentTarget);
    try {
      await api(
        '/merchants/current/stores',
        {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            phone: data.get('phone'),
            addressLine: data.get('addressLine'),
            area: data.get('area'),
            city: data.get('city'),
            latitude: Number(data.get('latitude')),
            longitude: Number(data.get('longitude')),
            workingHours: {
              daily: { open: '09:00', close: '22:00', closed: false },
            },
          }),
        },
        token,
      );
      setStores(await api('/merchants/current/stores', {}, token));
      event.currentTarget.reset();
      setMessage('تم حفظ الفرع.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function inviteStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const data = new FormData(event.currentTarget);
    try {
      await api(
        '/merchants/current/staff',
        {
          method: 'POST',
          body: JSON.stringify({
            displayName: data.get('displayName'),
            phone: data.get('phone'),
            role: data.get('role'),
          }),
        },
        token,
      );
      setStaff(await api('/merchants/current/staff', {}, token));
      event.currentTarget.reset();
      setMessage('تمت إضافة الدعوة.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function updateMerchant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !merchant) return;
    const data = new FormData(event.currentTarget);
    try {
      const updated = await api<Merchant>(
        '/merchants/current',
        {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: data.get('displayName'),
            legalName: data.get('legalName'),
            version: merchant.version,
          }),
        },
        token,
      );
      setMerchant(updated);
      setMessage('تم تحديث بيانات المتجر.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function toggleStore(store: Store) {
    if (!token) return;
    try {
      await api(
        `/merchants/current/stores/${store.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            version: store.version,
            active: store.status !== 'ACTIVE',
          }),
        },
        token,
      );
      setStores(await api('/merchants/current/stores', {}, token));
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function updateStaffMember(
    member: Staff,
    changes: { active?: boolean; role?: string },
  ) {
    if (!token) return;
    try {
      await api(
        `/merchants/current/staff/${member.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            version: member.version,
            ...changes,
          }),
        },
        token,
      );
      setStaff(await api('/merchants/current/staff', {}, token));
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="auth-visual">
          <span className="brand-mark">و</span>
          <p className="eyebrow">واصل للأعمال</p>
          <h1>إدارة متجرك تبدأ من هنا.</h1>
          <p>فريقك وفروعك في مساحة عربية بسيطة وآمنة.</p>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="phase-pill">المرحلة الأولى</span>
          <h2 id="auth-title">
            {challengeId ? 'أدخل رمز التحقق' : 'مرحباً بعودتك'}
          </h2>
          <p className="muted">
            {challengeId
              ? `أرسلنا رمزاً تجريبياً إلى ${phone}`
              : 'استخدم رقم موبايل مصري للدخول أو إنشاء حساب تاجر.'}
          </p>
          {!challengeId ? (
            <form onSubmit={requestOtp} className="stack">
              <label>
                رقم الموبايل
                <input
                  dir="ltr"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  required
                />
              </label>
              <button className="primary">إرسال رمز التحقق</button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="stack">
              <label>
                رمز التحقق
                <input
                  dir="ltr"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
              </label>
              <button className="primary">تأكيد ومتابعة</button>
              <button
                type="button"
                className="text-button"
                onClick={() => setChallengeId('')}
              >
                تغيير الرقم
              </button>
            </form>
          )}
          {message && <p className="notice error">{message}</p>}
        </section>
      </main>
    );
  }

  if (!merchant) {
    return (
      <main className="onboarding-shell">
        <section className="onboarding-card">
          <span className="phase-pill">خطوة ١ من ٢</span>
          <h1>عرّفنا بمتجرك</h1>
          <p className="muted">ستتمكن بعد ذلك من إضافة أول فرع ودعوة فريقك.</p>
          <form onSubmit={onboard} className="form-grid">
            <label>
              الاسم التجاري
              <input
                name="displayName"
                placeholder="مثال: مخبز النيل"
                required
              />
            </label>
            <label>
              الاسم القانوني
              <input
                name="legalName"
                placeholder="اسم المنشأة المسجل"
                required
              />
            </label>
            <button className="primary wide">إنشاء مساحة العمل</button>
          </form>
          {message && <p className="notice error">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>و</span> واصل للأعمال
        </div>
        <nav aria-label="التنقل الرئيسي">
          {[
            ['home', 'نظرة عامة'],
            ['profile', 'بيانات المتجر'],
            ['stores', 'الفروع'],
            ['staff', 'فريق العمل'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key as typeof tab)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="logout"
          onClick={() => {
            setToken(undefined);
            setMerchant(undefined);
          }}
        >
          تسجيل الخروج
        </button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">مساحة التاجر</p>
            <h1>{merchant.displayName}</h1>
          </div>
          <span className="status-dot">حساب نشط</span>
        </header>
        {message && <p className="notice">{message}</p>}

        {tab === 'home' && (
          <>
            <section className="hero-panel">
              <div>
                <span className="phase-pill">قريباً في المرحلة الثانية</span>
                <h2>طلبات التوصيل ستظهر هنا</h2>
                <p>
                  مساحة العمل جاهزة. أكمل بيانات الفروع والفريق الآن، وسيصل
                  إنشاء الطلبات والتتبع في المرحلة التالية.
                </p>
              </div>
              <div className="progress-ring">١</div>
            </section>
            <div className="metric-grid">
              <article>
                <strong>{stores.length}</strong>
                <span>فروع مسجلة</span>
              </article>
              <article>
                <strong>{staff.filter((row) => row.active).length}</strong>
                <span>أعضاء نشطون</span>
              </article>
              <article>
                <strong>٠</strong>
                <span>طلبات — غير متاحة بعد</span>
              </article>
            </div>
          </>
        )}

        {tab === 'profile' && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ملف المؤسسة</p>
                <h2>بيانات المتجر</h2>
              </div>
            </div>
            <form className="stack profile-form" onSubmit={updateMerchant}>
              <label>
                الاسم التجاري
                <input
                  name="displayName"
                  defaultValue={merchant.displayName}
                  required
                />
              </label>
              <label>
                الاسم القانوني
                <input
                  name="legalName"
                  defaultValue={merchant.legalName}
                  required
                />
              </label>
              <div className="profile-meta">
                <span>
                  حالة الحساب <b className="tag success">نشط</b>
                </span>
                <span>نسخة البيانات {merchant.version}</span>
              </div>
              <button className="primary">حفظ التعديلات</button>
            </form>
          </section>
        )}

        {tab === 'stores' && (
          <div className="two-column">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">شبكة الفروع</p>
                  <h2>فروعك</h2>
                </div>
              </div>
              <div className="list">
                {stores.map((store) => (
                  <article className="list-row" key={store.id}>
                    <div>
                      <strong>{store.name}</strong>
                      <span>
                        {store.area}، {store.city}
                      </span>
                    </div>
                    <div className="item-actions">
                      <span
                        className={`tag ${store.status === 'ACTIVE' ? 'success' : ''}`}
                      >
                        {store.status === 'ACTIVE' ? 'نشط' : 'متوقف'}
                      </span>
                      <button onClick={() => toggleStore(store)}>
                        {store.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
                      </button>
                    </div>
                  </article>
                ))}
                {stores.length === 0 && (
                  <p className="empty">لم تضف أي فرع بعد.</p>
                )}
              </div>
            </section>
            <section className="panel">
              <h2>إضافة فرع</h2>
              <form onSubmit={addStore} className="stack compact">
                <label>
                  اسم الفرع
                  <input name="name" required />
                </label>
                <label>
                  الهاتف
                  <input name="phone" defaultValue="01001000001" required />
                </label>
                <label>
                  العنوان
                  <input name="addressLine" required />
                </label>
                <div className="inline-fields">
                  <label>
                    المنطقة
                    <input name="area" defaultValue="الدقي" required />
                  </label>
                  <label>
                    المدينة
                    <input name="city" defaultValue="الجيزة" required />
                  </label>
                </div>
                <div className="inline-fields">
                  <label>
                    خط العرض
                    <input
                      name="latitude"
                      dir="ltr"
                      defaultValue="30.038542"
                      required
                    />
                  </label>
                  <label>
                    خط الطول
                    <input
                      name="longitude"
                      dir="ltr"
                      defaultValue="31.205856"
                      required
                    />
                  </label>
                </div>
                <button className="primary">حفظ الفرع</button>
              </form>
            </section>
          </div>
        )}

        {tab === 'staff' && (
          <div className="two-column">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">الصلاحيات</p>
                  <h2>فريق العمل</h2>
                </div>
              </div>
              <div className="list">
                {staff.map((member) => (
                  <article className="list-row" key={member.id}>
                    <div>
                      <strong>{member.user.displayName ?? 'عضو فريق'}</strong>
                      <span dir="ltr">{member.user.phone}</span>
                    </div>
                    <div className="item-actions">
                      <select
                        aria-label={`دور ${member.user.displayName ?? 'عضو الفريق'}`}
                        value={
                          member.role === 'OWNER'
                            ? 'merchant_owner'
                            : member.role === 'MANAGER'
                              ? 'merchant_manager'
                              : 'merchant_staff'
                        }
                        onChange={(event) =>
                          updateStaffMember(member, {
                            role: event.target.value,
                          })
                        }
                      >
                        <option value="merchant_owner">مالك</option>
                        <option value="merchant_manager">مدير</option>
                        <option value="merchant_staff">موظف</option>
                      </select>
                      <button
                        onClick={() =>
                          updateStaffMember(member, {
                            active: !member.active,
                          })
                        }
                      >
                        {member.active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section className="panel">
              <h2>دعوة عضو</h2>
              <form onSubmit={inviteStaff} className="stack compact">
                <label>
                  الاسم
                  <input name="displayName" required />
                </label>
                <label>
                  رقم الموبايل
                  <input name="phone" required />
                </label>
                <label>
                  الدور
                  <select name="role">
                    <option value="merchant_staff">موظف</option>
                    <option value="merchant_manager">مدير</option>
                  </select>
                </label>
                <button className="primary">إرسال الدعوة</button>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
