'use client';

import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type Token = { accessToken: string };
type Dispute = {
  id: string;
  status: string;
  merchantReason: string;
  merchantNote: string | null;
  courierResponse: string | null;
  resolutionNote: string | null;
  version: number;
  order: { id: string; orderNumber: string; status: string };
  merchant: { displayName: string };
  courier: { fullName: string };
};
type Proof = {
  id: string;
  status: string;
  submittedAmountMinor: number;
  approvedAmountMinor: number | null;
  paidAt: string;
  externalReference: string | null;
  duplicateIndicators: {
    warningOnly?: boolean;
    candidateIds?: string[];
  } | null;
  version: number;
  courier: { id: string; fullName: string };
  linkedExternalPayment?: { id: string; amountMinor: number } | null;
};
type Setting = {
  version: number;
  deliveryDisputeWindowHours: number;
  returnConfirmationTimeoutHours: number;
  notificationRetentionDays: number;
};
type Notification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

async function request<T>(
  path: string,
  token: Token,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? 'تعذر تنفيذ الإجراء.');
  }
  return body;
}

const money = (minor: number) =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(minor / 100);

export function PhaseFourOperations({
  token,
  workspace,
}: {
  token: Token;
  workspace: 'disputes' | 'proofs' | 'operational-settings' | 'notifications';
}) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [settings, setSettings] = useState<Setting>();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedDispute, setSelectedDispute] = useState<Dispute>();
  const [selectedProof, setSelectedProof] = useState<Proof>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      if (workspace === 'disputes') {
        setDisputes(await request('/admin/delivery-disputes', token));
      } else if (workspace === 'proofs') {
        setProofs(await request('/admin/payment-proofs', token));
      } else if (workspace === 'operational-settings') {
        setSettings(await request('/admin/operational-settings', token));
      } else {
        const page = await request<{ items: Notification[] }>(
          '/notifications?page=1&pageSize=100',
          token,
        );
        setNotifications(page.items);
      }
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [token, workspace]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    const endpoint = new URL(apiUrl);
    const socket = io(endpoint.origin, {
      path: '/api/v1/realtime',
      auth: { token: token.accessToken },
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.onAny((_name, event: { id?: string }) => {
      if (event?.id) void load();
    });
    const reconciliationTimer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearInterval(reconciliationTimer);
      socket.close();
    };
  }, [load, token]);

  async function resolve(
    resolution: 'CONFIRM_DELIVERY' | 'CONFIRM_NOT_DELIVERED' | 'REQUIRE_RETURN',
  ) {
    if (!selectedDispute) return;
    try {
      await request(
        `/admin/delivery-disputes/${selectedDispute.id}/resolve`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            version: selectedDispute.version,
            resolution,
            note: `قرار عمليات موثق: ${resolution}`,
          }),
        },
      );
      setSelectedDispute(undefined);
      setMessage('تم حفظ القرار وتحديث السجل والإشعارات.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function markNotificationRead(notification: Notification) {
    if (!notification.readAt) {
      await request(`/notifications/${notification.id}/read`, token, {
        method: 'POST',
      });
      await load();
    }
  }

  async function reviewProof(approve: boolean, partial = false) {
    if (!selectedProof) return;
    try {
      const amount = partial
        ? Math.max(1, selectedProof.submittedAmountMinor - 100)
        : selectedProof.submittedAmountMinor;
      await request(
        `/admin/payment-proofs/${selectedProof.id}/${approve ? 'approve' : 'reject'}`,
        token,
        {
          method: 'POST',
          headers: approve
            ? { 'Idempotency-Key': `proof-${crypto.randomUUID()}` }
            : {},
          body: JSON.stringify(
            approve
              ? {
                  version: selectedProof.version,
                  approvedAmountMinor: amount,
                  reason: partial
                    ? 'المبلغ الفعلي أقل من المبلغ المرسل.'
                    : undefined,
                }
              : {
                  version: selectedProof.version,
                  reason: 'الإيصال غير واضح أو لا يطابق بيانات الدفع.',
                },
          ),
        },
      );
      setSelectedProof(undefined);
      setMessage('تمت مراجعة الإثبات مع حفظ سجل مالي قابل للتدقيق.');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function openProof(proof: Proof) {
    try {
      const response = await fetch(
        `${apiUrl}/payment-proofs/${proof.id}/file`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } },
      );
      if (!response.ok) throw new Error('تعذر فتح الملف الخاص.');
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const form = new FormData(event.currentTarget);
    try {
      setSettings(
        await request('/admin/operational-settings', token, {
          method: 'PATCH',
          body: JSON.stringify({
            currentVersion: settings.version,
            deliveryDisputeWindowHours: Number(form.get('disputeWindow')),
            returnConfirmationTimeoutHours: Number(form.get('returnTimeout')),
            notificationRetentionDays: Number(form.get('retention')),
          }),
        }),
      );
      setMessage('تم إنشاء نسخة إعدادات جديدة دون تغيير التاريخ السابق.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">المرحلة الرابعة</p>
          <h1>
            {workspace === 'disputes'
              ? 'اعتراضات التسليم'
              : workspace === 'proofs'
                ? 'إثباتات الدفع'
                : workspace === 'notifications'
                  ? 'الإشعارات'
                  : 'إعدادات التشغيل'}
          </h1>
        </div>
        <span className="state">
          {connected ? 'التحديث المباشر متصل' : 'REST / إعادة الاتصال'}
        </span>
      </div>
      {message && <p className="notice">{message}</p>}
      {error && <p className="notice error">{error}</p>}

      {workspace === 'disputes' &&
        (selectedDispute ? (
          <article className="panel">
            <button onClick={() => setSelectedDispute(undefined)}>عودة</button>
            <h2 dir="ltr">{selectedDispute.order.orderNumber}</h2>
            <p>
              {selectedDispute.merchant.displayName} ·{' '}
              {selectedDispute.courier.fullName}
            </p>
            <p>السبب: {selectedDispute.merchantReason}</p>
            <p>شكوى التاجر: {selectedDispute.merchantNote ?? '—'}</p>
            <p>رد المندوب: {selectedDispute.courierResponse ?? 'لم يرد بعد'}</p>
            <div className="action-row">
              <button onClick={() => void resolve('CONFIRM_DELIVERY')}>
                تأكيد التسليم
              </button>
              <button onClick={() => void resolve('CONFIRM_NOT_DELIVERED')}>
                تأكيد عدم التسليم
              </button>
              <button onClick={() => void resolve('REQUIRE_RETURN')}>
                طلب الإرجاع
              </button>
            </div>
          </article>
        ) : (
          <div className="panel">
            {disputes.map((dispute) => (
              <button
                className="table-row"
                key={dispute.id}
                onClick={() => setSelectedDispute(dispute)}
              >
                <strong dir="ltr">{dispute.order.orderNumber}</strong>
                <span>{dispute.merchant.displayName}</span>
                <span>{dispute.courier.fullName}</span>
                <span>{dispute.status}</span>
              </button>
            ))}
          </div>
        ))}

      {workspace === 'proofs' &&
        (selectedProof ? (
          <article className="panel">
            <button onClick={() => setSelectedProof(undefined)}>عودة</button>
            <h2>{selectedProof.courier.fullName}</h2>
            <p>المبلغ المرسل: {money(selectedProof.submittedAmountMinor)}</p>
            <p>المرجع: {selectedProof.externalReference ?? '—'}</p>
            {selectedProof.duplicateIndicators?.candidateIds?.length ? (
              <p className="notice">
                تحذير تشابه فقط — لا يعد إثبات احتيال:{' '}
                {selectedProof.duplicateIndicators.candidateIds.join(', ')}
              </p>
            ) : null}
            <button onClick={() => void openProof(selectedProof)}>
              فتح الصورة الخاصة بأمان
            </button>
            <div className="action-row">
              <button onClick={() => void reviewProof(true)}>
                اعتماد كامل
              </button>
              <button onClick={() => void reviewProof(true, true)}>
                اعتماد مبلغ مختلف
              </button>
              <button onClick={() => void reviewProof(false)}>رفض بسبب</button>
            </div>
          </article>
        ) : (
          <div className="panel">
            {proofs.map((proof) => (
              <button
                className="table-row"
                key={proof.id}
                onClick={() => setSelectedProof(proof)}
              >
                <strong>{proof.courier.fullName}</strong>
                <span>{money(proof.submittedAmountMinor)}</span>
                <span>{proof.status}</span>
              </button>
            ))}
          </div>
        ))}

      {workspace === 'operational-settings' && settings && (
        <form className="panel form-grid" onSubmit={saveSettings}>
          <p>النسخة الحالية: {settings.version} · التوقيت: Africa/Cairo</p>
          <label>
            نافذة اعتراض التسليم بالساعات
            <input
              name="disputeWindow"
              type="number"
              defaultValue={settings.deliveryDisputeWindowHours}
            />
          </label>
          <label>
            مهلة تأكيد المرتجع بالساعات
            <input
              name="returnTimeout"
              type="number"
              defaultValue={settings.returnConfirmationTimeoutHours}
            />
          </label>
          <label>
            الاحتفاظ بالإشعارات بالأيام
            <input
              name="retention"
              type="number"
              defaultValue={settings.notificationRetentionDays}
            />
          </label>
          <button>حفظ كنسخة جديدة (Super Admin فقط)</button>
        </form>
      )}

      {workspace === 'notifications' && (
        <div className="panel">
          {notifications.map((notification) => (
            <button
              key={notification.id}
              className="document-row"
              onClick={() => void markNotificationRead(notification)}
            >
              <strong>{notification.title}</strong>
              <p>{notification.body}</p>
              <time>
                {new Date(notification.createdAt).toLocaleString('ar-EG')}
              </time>
              {!notification.readAt && <span>جديد</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
