import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { brandColors } from '@wasel/ui/brand';
import skkaLogo from '../../logo.png';
import { io } from 'socket.io-client';

import {
  appendReactNativeMultipart,
  stageAndroidDocument,
  type MultipartAppender,
} from './android-document-upload';
import { resolveCourierApiUrl } from './api-base-url';
import { prepareDocumentAsset } from './document-upload';
import { externalNavigationUrl } from './external-navigation';
import type { MobileSession } from './mobile-session';

type Tab = 'available' | 'current' | 'history' | 'account' | 'notifications';
const apiUrl = resolveCourierApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  (NativeModules.SourceCode as { scriptURL?: string } | undefined)?.scriptURL,
  Platform.OS,
);
type Address = {
  addressLine?: string;
  area?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
};
type MarketplaceOrder = {
  id: string;
  orderNumber: string;
  version: number;
  pickupStoreName: string;
  pickupArea: string;
  dropoffArea: string;
  serviceZoneName: string;
  routeDistanceMeters: number;
  estimatedDurationSeconds: number;
  packageSize: string;
  weightGrams: number;
  fragile: boolean;
  requiresThermalBag: boolean;
  deliveryFeeMinor: number;
  estimatedCourierNetMinor: number;
  currency: string;
  createdAt: string;
  acceptanceExpiresAt: string | null;
  dispatchAttemptCount: number;
};
type AssignedOrder = MarketplaceOrder & {
  status: string;
  store: { name: string; phone: string | null };
  customerSnapshot: { name?: string; phone?: string };
  pickupAddressSnapshot: Address;
  dropoffAddressSnapshot: Address;
  packageSnapshot: {
    courierNotes?: string;
    itemDescription?: string;
    notes?: string;
    recipientNotes?: string;
  };
  financialDetails: {
    currency: string;
    customerCollectAmountMinor: number;
    courierNetEarningMinor: number;
    deliveryFeeMinor: number;
    itemsSubtotalMinor: number;
    merchantPaymentRequiredMinor: number;
    paymentMode: 'delivery_only' | 'cash_on_delivery';
    platformCommissionMinor: number;
  };
  events: Array<{
    id: string;
    eventType: string;
    merchantMessage: string | null;
    createdAt: string;
  }>;
  deliveredAt?: string | null;
  deliveryDisputeDeadlineAt?: string | null;
  deliveryDispute?: {
    id: string;
    status: string;
    version: number;
    merchantReason: string;
    merchantNote: string | null;
    courierResponse: string | null;
  } | null;
  cancelledAfterPickup: boolean;
  cancellationChargeMinor: number;
  cancellationReasonCode?: string | null;
  cancellationDetails?: string | null;
};
type AccountSummary = {
  acceptedOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  totalCommissionDueMinor: number;
  totalRecordedPaymentsMinor: number;
  totalAdjustmentsMinor: number;
  totalWaivedMinor: number;
  remainingAmountMinor: number;
  daysRemaining: number | null;
};
type LedgerEntry = {
  id: string;
  type: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  description: string;
  order?: { orderNumber: string } | null;
};
type Settlement = {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  totalDueMinor: number;
  totalPaidMinor: number;
  remainingAmountMinor: number;
  daysRemaining: number;
};
type PaymentProof = {
  id: string;
  status: string;
  submittedAmountMinor: number;
  approvedAmountMinor: number | null;
  reviewReason: string | null;
  version: number;
};
type InAppNotification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

const statusLabels: Record<string, string> = {
  COURIER_ASSIGNED: 'تم قبول الطلب',
  COURIER_ARRIVING_PICKUP: 'في الطريق إلى الاستلام',
  AT_PICKUP: 'وصلت إلى المتجر',
  PICKED_UP: 'تم استلام الطلب',
  IN_TRANSIT: 'في الطريق إلى العميل',
  AT_DROPOFF: 'وصلت إلى العميل',
  DELIVERY_FAILED: 'تعذر التسليم',
  RETURNING_TO_STORE: 'إعادة الطلب إلى المتجر',
  RETURN_AWAITING_MERCHANT_CONFIRMATION: 'ينتظر تأكيد التاجر للمرتجع',
  DELIVERED: 'تم التسليم · نافذة الاعتراض مفتوحة',
  DELIVERY_DISPUTED: 'اعتراض توصيل قيد المراجعة',
  COMPLETED: 'مكتمل',
};

const nextAction: Record<string, { path: string; label: string }> = {
  COURIER_ASSIGNED: {
    path: 'arriving-pickup',
    label: 'بدأت الطريق إلى المتجر',
  },
  COURIER_ARRIVING_PICKUP: {
    path: 'arrived-pickup',
    label: 'وصلت إلى المتجر',
  },
  AT_PICKUP: { path: 'picked-up', label: 'استلمت الطلب' },
  PICKED_UP: { path: 'in-transit', label: 'بدأت التوصيل' },
  IN_TRANSIT: { path: 'arrived-dropoff', label: 'وصلت إلى العميل' },
  AT_DROPOFF: { path: 'delivered', label: 'تم التسليم' },
  DELIVERY_FAILED: {
    path: 'returning-to-store',
    label: 'بدأت إعادة الطلب',
  },
  RETURNING_TO_STORE: { path: 'returned', label: 'أعدت الطلب للمتجر' },
};

const money = (minor: number, currency = 'EGP') =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
  }).format(minor / 100);

const commandKey = (scope: string) =>
  `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export function OperationalCourierApp({
  session,
  onSignOut,
}: {
  session: MobileSession;
  onSignOut: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>('available');
  const [available, setAvailable] = useState<MarketplaceOrder[]>([]);
  const [current, setCurrent] = useState<AssignedOrder>();
  const [history, setHistory] = useState<AssignedOrder[]>([]);
  const [summary, setSummary] = useState<AccountSummary>();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [previewProofId, setPreviewProofId] = useState<string>();
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [proofAmount, setProofAmount] = useState('100');
  const [connected, setConnected] = useState(false);
  const [marketplaceNow, setMarketplaceNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [timelineVisible, setTimelineVisible] = useState(false);

  const load = useCallback(
    async (target: Tab) => {
      try {
        if (target === 'available') {
          const page = await session.request<{ items: MarketplaceOrder[] }>(
            '/couriers/orders/available?page=1&pageSize=50',
          );
          setMessage('');
          setAvailable(page.items);
        } else if (target === 'current') {
          const order = await session.request<AssignedOrder | null>(
            '/couriers/orders/current',
          );
          setMessage('');
          setCurrent(order ?? undefined);
        } else if (target === 'history') {
          const page = await session.request<{ items: AssignedOrder[] }>(
            '/couriers/orders/history?page=1&pageSize=50',
          );
          setMessage('');
          setHistory(page.items);
        } else if (target === 'account') {
          const [account, ledger, periods, proofRows] = await Promise.all([
            session.request<AccountSummary>('/couriers/account/summary'),
            session.request<{ items: LedgerEntry[] }>(
              '/couriers/account/entries?page=1&pageSize=50',
            ),
            session.request<{ items: Settlement[] }>(
              '/couriers/settlements?page=1&pageSize=50',
            ),
            session.request<PaymentProof[]>('/couriers/payment-proofs'),
          ]);
          setMessage('');
          setSummary(account);
          setEntries(ledger.items);
          setSettlements(periods.items);
          setProofs(proofRows);
        } else {
          const page = await session.request<{ items: InAppNotification[] }>(
            '/notifications?page=1&pageSize=100',
          );
          setNotifications(page.items);
        }
      } catch (error) {
        setMessage((error as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  useEffect(() => {
    const handle = setTimeout(() => void load('available'), 0);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setMarketplaceNow(now);
      setAvailable((orders) =>
        orders.filter(
          (order) =>
            order.acceptanceExpiresAt !== null &&
            new Date(order.acceptanceExpiresAt).getTime() > now,
        ),
      );
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = session.currentTokens()?.accessToken;
    if (!token) return;
    const parsed = new URL(apiUrl);
    const socket = io(parsed.origin, {
      path: '/api/v1/realtime',
      auth: { token },
    });
    const refresh = () => {
      void load(tab);
    };
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('realtime.ready', refresh);
    socket.on('marketplace.order.available', () => void load('available'));
    socket.on('marketplace.order.removed', () => void load('available'));
    socket.on('order.updated', refresh);
    socket.on('payment-proof.updated', () => void load('account'));
    socket.on('notification.created', () => void load('notifications'));
    const reconciliationTimer = setInterval(refresh, 30_000);
    return () => {
      clearInterval(reconciliationTimer);
      socket.close();
    };
  }, [load, session, tab]);

  async function switchTab(next: Tab) {
    setTab(next);
    await load(next);
  }

  async function accept(order: MarketplaceOrder) {
    if (
      !order.acceptanceExpiresAt ||
      new Date(order.acceptanceExpiresAt).getTime() <= marketplaceNow
    ) {
      setAvailable((orders) => orders.filter((item) => item.id !== order.id));
      setMessage('انتهت مدة قبول هذا الطلب.');
      return;
    }
    setBusy(true);
    try {
      await session.request(`/couriers/orders/${order.id}/accept`, {
        method: 'POST',
        headers: { 'Idempotency-Key': commandKey('accept') },
        body: JSON.stringify({ version: order.version }),
      });
      setMessage('تم قبول الطلب. ظهرت بيانات العميل والعناوين الكاملة الآن.');
      await switchTab('current');
    } catch (error) {
      setMessage((error as Error).message);
      await load('available');
    } finally {
      setBusy(false);
    }
  }

  async function transition(path: string) {
    if (!current) return;
    setBusy(true);
    try {
      await session.request(`/couriers/orders/${current.id}/${path}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': commandKey(path) },
        body: JSON.stringify({
          version: current.version,
          ...(path === 'delivery-failed'
            ? {
                reason: 'CUSTOMER_NO_ANSWER',
                note: 'تعذر التواصل مع العميل من موقع التسليم.',
              }
            : {}),
        }),
      });
      await load('current');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBeforePickup() {
    if (!current) return;
    setBusy(true);
    try {
      await session.request(`/couriers/orders/${current.id}/cancel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': commandKey('cancel') },
        body: JSON.stringify({
          version: current.version,
          reason: 'تعذر على المندوب متابعة الطلب قبل الاستلام',
        }),
      });
      setCurrent(undefined);
      setMessage('أُعيد الطلب إلى السوق ليقبله مندوب آخر.');
      await switchTab('available');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function navigate(address: Address) {
    try {
      if (
        typeof address.latitude !== 'number' ||
        typeof address.longitude !== 'number'
      ) {
        throw new Error('لا توجد إحداثيات محفوظة لهذا العنوان.');
      }
      await Linking.openURL(
        externalNavigationUrl({
          latitude: address.latitude,
          longitude: address.longitude,
        }),
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function respondToDispute() {
    if (!current?.deliveryDispute) return;
    setBusy(true);
    try {
      await session.request(
        `/couriers/orders/${current.id}/delivery-dispute/response`,
        {
          method: 'POST',
          body: JSON.stringify({
            version: current.deliveryDispute.version,
            response: 'وصلت إلى العنوان وسلمت الطلب حسب البيانات المتاحة.',
            paperProofAvailable: false,
          }),
        },
      );
      await load('current');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPaymentProof() {
    setBusy(true);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ['images'],
        quality: 1,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const prepared = prepareDocumentAsset({
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
      });
      const staged = await stageAndroidDocument(
        prepared,
        {
          cacheDirectory: FileSystem.cacheDirectory,
          copyAsync: FileSystem.copyAsync,
          getInfoAsync: FileSystem.getInfoAsync,
        },
        `payment-${Date.now()}`,
      );
      const formData = new FormData();
      appendReactNativeMultipart(
        formData as unknown as MultipartAppender,
        {
          amountMinor: String(Math.round(Number(proofAmount) * 100)),
          method: 'BANK_TRANSFER',
          paidAt: new Date().toISOString(),
          note: 'إثبات دفع خارجي من تطبيق المندوب',
        },
        staged,
      );
      const token = session.currentTokens()?.accessToken;
      if (!token) throw new Error('انتهت الجلسة.');
      const response = await fetch(`${apiUrl}/couriers/payment-proofs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': commandKey('payment-proof'),
        },
        body: formData,
      });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? 'تعذر إرسال إثبات الدفع.');
      }
      setMessage('تم إرسال الإثبات. الرصيد لن يتغير قبل مراجعة المالية.');
      await load('account');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeAccessToken = session.currentTokens()?.accessToken;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.operationalBrand}>
          <Image
            accessibilityLabel="شعار سِكّة"
            source={skkaLogo}
            style={styles.operationalLogo}
            resizeMode="contain"
          />
          <Text style={styles.brand}>سِكّة للمندوبين</Text>
          <Text style={styles.slogan}>كل طلب له سكة</Text>
          <Text style={styles.subtitle}>
            المرحلة الرابعة ·{' '}
            {connected ? 'التحديث المباشر متصل' : 'وضع REST / إعادة الاتصال'}
          </Text>
        </View>
        <Pressable
          onPress={() => void onSignOut()}
          style={styles.signOutAction}
        >
          <Text style={styles.signOut}>خروج</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {(
          [
            ['available', 'المتاح'],
            ['current', 'الحالي'],
            ['history', 'السجل'],
            ['account', 'الحساب'],
            ['notifications', 'الإشعارات'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            key={key}
            onPress={() => void switchTab(key)}
            style={[styles.tab, tab === key && styles.tabActive]}
          >
            <Text style={tab === key ? styles.tabTextActive : styles.tabText}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={busy} onRefresh={() => void load(tab)} />
        }
      >
        {tab === 'available' && (
          <>
            <Text style={styles.title}>طلبات ضمن نطاقات خدمتك</Text>
            <Text style={styles.hint}>
              حماية للخصوصية: تظهر المنطقة فقط قبل القبول، وليس اسم العميل أو
              هاتفه أو عنوانه الكامل.
            </Text>
            {available.map((order) => (
              <View key={order.id} style={styles.card}>
                <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                <Text>
                  {order.pickupStoreName} · {order.pickupArea}
                </Text>
                <Text>منطقة التسليم: {order.dropoffArea}</Text>
                <Text>
                  {(order.routeDistanceMeters / 1000).toFixed(1)} كم ·{' '}
                  {Math.ceil(order.estimatedDurationSeconds / 60)} دقيقة
                </Text>
                <Text>
                  {order.packageSize} · {(order.weightGrams / 1000).toFixed(1)}{' '}
                  كجم
                </Text>
                <Text style={styles.net}>
                  صافي تقديري: {money(order.estimatedCourierNetMinor)}
                </Text>
                <Text style={styles.hint}>
                  متبقٍ للقبول:{' '}
                  {Math.max(
                    0,
                    Math.ceil(
                      (new Date(order.acceptanceExpiresAt ?? 0).getTime() -
                        marketplaceNow) /
                        1_000,
                    ),
                  )}{' '}
                  ثانية
                </Text>
                <Pressable
                  disabled={busy}
                  onPress={() => void accept(order)}
                  style={styles.primary}
                >
                  <Text style={styles.primaryText}>قبول الطلب</Text>
                </Pressable>
              </View>
            ))}
            {!busy && available.length === 0 && (
              <Text style={styles.empty}>لا توجد طلبات متاحة حالياً.</Text>
            )}
          </>
        )}
        {tab === 'current' &&
          (current ? (
            <View style={styles.card}>
              <Text style={styles.orderNumber}>{current.orderNumber}</Text>
              <Text style={styles.state}>
                {statusLabels[current.status] ?? current.status}
              </Text>

              <Text style={styles.subsectionTitle}>
                بيانات الاستلام من التاجر
              </Text>
              <Text>الفرع: {current.store.name}</Text>
              <Text>هاتف الفرع: {current.store.phone ?? '—'}</Text>
              <Text>
                العنوان: {current.pickupAddressSnapshot.addressLine ?? '—'}
              </Text>
              <Pressable
                style={styles.secondary}
                onPress={() => void navigate(current.pickupAddressSnapshot)}
              >
                <Text style={styles.secondaryText}>فتح اتجاهات الاستلام</Text>
              </Pressable>

              <Text style={styles.subsectionTitle}>بيانات التسليم للعميل</Text>
              <Text>العميل: {current.customerSnapshot.name ?? '—'}</Text>
              <Text>الهاتف: {current.customerSnapshot.phone ?? '—'}</Text>
              <Text>
                العنوان: {current.dropoffAddressSnapshot.addressLine ?? '—'}
              </Text>
              <Pressable
                style={styles.secondary}
                onPress={() => void navigate(current.dropoffAddressSnapshot)}
              >
                <Text style={styles.secondaryText}>فتح اتجاهات التسليم</Text>
              </Pressable>

              <Text style={styles.subsectionTitle}>محتوى الطلب</Text>
              <Text>
                محتوى الطلب: {current.packageSnapshot.itemDescription ?? '—'}
              </Text>
              <Text>
                قيمة الطلب:{' '}
                {money(
                  current.financialDetails.itemsSubtotalMinor,
                  current.financialDetails.currency,
                )}
              </Text>

              <View style={styles.financialCard}>
                <Text style={styles.subsectionTitle}>التفاصيل المالية</Text>
                <FinancialRow
                  label="قيمة الطلب"
                  value={money(
                    current.financialDetails.itemsSubtotalMinor,
                    current.financialDetails.currency,
                  )}
                />
                <FinancialRow
                  emphasized
                  label="المبلغ المطلوب تحصيله من العميل"
                  value={money(
                    current.financialDetails.customerCollectAmountMinor,
                    current.financialDetails.currency,
                  )}
                />
                <FinancialRow
                  emphasized
                  label="مستحق المندوب"
                  value={money(
                    current.financialDetails.courierNetEarningMinor,
                    current.financialDetails.currency,
                  )}
                />
                <FinancialRow
                  label="سعر التوصيل"
                  value={money(
                    current.financialDetails.deliveryFeeMinor,
                    current.financialDetails.currency,
                  )}
                />
                <FinancialRow
                  label="عمولة المنصة"
                  value={money(
                    current.financialDetails.platformCommissionMinor,
                    current.financialDetails.currency,
                  )}
                />
                <Text style={styles.hint}>
                  {current.financialDetails.paymentMode === 'delivery_only'
                    ? 'قيمة المنتجات مدفوعة مسبقاً أو تتم محاسبتها خارج سِكّة. لا تدفع قيمتها للتاجر، والمطلوب تحصيله هنا هو رسم التوصيل فقط.'
                    : 'هذا طلب تحصيل عند التسليم؛ مبلغ التحصيل يشمل قيمة الطلب وسعر التوصيل.'}
                </Text>
              </View>

              <Text style={styles.subsectionTitle}>ملاحظات التاجر</Text>
              <Text>
                {current.packageSnapshot.courierNotes ??
                  current.packageSnapshot.notes ??
                  'لا توجد ملاحظات من التاجر.'}
              </Text>

              <Text style={styles.subsectionTitle}>إجراءات التوصيل</Text>
              {nextAction[current.status] && (
                <Pressable
                  disabled={busy}
                  style={styles.primary}
                  onPress={() =>
                    void transition(nextAction[current.status]!.path)
                  }
                >
                  <Text style={styles.primaryText}>
                    {nextAction[current.status]!.label}
                  </Text>
                </Pressable>
              )}
              {current.status === 'DELIVERED' &&
                current.deliveryDisputeDeadlineAt && (
                  <View style={styles.notice}>
                    <Text style={styles.sectionTitle}>
                      تم التسليم دون OTP أو صورة أو توقيع إلكتروني
                    </Text>
                    <Text>
                      الإكمال والعمولة ينتظران حتى{' '}
                      {new Date(
                        current.deliveryDisputeDeadlineAt,
                      ).toLocaleString('ar-EG')}{' '}
                      أو قرار الإدارة.
                    </Text>
                  </View>
                )}
              {current.deliveryDispute &&
                ['OPEN', 'COURIER_RESPONDED'].includes(
                  current.deliveryDispute.status,
                ) && (
                  <View style={styles.notice}>
                    <Text style={styles.sectionTitle}>اعتراض توصيل</Text>
                    <Text>{current.deliveryDispute.merchantReason}</Text>
                    <Text>
                      {current.deliveryDispute.merchantNote ?? 'لا توجد ملاحظة'}
                    </Text>
                    {!current.deliveryDispute.courierResponse && (
                      <Pressable
                        style={styles.secondary}
                        onPress={() => void respondToDispute()}
                      >
                        <Text style={styles.secondaryText}>
                          إرسال رد واحد للإدارة
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}
              {current.status === 'RETURN_AWAITING_MERCHANT_CONFIRMATION' && (
                <View style={styles.notice}>
                  <Text style={styles.sectionTitle}>ينتظر تأكيد التاجر</Text>
                  <Text>
                    أبلغت بوصول المرتجع. لا يمكنك إنهاء الطلب أو العمولة بنفسك.
                  </Text>
                </View>
              )}
              {current.cancelledAfterPickup &&
                current.status === 'RETURNING_TO_STORE' && (
                  <View style={styles.notice}>
                    <Text style={styles.sectionTitle}>
                      التاجر ألغى الطلب بعد الاستلام
                    </Text>
                    <Text>
                      أعد الطلب إلى الفرع. قيمة التوصيل الأصلية محفوظة بالكامل (
                      {money(current.cancellationChargeMinor)}) ولا توجد رسوم
                      إرجاع إضافية.
                    </Text>
                  </View>
                )}
              {['PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'].includes(
                current.status,
              ) && (
                <Pressable
                  disabled={busy}
                  style={styles.danger}
                  onPress={() => void transition('delivery-failed')}
                >
                  <Text style={styles.dangerText}>تعذر التسليم</Text>
                </Pressable>
              )}
              {[
                'COURIER_ASSIGNED',
                'COURIER_ARRIVING_PICKUP',
                'AT_PICKUP',
              ].includes(current.status) && (
                <Pressable
                  disabled={busy}
                  style={styles.danger}
                  onPress={() => void cancelBeforePickup()}
                >
                  <Text style={styles.dangerText}>إلغاء قبل الاستلام</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => setTimelineVisible(true)}
                style={styles.timelineButton}
              >
                <Text style={styles.timelineIcon}>◷</Text>
                <View style={styles.timelineButtonCopy}>
                  <Text style={styles.timelineButtonTitle}>سجل الحالة</Text>
                  <Text style={styles.timelineButtonHint}>
                    {current.events.length} تحديثات · اضغط لعرض التفاصيل
                  </Text>
                </View>
                <Text style={styles.timelineChevron}>‹</Text>
              </Pressable>
              <Modal
                animationType="slide"
                onRequestClose={() => setTimelineVisible(false)}
                transparent
                visible={timelineVisible}
              >
                <View style={styles.modalBackdrop}>
                  <View style={styles.timelineSheet}>
                    <View style={styles.timelineHeader}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setTimelineVisible(false)}
                        style={styles.timelineClose}
                      >
                        <Text style={styles.timelineCloseText}>إغلاق</Text>
                      </Pressable>
                      <View>
                        <Text style={styles.timelineTitle}>سجل الحالة</Text>
                        <Text style={styles.timelineOrder}>
                          من الأقدم إلى الأحدث
                        </Text>
                      </View>
                    </View>
                    <ScrollView contentContainerStyle={styles.timelineContent}>
                      {current.events.length === 0 ? (
                        <Text style={styles.emptyTimeline}>
                          لا توجد تحديثات للحالة حتى الآن.
                        </Text>
                      ) : (
                        current.events.map((event) => (
                          <View key={event.id} style={styles.timelineEvent}>
                            <View style={styles.timelineDot} />
                            <View style={styles.timelineEventCopy}>
                              <Text style={styles.timelineEventTitle}>
                                {event.merchantMessage ?? event.eventType}
                              </Text>
                              <Text style={styles.timelineEventTime}>
                                {new Date(event.createdAt).toLocaleString(
                                  'ar-EG',
                                )}
                              </Text>
                            </View>
                          </View>
                        ))
                      )}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            </View>
          ) : (
            <Text style={styles.empty}>لا يوجد طلب نشط.</Text>
          ))}
        {tab === 'history' && (
          <>
            <Text style={styles.title}>سجل الطلبات</Text>
            {history.map((order) => (
              <View key={order.id} style={styles.card}>
                <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                <Text>{statusLabels[order.status] ?? order.status}</Text>
                <Text>{money(order.deliveryFeeMinor)}</Text>
              </View>
            ))}
            {!busy && history.length === 0 && (
              <Text style={styles.empty}>لا توجد طلبات سابقة.</Text>
            )}
          </>
        )}
        {tab === 'account' && (
          <>
            <Text style={styles.title}>حساب العمولة والتسويات</Text>
            {summary && (
              <View style={styles.metrics}>
                <Metric label="مقبولة" value={summary.acceptedOrders} />
                <Metric label="مكتملة" value={summary.completedOrders} />
                <Metric label="مرتجعة" value={summary.returnedOrders} />
                <Metric
                  label="المتبقي"
                  value={money(summary.remainingAmountMinor)}
                />
              </View>
            )}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>إرسال إثبات دفع خارجي</Text>
              <Text>
                الرصيد الحالي: {money(summary?.remainingAmountMinor ?? 0)}.
                إرسال الصورة لا يخفضه حتى اعتماد المالية.
              </Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={proofAmount}
                onChangeText={setProofAmount}
                placeholder="المبلغ بالجنيه"
              />
              <Pressable
                style={styles.primary}
                onPress={() => void submitPaymentProof()}
              >
                <Text style={styles.primaryText}>
                  اختيار صورة الإيصال وإرسالها
                </Text>
              </Pressable>
              {previewProofId && activeAccessToken ? (
                <Image
                  accessibilityLabel="معاينة إثبات الدفع المختار"
                  resizeMode="contain"
                  style={{ width: '100%', height: 260, marginVertical: 12 }}
                  source={{
                    uri: `${apiUrl}/payment-proofs/${previewProofId}/file`,
                    headers: {
                      Authorization: `Bearer ${activeAccessToken}`,
                    },
                  }}
                />
              ) : null}
              {proofs.map((proof) => (
                <Pressable
                  key={proof.id}
                  style={styles.ledgerRow}
                  onPress={() => setPreviewProofId(proof.id)}
                >
                  <View>
                    <Text style={styles.ledgerType}>{proof.status}</Text>
                    <Text>{money(proof.submittedAmountMinor)}</Text>
                    {proof.reviewReason ? (
                      <Text>{proof.reviewReason}</Text>
                    ) : null}
                  </View>
                  <Text>
                    {proof.approvedAmountMinor
                      ? money(proof.approvedAmountMinor)
                      : 'قيد المراجعة'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.sectionTitle}>التسويات الأسبوعية</Text>
            {settlements.map((period) => (
              <View key={period.id} style={styles.card}>
                <Text style={styles.state}>{period.status}</Text>
                <Text>
                  {new Date(period.periodStart).toLocaleDateString('ar-EG')} —{' '}
                  {new Date(period.periodEnd).toLocaleDateString('ar-EG')}
                </Text>
                <Text>المستحق: {money(period.totalDueMinor)}</Text>
                <Text>المدفوع: {money(period.totalPaidMinor)}</Text>
                <Text>المتبقي: {money(period.remainingAmountMinor)}</Text>
                <Text>المهلة: {period.daysRemaining} يوم</Text>
              </View>
            ))}
            <Text style={styles.sectionTitle}>كشف الحساب</Text>
            {entries.map((entry) => (
              <View key={entry.id} style={styles.ledgerRow}>
                <View>
                  <Text style={styles.ledgerType}>{entry.type}</Text>
                  <Text>{entry.order?.orderNumber ?? entry.description}</Text>
                </View>
                <Text style={styles.ledgerAmount}>
                  {money(entry.amountMinor)}
                </Text>
              </View>
            ))}
          </>
        )}
        {tab === 'notifications' && (
          <>
            <Text style={styles.title}>الإشعارات داخل التطبيق</Text>
            {notifications.map((notification) => (
              <Pressable
                key={notification.id}
                style={styles.card}
                onPress={() => {
                  if (!notification.readAt) {
                    void session
                      .request(`/notifications/${notification.id}/read`, {
                        method: 'POST',
                      })
                      .then(() => load('notifications'));
                  }
                }}
              >
                <Text style={styles.sectionTitle}>{notification.title}</Text>
                <Text>{notification.body}</Text>
                <Text>
                  {new Date(notification.createdAt).toLocaleString('ar-EG')}
                </Text>
                {!notification.readAt && <Text>جديد</Text>}
              </Pressable>
            ))}
            <Pressable
              style={styles.secondary}
              onPress={() =>
                void Linking.openURL('http://localhost:3002/privacy')
              }
            >
              <Text style={styles.secondaryText}>سياسة الخصوصية</Text>
            </Pressable>
            <Pressable
              style={styles.secondary}
              onPress={() =>
                void Linking.openURL('http://localhost:3002/terms')
              }
            >
              <Text style={styles.secondaryText}>شروط الاستخدام</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function FinancialRow({
  emphasized = false,
  label,
  value,
}: {
  emphasized?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.financialRow}>
      <Text
        style={[styles.financialLabel, emphasized && styles.financialStrong]}
      >
        {label}
      </Text>
      <Text
        style={[styles.financialValue, emphasized && styles.financialStrong]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f8f7' },
  header: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomColor: '#dce6e3',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    position: 'relative',
  },
  operationalBrand: {
    alignItems: 'center',
    flex: 1,
  },
  operationalLogo: {
    height: 58,
    width: 84,
  },
  brand: { color: brandColors.primary, fontSize: 20, fontWeight: '900' },
  slogan: {
    color: brandColors.accentText,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  subtitle: {
    color: '#61716d',
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  signOut: { color: '#a43d35', fontWeight: '800' },
  signOutAction: { position: 'absolute', right: 18, top: 18 },
  tabs: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  tab: {
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    flex: 1,
    padding: 12,
  },
  tabActive: { borderBottomColor: brandColors.primary },
  tabText: { color: '#6a7774', fontSize: 13, textAlign: 'center' },
  tabTextActive: {
    color: brandColors.primary,
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  content: { gap: 12, padding: 16, paddingBottom: 56 },
  title: { color: '#183c34', fontSize: 22, fontWeight: '900' },
  hint: { color: '#61716d', lineHeight: 21 },
  card: {
    backgroundColor: '#fff',
    borderColor: '#dbe6e2',
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  notice: {
    backgroundColor: '#fff7dd',
    borderRadius: 12,
    gap: 8,
    padding: 12,
  },
  subsectionTitle: {
    color: '#183c34',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 10,
    textAlign: 'right',
  },
  financialCard: {
    backgroundColor: '#edf7f3',
    borderColor: '#bdddd2',
    borderRadius: 14,
    borderWidth: 1,
    gap: 7,
    marginTop: 4,
    padding: 14,
  },
  financialRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  financialLabel: { color: '#435752', flex: 1, textAlign: 'right' },
  financialValue: { color: '#183c34', fontWeight: '800' },
  financialStrong: { color: '#087e73', fontSize: 16, fontWeight: '900' },
  input: {
    backgroundColor: '#f5f8f7',
    borderColor: '#ccd9d5',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    textAlign: 'right',
  },
  orderNumber: { color: '#183c34', fontSize: 18, fontWeight: '900' },
  state: { color: brandColors.primary, fontWeight: '900' },
  net: { color: '#13795b', fontSize: 17, fontWeight: '900' },
  primary: {
    backgroundColor: brandColors.primary,
    borderRadius: 10,
    marginTop: 8,
    padding: 13,
  },
  primaryText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
  secondary: {
    borderColor: brandColors.primary,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  secondaryText: {
    color: brandColors.primary,
    fontWeight: '800',
    textAlign: 'center',
  },
  danger: { backgroundColor: '#fff1ef', borderRadius: 10, padding: 11 },
  dangerText: { color: '#a43d35', fontWeight: '800', textAlign: 'center' },
  empty: { color: '#66736f', padding: 30, textAlign: 'center' },
  sectionTitle: {
    color: '#183c34',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 12,
  },
  event: {
    borderRightColor: brandColors.primary,
    borderRightWidth: 2,
    color: '#56645f',
    paddingRight: 8,
  },
  timelineButton: {
    alignItems: 'center',
    backgroundColor: '#f5f8f7',
    borderColor: '#dbe6e2',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 8,
    padding: 12,
  },
  timelineIcon: { color: brandColors.primary, fontSize: 24 },
  timelineButtonCopy: { flex: 1 },
  timelineButtonTitle: {
    color: '#183c34',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'right',
  },
  timelineButtonHint: { color: '#66736f', fontSize: 11, textAlign: 'right' },
  timelineChevron: { color: brandColors.primary, fontSize: 28 },
  modalBackdrop: {
    backgroundColor: 'rgba(12, 29, 25, 0.48)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  timelineSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '78%',
    minHeight: 260,
    padding: 18,
  },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timelineClose: { padding: 8 },
  timelineCloseText: { color: brandColors.primary, fontWeight: '900' },
  timelineTitle: {
    color: '#183c34',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'right',
  },
  timelineOrder: { color: '#66736f', fontSize: 11, textAlign: 'right' },
  timelineContent: { gap: 12, paddingBottom: 24, paddingTop: 18 },
  timelineEvent: { flexDirection: 'row-reverse', gap: 10 },
  timelineDot: {
    backgroundColor: brandColors.primary,
    borderRadius: 6,
    height: 12,
    marginTop: 4,
    width: 12,
  },
  timelineEventCopy: {
    borderBottomColor: '#e1e9e6',
    borderBottomWidth: 1,
    flex: 1,
    paddingBottom: 10,
  },
  timelineEventTitle: { color: '#253b35', textAlign: 'right' },
  timelineEventTime: { color: '#71817c', fontSize: 11, textAlign: 'right' },
  emptyTimeline: { color: '#66736f', padding: 30, textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minWidth: '47%',
    padding: 12,
  },
  metricLabel: { color: '#687873' },
  metricValue: { color: '#183c34', fontSize: 20, fontWeight: '900' },
  ledgerRow: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
  ledgerType: { color: '#5c6b67', fontSize: 11 },
  ledgerAmount: { color: '#183c34', fontWeight: '900' },
  message: {
    backgroundColor: '#fff7dd',
    color: '#604b00',
    padding: 10,
    textAlign: 'center',
  },
  busy: {
    backgroundColor: '#183c34cc',
    borderRadius: 22,
    bottom: 22,
    padding: 12,
    position: 'absolute',
    right: 22,
  },
});
