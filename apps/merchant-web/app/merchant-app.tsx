'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { io } from 'socket.io-client';

import skkaLogo from '../../../logo.png';
import {
  BranchCreationForm,
  canManageBranches,
  type BranchCreationInput,
} from './branch-creation-form';
import {
  MerchantRegistrationForm,
  type MerchantRegistrationPayload,
} from './merchant-registration';
import {
  canRequestQuote,
  insideServiceZoneMessage,
  locationRequestErrorMessage,
  manualMapsLinkMessage,
  outsideServiceZoneMessage,
  pointForQuote,
  type LocationEligibility,
} from './location-selection';
import { MapPicker, OpenMapPreview } from './map-picker';
import { NewOrder as CanonicalNewOrder } from './new-order';
import { googleMapsUrl, type MapPoint } from './open-map';
import {
  quoteInputFingerprint,
  quoteMatchesInput,
  type QuoteFingerprintInput,
} from './quote-input';

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type Token = { accessToken: string };
type Merchant = {
  id: string;
  displayName: string;
  legalName: string;
  businessCategory: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: 'PENDING' | 'CHANGES_REQUESTED' | 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  reviewNotes: string | null;
  version: number;
  membership: { role: 'OWNER' | 'MANAGER' | 'STAFF' };
};
type Store = {
  id: string;
  name: string;
  phone: string | null;
  addressLine: string;
  governorate: string | null;
  city: string;
  area: string;
  street: string | null;
  addressDetails: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  coverageStatus?:
    'INSIDE_ACTIVE_ZONE' | 'OUTSIDE_ACTIVE_ZONES' | 'NO_LOCATION';
  version: number;
  latitude: number | null;
  longitude: number | null;
};
type Staff = {
  id: string;
  active: boolean;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  version: number;
  user: { displayName: string | null; phone: string };
};
type Address = {
  id: string;
  label: string | null;
  addressLine: string;
  area: string;
  city: string;
  latitude: number;
  longitude: number;
  locationSource?: LocationSource | 'STORE';
  sourceMapsUrl?: string | null;
};
type Customer = {
  id: string;
  name: string;
  normalizedPhone: string;
  email: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
  addresses?: Address[];
  _count?: { addresses: number; orders: number };
};
type Quote = {
  id: string;
  version: number;
  status: string;
  distanceMeters: number;
  durationSeconds: number;
  baseFeeMinor: number;
  distanceChargeMinor: number;
  packageSurchargeMinor: number;
  weightSurchargeMinor: number;
  fragileSurchargeMinor: number;
  thermalBagSurchargeMinor: number;
  discountMinor: number;
  surgeAdjustmentMinor: number;
  taxMinor: number;
  merchantTotalMinor: number;
  currency: string;
  expiresAt: string;
  expiresInSeconds: number;
  customerSnapshot: { name: string; normalizedPhone: string };
  pickupAddressSnapshot: Address & { contactName: string };
  dropoffAddressSnapshot: Address & {
    contactName: string;
    sourceMapsUrl?: string | null;
  };
  serviceZoneId: string;
  pricingRuleVersion: number;
  requestFingerprint: string;
};
type OrderEvent = {
  id: string;
  eventType: string;
  merchantMessage: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};
type Order = {
  id: string;
  orderNumber: string;
  status:
    | 'DRAFT'
    | 'QUOTED'
    | 'SEARCHING_COURIER'
    | 'NO_COURIER_AVAILABLE'
    | 'NO_COURIER_AVAILABLE_FINAL'
    | 'COURIER_ASSIGNED'
    | 'COURIER_ARRIVING_PICKUP'
    | 'AT_PICKUP'
    | 'PICKED_UP'
    | 'IN_TRANSIT'
    | 'AT_DROPOFF'
    | 'DELIVERED'
    | 'DELIVERY_DISPUTED'
    | 'DELIVERY_FAILED'
    | 'RETURNING_TO_STORE'
    | 'RETURN_AWAITING_MERCHANT_CONFIRMATION'
    | 'RETURNED'
    | 'COMPLETED'
    | 'CANCELLED';
  version: number;
  merchantTotalMinor: number;
  currency: string;
  createdAt: string;
  cancellationReasonCode: string | null;
  cancellationDetails?: string | null;
  cancelledAt?: string | null;
  cancelledAfterPickup: boolean;
  cancellationChargeMinor: number;
  acceptanceExpiresAt: string | null;
  dispatchAttemptCount: number;
  deliveredAt?: string | null;
  deliveryDisputeDeadlineAt?: string | null;
  completionSource?: string | null;
  customerSnapshot: {
    name: string;
    normalizedPhone: string;
  };
  pickupAddressSnapshot: Address & { contactName: string };
  dropoffAddressSnapshot: Address & { contactName: string };
  packageSnapshot: {
    category: string;
    itemDescription: string;
    size: string;
    weightGrams: number;
    packageCount: number;
    fragile: boolean;
    requiresThermalBag: boolean;
  };
  pricingSnapshot: Record<string, number | string>;
  store?: { id: string; name: string };
  customer?: { id: string; name: string; normalizedPhone: string };
  events?: OrderEvent[];
};
type OrdersPage = {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
};
type Notification = {
  id: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
};

type LocationSource =
  | 'SAVED_ADDRESS'
  | 'MAP_PICKER'
  | 'DEVICE_LOCATION'
  | 'GOOGLE_MAPS_LINK'
  | 'MANUAL_COORDINATES';

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
  extractionSource:
    | 'EXPLICIT_COORDINATES'
    | 'SHORT_LINK_REDIRECT'
    | 'MANUAL_SELECTION_REQUIRED';
  userMessage: string | null;
  validation: LocationValidation | null;
};

type QuoteRequestPayload = {
  storeId: string;
  customer: { customerId: string } | { name: string; phone: string };
  dropoff:
    | { addressId: string }
    | {
        saveAddress: boolean;
        label?: string;
        contactName: string;
        contactPhone: string;
        addressLine: string;
        street?: string;
        buildingNumber?: string;
        floor?: string;
        apartment?: string;
        landmark?: string;
        area: string;
        city: string;
        governorate: string;
        instructions?: string;
        deliveryNotes?: string;
        sourceMapsUrl?: string;
        locationSource: LocationSource;
        latitude: number;
        longitude: number;
      };
  package: {
    category: string;
    itemDescription: string;
    size: string;
    weightGrams: number;
    packageCount: number;
    fragile: boolean;
    requiresThermalBag: boolean;
    recipientNotes?: string;
    courierNotes?: string;
    declaredValueMinor: number;
    prohibitedItemsConfirmed: true;
    merchantReference?: string;
    customerOrderReference?: string;
  };
};

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
    error?: {
      code?: string;
      fields?: Record<string, string>;
      message?: string | string[];
    };
  };
  if (!response.ok) {
    const message = body.error?.message;
    const error = new Error(
      Array.isArray(message)
        ? message.join('، ')
        : (message ?? 'تعذر إتمام الطلب. حاول مرة أخرى.'),
    );
    Object.assign(error, {
      code: body.error?.code,
      fields: body.error?.fields,
    });
    throw error;
  }
  return body;
}

const money = (minor: number, currency = 'EGP') =>
  new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
  }).format(minor / 100);

const statusLabels: Record<string, string> = {
  DRAFT: 'مسودة',
  QUOTED: 'تم التسعير',
  SEARCHING_COURIER: 'جارٍ البحث عن مندوب',
  NO_COURIER_AVAILABLE: 'لم يتوفر مندوب',
  NO_COURIER_AVAILABLE_FINAL: 'لم يتوفر مندوب بعد محاولتين',
  COURIER_ASSIGNED: 'قبله مندوب',
  COURIER_ARRIVING_PICKUP: 'المندوب في الطريق إلى المتجر',
  AT_PICKUP: 'المندوب وصل إلى المتجر',
  PICKED_UP: 'تم استلام الطلب',
  IN_TRANSIT: 'في الطريق إلى العميل',
  AT_DROPOFF: 'المندوب وصل إلى العميل',
  DELIVERED: 'تم التسليم',
  DELIVERY_FAILED: 'تعذر التسليم',
  RETURNING_TO_STORE: 'جارٍ إرجاع الطلب',
  RETURN_AWAITING_MERCHANT_CONFIRMATION: 'المرتجع ينتظر تأكيد التاجر',
  DELIVERY_DISPUTED: 'اعتراض توصيل مفتوح',
  RETURNED: 'أُعيد إلى المتجر',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
};

function newIdempotencyKey(scope: string) {
  return `${scope}-${crypto.randomUUID()}`;
}

export function MerchantApp() {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [registrationSubmitted, setRegistrationSubmitted] = useState<{
    businessName: string;
    phone: string;
  }>();
  const [phone, setPhone] = useState('01001000001');
  const [password, setPassword] = useState('MerchantDemo123');
  const [token, setToken] = useState<Token>();
  const [merchant, setMerchant] = useState<Merchant>();
  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer>();
  const [selectedOrder, setSelectedOrder] = useState<Order>();
  const [quote, setQuote] = useState<Quote>();
  const [quoteFingerprint, setQuoteFingerprint] = useState<string>();
  const [createdOrder, setCreatedOrder] = useState<Order>();
  const [view, setView] = useState<
    'dashboard' | 'new' | 'orders' | 'customers' | 'settings' | 'notifications'
  >('dashboard');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [cancelReason, setCancelReason] = useState('customer_cancelled');
  const [cancelDetails, setCancelDetails] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);

  const loadWorkspace = useCallback(async (activeToken: Token) => {
    const merchantRow = await request<Merchant>(
      '/merchants/current',
      activeToken,
    );
    const storeRows = await request<Store[]>(
      '/merchants/current/stores',
      activeToken,
    );
    setMerchant(merchantRow);
    setStores(storeRows);
    if (merchantRow.status !== 'ACTIVE') {
      setStaff([]);
      setCustomers([]);
      setOrders([]);
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    const [staffRows, customerRows, orderPage, notificationPage, unread] =
      await Promise.all([
        request<Staff[]>('/merchants/current/staff', activeToken),
        request<Customer[]>('/merchant/customers', activeToken),
        request<OrdersPage>('/orders?page=1&pageSize=50', activeToken),
        request<{ items: Notification[] }>(
          '/notifications?page=1&pageSize=50',
          activeToken,
        ),
        request<{ count: number }>('/notifications/unread-count', activeToken),
      ]);
    setStaff(staffRows);
    setCustomers(customerRows);
    setOrders(orderPage.items);
    setNotifications(notificationPage.items);
    setUnreadCount(unread.count);
  }, []);

  useEffect(() => {
    if (!token || merchant?.status !== 'ACTIVE') return;
    const endpoint = new URL(apiUrl);
    const socket = io(endpoint.origin, {
      path: '/api/v1/realtime',
      auth: { token: token.accessToken },
    });
    const seen = new Set<string>();
    const reconcile = (event: {
      id?: string;
      payload?: { orderId?: string };
    }) => {
      if (event.id && seen.has(event.id)) return;
      if (event.id) seen.add(event.id);
      void loadWorkspace(token);
      if (event.payload?.orderId) {
        const orderId = event.payload.orderId;
        void request<Order>(`/orders/${orderId}`, token)
          .then((detail) =>
            setSelectedOrder((current) =>
              current?.id === orderId ? detail : current,
            ),
          )
          .catch(() => undefined);
      }
    };
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('realtime.ready', reconcile);
    socket.on('order.updated', reconcile);
    socket.on('notification.created', reconcile);
    const reconciliationTimer = window.setInterval(
      () => void loadWorkspace(token),
      30_000,
    );
    return () => {
      window.clearInterval(reconciliationTimer);
      socket.close();
    };
  }, [loadWorkspace, merchant?.status, token]);

  useEffect(() => {
    if (!quote) return;
    const update = () =>
      setSecondsLeft(
        Math.max(
          0,
          Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 1_000),
        ),
      );
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  const activeOrders = useMemo(
    () =>
      orders.filter((order) =>
        orderStatusFilter ? order.status === orderStatusFilter : true,
      ),
    [orderStatusFilter, orders],
  );

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await request<{ tokens: Token }>(
        '/auth/login',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify({ phone, password }),
        },
      );
      await loadWorkspace(result.tokens);
      setView('dashboard');
      setToken(result.tokens);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function createQuote(
    body: QuoteRequestPayload,
    inputFingerprint: string,
  ) {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const result = await request<Quote>('/orders/quotes', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey('quote') },
        body: JSON.stringify(body),
      });
      setQuote(result);
      setSecondsLeft(Math.max(0, Math.ceil(result.expiresInSeconds)));
      setQuoteFingerprint(inputFingerprint);
      setCreatedOrder(undefined);
    } finally {
      setLoading(false);
    }
  }

  async function confirmOrder(currentFingerprint: string) {
    if (!token || !quote) return;
    if (currentFingerprint !== quoteFingerprint) {
      setQuote(undefined);
      setQuoteFingerprint(undefined);
      setError(
        'تغير الموقع أو أحد عناصر التسعير. احسب عرض سعر جديداً قبل إنشاء الطلب.',
      );
      return;
    }
    setLoading(true);
    try {
      const order = await request<Order>('/orders', token, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey('order') },
        body: JSON.stringify({
          quoteId: quote.id,
          quoteVersion: quote.version,
          locationReviewed: true,
        }),
      });
      setCreatedOrder(order);
      setOrders((current) => [order, ...current]);
      setQuote(undefined);
      setQuoteFingerprint(undefined);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function validateLocation(point: MapPoint) {
    if (!token) throw new Error('سجّل الدخول أولاً.');
    const validation = await request<LocationValidation>(
      '/location/validate',
      token,
      {
        method: 'POST',
        body: JSON.stringify(point),
      },
    );
    return validation;
  }

  async function validatePickupLocation(point: MapPoint) {
    if (!token) throw new Error('سجّل الدخول أولاً.');
    return request<LocationValidation>('/location/validate-pickup', token, {
      method: 'POST',
      body: JSON.stringify(point),
    });
  }

  async function resolveMapsLink(value: string) {
    if (!token) throw new Error('سجّل الدخول أولاً.');
    return request<ResolvedMapsLink>('/location/resolve-maps-link', token, {
      method: 'POST',
      body: JSON.stringify({ url: value }),
    });
  }

  async function validateRegistrationLocation(point: MapPoint) {
    return request<LocationValidation>(
      '/auth/merchant-registration/location/validate',
      undefined,
      {
        method: 'POST',
        body: JSON.stringify(point),
      },
    );
  }

  async function resolveRegistrationMapsLink(value: string) {
    return request<ResolvedMapsLink>(
      '/auth/merchant-registration/location/resolve-maps-link',
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({ url: value }),
      },
    );
  }

  async function registerMerchant(payload: MerchantRegistrationPayload) {
    await request('/auth/merchant-registration', undefined, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setRegistrationSubmitted({
      businessName: payload.business.name,
      phone: payload.phone,
    });
  }

  async function openOrder(orderId: string) {
    if (!token) return;
    setLoading(true);
    try {
      setSelectedOrder(await request<Order>(`/orders/${orderId}`, token));
      setView('orders');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function openNotification(notification: Notification) {
    if (!token) return;
    if (!notification.readAt) {
      await request(`/notifications/${notification.id}/read`, token, {
        method: 'POST',
      });
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    const orderId = notification.deepLink?.match(/^\/orders\/([^/]+)$/)?.[1];
    if (orderId) await openOrder(orderId);
  }

  async function cancelOrder() {
    if (!token || !selectedOrder) return;
    const afterPickup = [
      'PICKED_UP',
      'IN_TRANSIT',
      'AT_DROPOFF',
      'DELIVERY_FAILED',
      'RETURNING_TO_STORE',
    ].includes(selectedOrder.status);
    if (
      afterPickup &&
      !window.confirm(
        'المندوب استلم الطلب بالفعل. عند الإلغاء سيتم إرجاع الطلب إلى الفرع وستظل قيمة التوصيل مستحقة بالكامل.',
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const updated = await request<Order>(
        `/orders/${selectedOrder.id}/cancel`,
        token,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('cancel') },
          body: JSON.stringify({
            reasonCode: cancelReason,
            details: cancelReason === 'other' ? cancelDetails : undefined,
            version: selectedOrder.version,
          }),
        },
      );
      setSelectedOrder(updated);
      setOrders((current) =>
        current.map((order) => (order.id === updated.id ? updated : order)),
      );
      setMessage(
        updated.cancelledAfterPickup
          ? 'تم تسجيل الإلغاء بعد الاستلام، وبدأ مسار إرجاع الطلب إلى الفرع مع استحقاق قيمة التوصيل الأصلية بالكامل.'
          : 'تم إلغاء الطلب مجاناً وتسجيل الحدث في السجل.',
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function retryCourierSearch() {
    if (!token || !selectedOrder) return;
    setLoading(true);
    setError('');
    try {
      const updated = await request<Order>(
        `/orders/${selectedOrder.id}/retry-courier-search`,
        token,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': newIdempotencyKey('retry-courier-search'),
          },
          body: JSON.stringify({ version: selectedOrder.version }),
        },
      );
      setSelectedOrder(updated);
      setOrders((current) =>
        current.map((order) => (order.id === updated.id ? updated : order)),
      );
      setMessage('بدأت محاولة البحث الثانية عن مندوب لمدة خمس دقائق.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function disputeDelivery() {
    if (!token || !selectedOrder) return;
    try {
      await request(
        `/merchant/orders/${selectedOrder.id}/delivery-disputes`,
        token,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('dispute') },
          body: JSON.stringify({
            version: selectedOrder.version,
            reason: 'CUSTOMER_DID_NOT_RECEIVE',
            note: 'أفاد العميل بأنه لم يستلم الطلب.',
          }),
        },
      );
      await openOrder(selectedOrder.id);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function confirmReturn() {
    if (!token || !selectedOrder) return;
    try {
      const updated = await request<Order>(
        `/merchant/orders/${selectedOrder.id}/confirm-return`,
        token,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newIdempotencyKey('confirm-return') },
          body: JSON.stringify({
            version: selectedOrder.version,
            condition: 'INTACT',
          }),
        },
      );
      setSelectedOrder(updated);
      await loadWorkspace(token);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function openCustomer(customerId: string) {
    if (!token) return;
    try {
      setSelectedCustomer(
        await request<Customer>(`/merchant/customers/${customerId}`, token),
      );
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    try {
      const customer = await request<Customer>('/merchant/customers', token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          phone: form.get('phone'),
          email: form.get('email') || undefined,
          notes: form.get('notes') || undefined,
        }),
      });
      setCustomers((current) => [customer, ...current]);
      event.currentTarget.reset();
      setMessage('تمت إضافة العميل.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function archiveCustomer(customer: Customer) {
    if (!token) return;
    try {
      await request(`/merchant/customers/${customer.id}/archive`, token, {
        method: 'POST',
      });
      setCustomers((current) =>
        current.filter((row) => row.id !== customer.id),
      );
      setSelectedCustomer(undefined);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function updateMerchant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !merchant) return;
    const form = new FormData(event.currentTarget);
    try {
      const updated = await request<Merchant>('/merchants/current', token, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: form.get('displayName'),
          legalName: form.get('legalName'),
          version: merchant.version,
        }),
      });
      setMerchant(updated);
      setMessage('تم تحديث بيانات المتجر.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function toggleStore(store: Store) {
    if (!token) return;
    try {
      await request(`/merchants/current/stores/${store.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: store.version,
          active: store.status !== 'ACTIVE',
        }),
      });
      setStores(await request('/merchants/current/stores', token));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function createStore(input: BranchCreationInput) {
    if (!token) throw new Error('سجّل الدخول أولاً.');
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await request<Store>('/merchants/current/stores', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setStores(await request<Store[]>('/merchants/current/stores', token));
      setMessage('تمت إضافة الفرع الجديد بنجاح.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleStaff(member: Staff) {
    if (!token) return;
    try {
      await request(`/merchants/current/staff/${member.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          version: member.version,
          active: !member.active,
        }),
      });
      setStaff(await request('/merchants/current/staff', token));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  if (!token) {
    if (registrationSubmitted) {
      return (
        <main className="pending-shell">
          <section className="pending-review-card">
            <img src={skkaLogo.src} alt="شعار سِكّة" />
            <p className="eyebrow">تم استلام طلب التسجيل</p>
            <h1>حسابك قيد المراجعة</h1>
            <p>
              تم إنشاء حساب {registrationSubmitted.businessName} والفرع الأول
              بنجاح. سيراجع فريق العمليات البيانات والموقع قبل تفعيل إنشاء
              الطلبات.
            </p>
            <dl className="readable-fields">
              <div>
                <dt>رقم الدخول بعد الاعتماد</dt>
                <dd dir="ltr">{registrationSubmitted.phone}</dd>
              </div>
              <div>
                <dt>الحالة</dt>
                <dd>قيد المراجعة</dd>
              </div>
            </dl>
            <button
              className="primary"
              onClick={() => {
                setPhone(registrationSubmitted.phone);
                setRegistrationSubmitted(undefined);
                setAuthMode('login');
              }}
              type="button"
            >
              العودة إلى تسجيل الدخول
            </button>
          </section>
        </main>
      );
    }
    return (
      <main
        className={`auth-shell${authMode === 'register' ? ' registration-shell' : ''}`}
      >
        <section className="auth-visual">
          <div className="auth-logo-frame">
            <img src={skkaLogo.src} alt="شعار سِكّة" className="auth-logo" />
          </div>
          <p className="eyebrow">SKKA · سِكّة للأعمال</p>
          <h1>طلبات التوصيل تبدأ من مساحة عمل واضحة.</h1>
          <p>
            كل طلب له سكة. أنشئ عرض سعر موثقاً، ثم أكد الطلب وتابع حالته من مكان
            واحد.
          </p>
        </section>
        {authMode === 'login' ? (
          <section className="auth-card" aria-labelledby="auth-title">
            <span className="phase-pill">
              المرحلة الرابعة · تشغيل تجريبي مضبوط
            </span>
            <h2 id="auth-title">تسجيل الدخول</h2>
            <form onSubmit={login} className="stack">
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
              <label>
                كلمة المرور
                <input
                  dir="ltr"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <button className="primary" disabled={loading}>
                تسجيل الدخول
              </button>
            </form>
            <button
              className="secondary create-account-button"
              onClick={() => {
                setAuthMode('register');
                setError('');
              }}
              type="button"
            >
              إنشاء حساب تاجر جديد
            </button>
            <p className="legal-links">
              <a href="/privacy">سياسة الخصوصية</a> ·{' '}
              <a href="/terms">شروط الاستخدام</a>
            </p>
            {error && <p className="notice error">{error}</p>}
          </section>
        ) : (
          <MerchantRegistrationForm
            fallbackPoint={{ latitude: 31.41754, longitude: 31.81444 }}
            onCancel={() => {
              setAuthMode('login');
              setError('');
            }}
            onResolveMapsLink={resolveRegistrationMapsLink}
            onSubmit={registerMerchant}
            onValidateLocation={validateRegistrationLocation}
          />
        )}
      </main>
    );
  }

  if (merchant && merchant.status !== 'ACTIVE') {
    return (
      <main className="pending-shell">
        <section className="pending-review-card">
          <img src={skkaLogo.src} alt="شعار سِكّة" />
          <p className="eyebrow">حالة حساب التاجر</p>
          <h1>
            {merchant.status === 'CHANGES_REQUESTED'
              ? 'مطلوب تعديل البيانات'
              : 'حسابك قيد المراجعة'}
          </h1>
          <p>
            {merchant.status === 'CHANGES_REQUESTED'
              ? 'راجع ملاحظات فريق العمليات وتواصل معهم لاستكمال التعديلات المطلوبة.'
              : 'تم حفظ بيانات النشاط والفرع الأول. لا يمكن إنشاء طلبات توصيل قبل اعتماد الحساب.'}
          </p>
          {merchant.reviewNotes && (
            <p className="notice error">
              ملاحظات فريق العمليات: {merchant.reviewNotes}
            </p>
          )}
          <dl className="readable-fields">
            <div>
              <dt>النشاط</dt>
              <dd>{merchant.displayName}</dd>
            </div>
            <div>
              <dt>عدد الفروع المسجلة</dt>
              <dd>{stores.length}</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd>
                {merchant.status === 'CHANGES_REQUESTED'
                  ? 'مطلوب تعديلات'
                  : 'قيد المراجعة'}
              </dd>
            </div>
          </dl>
          <button
            className="secondary"
            onClick={() => {
              setToken(undefined);
              setMerchant(undefined);
            }}
            type="button"
          >
            تسجيل الخروج
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={skkaLogo.src} alt="شعار سِكّة" />
          <strong>سِكّة</strong>
        </div>
        <nav aria-label="التنقل الرئيسي">
          {[
            ['dashboard', 'نظرة عامة'],
            ['new', 'طلب توصيل جديد'],
            ['orders', 'الطلبات'],
            ['customers', 'العملاء'],
            ['settings', 'المتجر والفريق'],
            [
              'notifications',
              `الإشعارات${unreadCount ? ` (${unreadCount})` : ''}`,
            ],
          ].map(([key, label]) => (
            <button
              key={key}
              className={view === key ? 'active' : ''}
              onClick={() => {
                setView(key as typeof view);
                setSelectedOrder(undefined);
                setMessage('');
                setError('');
              }}
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
            <p className="eyebrow">مساحة التاجر · المرحلة الثالثة</p>
            <h1>{merchant?.displayName ?? 'سِكّة'}</h1>
          </div>
          <span className="status-dot">
            {connected ? 'التحديث المباشر متصل' : 'إعادة الاتصال…'}
          </span>
        </header>
        {loading && <p className="notice">جارٍ تنفيذ الطلب…</p>}
        {message && <p className="notice">{message}</p>}
        {error && <p className="notice error">{error}</p>}

        {view === 'dashboard' && (
          <Dashboard
            orders={orders}
            customers={customers}
            onCreate={() => setView('new')}
            onOpen={openOrder}
          />
        )}
        {view === 'new' && (
          <CanonicalNewOrder
            customers={customers}
            stores={stores}
            quote={quote}
            quoteFingerprint={quoteFingerprint}
            createdOrder={createdOrder}
            secondsLeft={secondsLeft}
            onSubmit={createQuote}
            onConfirm={confirmOrder}
            onResolveMapsLink={resolveMapsLink}
            onValidateLocation={validateLocation}
            onInvalidateQuote={() => {
              setQuote(undefined);
              setQuoteFingerprint(undefined);
            }}
            onOpenOrder={openOrder}
            onReset={() => {
              setQuote(undefined);
              setQuoteFingerprint(undefined);
              setCreatedOrder(undefined);
            }}
          />
        )}
        {view === 'orders' &&
          (selectedOrder ? (
            <OrderDetails
              order={selectedOrder}
              canCancel={
                merchant?.membership.role !== 'STAFF' &&
                !selectedOrder.cancelledAt &&
                [
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
                  'DELIVERY_FAILED',
                  'RETURNING_TO_STORE',
                ].includes(selectedOrder.status)
              }
              canRetry={
                merchant?.membership.role !== 'STAFF' &&
                selectedOrder.status === 'NO_COURIER_AVAILABLE' &&
                selectedOrder.dispatchAttemptCount < 2
              }
              reason={cancelReason}
              details={cancelDetails}
              setReason={setCancelReason}
              setDetails={setCancelDetails}
              onCancel={cancelOrder}
              onRetry={retryCourierSearch}
              onDispute={disputeDelivery}
              onConfirmReturn={confirmReturn}
              onBack={() => setSelectedOrder(undefined)}
            />
          ) : (
            <OrderList
              orders={activeOrders}
              statusFilter={orderStatusFilter}
              setStatusFilter={setOrderStatusFilter}
              onOpen={openOrder}
            />
          ))}
        {view === 'customers' && (
          <Customers
            customers={customers}
            selected={selectedCustomer}
            onSelect={openCustomer}
            onAdd={addCustomer}
            onArchive={archiveCustomer}
          />
        )}
        {view === 'settings' && merchant && (
          <Settings
            merchant={merchant}
            stores={stores}
            staff={staff}
            onCreateStore={createStore}
            onResolveMapsLink={resolveMapsLink}
            onUpdateMerchant={updateMerchant}
            onValidateLocation={validatePickupLocation}
            onToggleStore={toggleStore}
            onToggleStaff={toggleStaff}
          />
        )}
        {view === 'notifications' && (
          <section className="panel">
            <h2>الإشعارات</h2>
            {notifications.map((notification) => (
              <button
                className="notification-row"
                key={notification.id}
                onClick={() => void openNotification(notification)}
              >
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <time>
                  {new Date(notification.createdAt).toLocaleString('ar-EG')}
                </time>
                {!notification.readAt && <span>جديد</span>}
              </button>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function Dashboard({
  orders,
  customers,
  onCreate,
  onOpen,
}: {
  orders: Order[];
  customers: Customer[];
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <section className="hero-panel">
        <div>
          <span className="phase-pill">جاهز لإنشاء أول طلب</span>
          <h2>تسعير واضح قبل تأكيد التوصيل.</h2>
          <p>
            السعر والمسار والعناوين تحفظ كلقطات ثابتة، ثم تتابع دورة التوصيل
            الكاملة من قبول المندوب حتى الإتمام دون تتبع حي.
          </p>
          <button className="accent" onClick={onCreate}>
            إنشاء طلب توصيل
          </button>
        </div>
        <img src="/brand/skka-logo.png" alt="شعار سِكّة" />
      </section>
      <div className="metric-grid">
        <article>
          <strong>{orders.length}</strong>
          <span>إجمالي الطلبات</span>
        </article>
        <article>
          <strong>
            {
              orders.filter((order) => order.status === 'SEARCHING_COURIER')
                .length
            }
          </strong>
          <span>طلبات تبحث عن مندوب</span>
        </article>
        <article>
          <strong>{customers.length}</strong>
          <span>عملاء نشطون</span>
        </article>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">آخر النشاط</p>
            <h2>الطلبات الحديثة</h2>
          </div>
        </div>
        <OrderRows orders={orders.slice(0, 5)} onOpen={onOpen} />
      </section>
    </>
  );
}

function NewOrderLegacy({
  stores,
  customers,
  selectedCustomer,
  quote,
  quoteFingerprint,
  createdOrder,
  secondsLeft,
  onCustomer,
  onCustomerClear,
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
  selectedCustomer?: Customer;
  quote?: Quote;
  quoteFingerprint?: string;
  createdOrder?: Order;
  secondsLeft: number;
  onCustomer: (id: string) => void;
  onCustomerClear: () => void;
  onSubmit: (body: QuoteRequestPayload, fingerprint: string) => void;
  onConfirm: (fingerprint: string) => void;
  onResolveMapsLink: (value: string) => Promise<ResolvedMapsLink>;
  onValidateLocation: (point: MapPoint) => Promise<LocationValidation>;
  onInvalidateQuote: () => void;
  onOpenOrder: (id: string) => void;
  onReset: () => void;
}) {
  type Draft = {
    addressId: string;
    addressLine: string;
    apartment: string;
    area: string;
    buildingNumber: string;
    category: string;
    contactName: string;
    contactPhone: string;
    courierNotes: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerOrderReference: string;
    declaredValue: string;
    deliveryNotes: string;
    floor: string;
    fragile: boolean;
    instructions: string;
    itemDescription: string;
    landmark: string;
    latitude: string;
    locationConfirmed: boolean;
    locationEligibility: LocationEligibility;
    locationSource: LocationSource;
    longitude: string;
    merchantReference: string;
    packageCount: string;
    packageSize: string;
    prohibitedItemsConfirmed: boolean;
    recipientNotes: string;
    saveAddress: boolean;
    serviceZoneName: string;
    sourceMapsUrl: string;
    storeId: string;
    street: string;
    thermalBag: boolean;
    weightKg: string;
  };

  const initialDraft = (): Draft => ({
    addressId: '',
    addressLine: '',
    apartment: '',
    area: 'الأعصر',
    buildingNumber: '',
    category: 'food',
    contactName: '',
    contactPhone: '',
    courierNotes: '',
    customerId: '',
    customerName: '',
    customerPhone: '',
    customerOrderReference: '',
    declaredValue: '100',
    deliveryNotes: '',
    floor: '',
    fragile: false,
    instructions: '',
    itemDescription: '',
    landmark: '',
    latitude: '31.432100',
    locationConfirmed: false,
    locationEligibility: 'UNVALIDATED',
    locationSource: 'MANUAL_COORDINATES',
    longitude: '31.827300',
    merchantReference: '',
    packageCount: '1',
    packageSize: 'small',
    prohibitedItemsConfirmed: false,
    recipientNotes: '',
    saveAddress: false,
    serviceZoneName: '',
    sourceMapsUrl: '',
    storeId: stores.find((store) => store.status === 'ACTIVE')?.id ?? '',
    street: '',
    thermalBag: false,
    weightKg: '1',
  });

  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingMapPoint, setPendingMapPoint] = useState<MapPoint>();
  const [pendingMapSource, setPendingMapSource] =
    useState<LocationSource>('MAP_PICKER');
  const [pendingMapsUrl, setPendingMapsUrl] = useState('');
  const [pendingMapGuidance, setPendingMapGuidance] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState('');
  const activeCustomer =
    selectedCustomer?.id === draft.customerId ? selectedCustomer : undefined;
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

  const point = {
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
  };
  const fingerprintInput: QuoteFingerprintInput = {
    addressIdentity: draft.addressId || `temporary:${draft.locationSource}`,
    category: draft.category,
    customerIdentity:
      draft.customerId ||
      `${draft.customerName.trim()}:${draft.customerPhone.trim()}`,
    declaredValueMinor: Math.round(Number(draft.declaredValue || 0) * 100),
    fragile: draft.fragile,
    latitude: Number.isFinite(point.latitude) ? point.latitude : 0,
    longitude: Number.isFinite(point.longitude) ? point.longitude : 0,
    packageCount: Number(draft.packageCount || 0),
    packageSize: draft.packageSize,
    storeId: effectiveStoreId,
    thermalBag: draft.thermalBag,
    weightGrams: Math.round(Number(draft.weightKg || 0) * 1_000),
  };
  const currentFingerprint = quoteInputFingerprint(fingerprintInput);
  const freshQuote = quoteMatchesInput(quoteFingerprint, fingerprintInput);
  const quoteAllowed = canRequestQuote(
    draft.locationConfirmed,
    draft.locationEligibility,
  );

  function change(fields: Partial<Draft>, invalidatesQuote = false) {
    setDraft((current) => ({ ...current, ...fields }));
    if (invalidatesQuote) onInvalidateQuote();
  }

  function chooseCustomer(customerId: string) {
    onInvalidateQuote();
    if (!customerId) {
      onCustomerClear();
      change({
        addressId: '',
        customerId: '',
        locationConfirmed: false,
        locationEligibility: 'UNVALIDATED',
      });
      return;
    }
    change({
      addressId: '',
      customerId,
      locationConfirmed: false,
      locationEligibility: 'UNVALIDATED',
    });
    void onCustomer(customerId);
  }

  async function chooseSavedAddress(addressId: string) {
    onInvalidateQuote();
    const address = activeCustomer?.addresses?.find(
      (candidate) => candidate.id === addressId,
    );
    if (!address) {
      change({
        addressId: '',
        locationConfirmed: false,
        locationEligibility: 'UNVALIDATED',
        locationSource: 'MANUAL_COORDINATES',
      });
      return;
    }
    setLocationBusy(true);
    setLocationError('');
    change({
      addressId: address.id,
      addressLine: address.addressLine,
      area: address.area,
      latitude: String(address.latitude),
      locationConfirmed: false,
      locationEligibility: 'UNVALIDATED',
      locationSource: 'SAVED_ADDRESS',
      longitude: String(address.longitude),
      sourceMapsUrl: address.sourceMapsUrl ?? '',
    });
    try {
      const validation = await onValidateLocation(address);
      change({
        locationConfirmed: true,
        locationEligibility: validation.supported ? 'INSIDE' : 'OUTSIDE',
        serviceZoneName: validation.serviceZone?.name ?? '',
      });
    } catch (caught) {
      setLocationError(locationRequestErrorMessage(caught));
    } finally {
      setLocationBusy(false);
    }
  }

  async function confirmLocation(
    selectedPoint: MapPoint,
    source: LocationSource,
    sourceMapsUrl = '',
  ) {
    setLocationError('');
    try {
      const validation = await onValidateLocation(selectedPoint);
      change(
        {
          addressId: '',
          latitude: selectedPoint.latitude.toFixed(6),
          locationConfirmed: true,
          locationEligibility: validation.supported ? 'INSIDE' : 'OUTSIDE',
          locationSource: source,
          longitude: selectedPoint.longitude.toFixed(6),
          serviceZoneName: validation.serviceZone?.name ?? '',
          sourceMapsUrl,
        },
        true,
      );
      setMapOpen(false);
    } catch (caught) {
      setLocationError(locationRequestErrorMessage(caught));
      throw caught;
    }
  }

  function openMap(
    source: LocationSource,
    selectedPoint = point,
    guidance = '',
  ) {
    setPendingMapSource(source);
    setPendingMapPoint(selectedPoint);
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
      const resolvedPoint =
        resolved.latitude !== null && resolved.longitude !== null
          ? {
              latitude: resolved.latitude,
              longitude: resolved.longitude,
            }
          : draft.locationConfirmed
            ? point
            : (storePoint ?? point);
      setPendingMapSource('GOOGLE_MAPS_LINK');
      setPendingMapPoint(resolvedPoint);
      setPendingMapsUrl(originalUrl);
      setPendingMapGuidance(
        resolved.status === 'MANUAL_SELECTION_REQUIRED'
          ? (resolved.userMessage ?? manualMapsLinkMessage)
          : '',
      );
      setMapOpen(true);
    } catch (caught) {
      setLocationError(locationRequestErrorMessage(caught));
    } finally {
      setLocationBusy(false);
    }
  }

  async function confirmManualCoordinates() {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      setLocationError('أدخل إحداثيات صحيحة.');
      return;
    }
    setLocationBusy(true);
    try {
      await confirmLocation(point, 'MANUAL_COORDINATES');
    } catch {
      // The validation message is already displayed in the location section.
    } finally {
      setLocationBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocationError('');
    if (!draft.locationConfirmed) {
      setLocationError('أكد موقع العميل قبل حساب سعر التوصيل.');
      return;
    }
    if (!quoteAllowed) {
      setLocationError(outsideServiceZoneMessage);
      return;
    }
    if (!draft.prohibitedItemsConfirmed) return;
    const customer = activeCustomer
      ? { customerId: activeCustomer.id }
      : {
          name: draft.customerName,
          phone: draft.customerPhone,
        };
    const contactName =
      draft.contactName || activeCustomer?.name || draft.customerName;
    const contactPhone =
      draft.contactPhone ||
      activeCustomer?.normalizedPhone ||
      draft.customerPhone;
    const quotePoint = pointForQuote(point);
    const dropoff: QuoteRequestPayload['dropoff'] = draft.addressId
      ? { addressId: draft.addressId }
      : {
          saveAddress: draft.saveAddress,
          contactName,
          contactPhone,
          addressLine: draft.addressLine,
          ...(draft.street ? { street: draft.street } : {}),
          ...(draft.buildingNumber
            ? { buildingNumber: draft.buildingNumber }
            : {}),
          ...(draft.floor ? { floor: draft.floor } : {}),
          ...(draft.apartment ? { apartment: draft.apartment } : {}),
          ...(draft.landmark ? { landmark: draft.landmark } : {}),
          area: draft.area,
          city: 'دمياط',
          governorate: 'دمياط',
          ...(draft.instructions ? { instructions: draft.instructions } : {}),
          ...(draft.deliveryNotes
            ? { deliveryNotes: draft.deliveryNotes }
            : {}),
          ...(draft.sourceMapsUrl
            ? { sourceMapsUrl: draft.sourceMapsUrl }
            : {}),
          locationSource: draft.locationSource,
          latitude: quotePoint.latitude,
          longitude: quotePoint.longitude,
        };
    onSubmit(
      {
        storeId: effectiveStoreId,
        customer,
        dropoff,
        package: {
          category: draft.category,
          itemDescription: draft.itemDescription,
          size: draft.packageSize,
          weightGrams: fingerprintInput.weightGrams,
          packageCount: fingerprintInput.packageCount,
          fragile: draft.fragile,
          requiresThermalBag: draft.thermalBag,
          ...(draft.recipientNotes
            ? { recipientNotes: draft.recipientNotes }
            : {}),
          ...(draft.courierNotes ? { courierNotes: draft.courierNotes } : {}),
          declaredValueMinor: fingerprintInput.declaredValueMinor,
          prohibitedItemsConfirmed: true,
          ...(draft.merchantReference
            ? { merchantReference: draft.merchantReference }
            : {}),
          ...(draft.customerOrderReference
            ? { customerOrderReference: draft.customerOrderReference }
            : {}),
        },
      },
      currentFingerprint,
    );
  }

  function resetForAnotherOrder() {
    setDraft(initialDraft());
    onCustomerClear();
    onReset();
  }

  if (createdOrder) {
    return (
      <section className="searching-card">
        <img src="/brand/skka-logo.png" alt="" />
        <span className="status-dot">تم إنشاء الطلب</span>
        <h2>{createdOrder.orderNumber}</h2>
        <p className="searching-status">جارٍ البحث عن مندوب</p>
        <p>
          الطلب محفوظ بنجاح ومتاح للمندوبين المؤهلين في نطاق الخدمة. أول قبول
          ذري ناجح هو الذي يعيّن المندوب.
        </p>
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
            <OpenMapPreview
              point={{
                latitude: quote.dropoffAddressSnapshot.latitude,
                longitude: quote.dropoffAddressSnapshot.longitude,
              }}
            />
            <a
              href={
                quote.dropoffAddressSnapshot.sourceMapsUrl ??
                googleMapsUrl(quote.dropoffAddressSnapshot)
              }
              rel="noreferrer"
              target="_blank"
            >
              فتح موقع العميل
            </a>
            <p className="notice">
              يجب على التاجر تأكيد دقة نقطة التسليم. المسافة والمدة تقدير محلي
              وليستا مسار طريق أو حركة مرور حية.
            </p>
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
          {process.env.NODE_ENV !== 'production' && (
            <details className="technical-details">
              <summary>بيانات التحقق التطويرية</summary>
              <dl className="readable-fields">
                <div>
                  <dt>نقطة الاستلام</dt>
                  <dd dir="ltr">
                    {quote.pickupAddressSnapshot.latitude},{' '}
                    {quote.pickupAddressSnapshot.longitude}
                  </dd>
                </div>
                <div>
                  <dt>نقطة التسليم</dt>
                  <dd dir="ltr">
                    {quote.dropoffAddressSnapshot.latitude},{' '}
                    {quote.dropoffAddressSnapshot.longitude}
                  </dd>
                </div>
                <div>
                  <dt>نسخة قاعدة التسعير</dt>
                  <dd>{quote.pricingRuleVersion}</dd>
                </div>
              </dl>
            </details>
          )}
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
            onClick={() => onConfirm(currentFingerprint)}
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
      <form className="order-form" onSubmit={submit}>
        <section className="panel">
          <p className="eyebrow">١ · الاستلام والعميل</p>
          <h2>بيانات طرفي التوصيل</h2>
          <div className="form-grid">
            <label>
              فرع الاستلام
              <select
                required
                value={effectiveStoreId}
                onChange={(event) =>
                  change({ storeId: event.target.value }, true)
                }
              >
                {stores
                  .filter((store) => store.status === 'ACTIVE')
                  .map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name} · {store.area}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              عميل محفوظ
              <select
                value={draft.customerId}
                onChange={(event) => chooseCustomer(event.target.value)}
              >
                <option value="">عميل جديد</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.normalizedPhone}
                  </option>
                ))}
              </select>
            </label>
            {!activeCustomer && (
              <>
                <label>
                  اسم العميل
                  <input
                    required
                    value={draft.customerName}
                    onChange={(event) =>
                      change({ customerName: event.target.value }, true)
                    }
                  />
                </label>
                <label>
                  رقم الموبايل
                  <input
                    dir="ltr"
                    required
                    value={draft.customerPhone}
                    onChange={(event) =>
                      change({ customerPhone: event.target.value }, true)
                    }
                  />
                </label>
              </>
            )}
          </div>
        </section>

        <section className="panel customer-location-section">
          <p className="eyebrow">٢ · موقع العميل</p>
          <h2>اختيار موقع العميل</h2>
          <p>اختر النقطة بصرياً. لا تحتاج إلى معرفة خط العرض أو خط الطول.</p>
          {activeCustomer?.addresses?.length ? (
            <label>
              عنوان محفوظ
              <select
                value={draft.addressId}
                onChange={(event) =>
                  void chooseSavedAddress(event.target.value)
                }
              >
                <option value="">استخدام موقع مختلف</option>
                {activeCustomer.addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label ?? address.area} · {address.addressLine}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="location-actions">
            <button
              className="primary"
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
          <p className="location-explanation">
            استخدم موقع الجهاز فقط إذا كان الجهاز موجوداً الآن عند عنوان العميل.
            يطلب المتصفح الإذن بعد الضغط فقط، وتُقرأ نقطة واحدة دون تتبع مستمر.
          </p>
          <div className="maps-link-row">
            <label>
              لصق رابط Google Maps
              <input
                dir="ltr"
                placeholder="https://www.google.com/maps/... أو https://maps.app.goo.gl/..."
                value={draft.sourceMapsUrl}
                onChange={(event) =>
                  change(
                    {
                      addressId: '',
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
                    change(
                      {
                        addressId: '',
                        latitude: event.target.value,
                        locationConfirmed: false,
                        locationEligibility: 'UNVALIDATED',
                        locationSource: 'MANUAL_COORDINATES',
                        sourceMapsUrl: '',
                      },
                      true,
                    )
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
                    change(
                      {
                        addressId: '',
                        locationConfirmed: false,
                        locationEligibility: 'UNVALIDATED',
                        locationSource: 'MANUAL_COORDINATES',
                        longitude: event.target.value,
                        sourceMapsUrl: '',
                      },
                      true,
                    )
                  }
                />
              </label>
              <button
                className="secondary"
                disabled={locationBusy}
                onClick={() => void confirmManualCoordinates()}
                type="button"
              >
                تأكيد الإحداثيات
              </button>
            </div>
          </details>
          {locationError && <p className="notice error">{locationError}</p>}
          {draft.locationConfirmed && (
            <div
              className={`selected-location-card${
                draft.locationEligibility === 'OUTSIDE' ? ' outside-zone' : ''
              }`}
            >
              <OpenMapPreview point={point} />
              <div>
                <strong>تم اختيار الموقع</strong>
                <p>
                  {draft.serviceZoneName || draft.area} ·{' '}
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
                <a
                  href={draft.sourceMapsUrl || googleMapsUrl(point)}
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
                          addressId: '',
                          locationConfirmed: false,
                          locationEligibility: 'UNVALIDATED',
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
            <label className="span-2">
              العنوان النصي
              <input
                required={!draft.addressId}
                value={draft.addressLine}
                onChange={(event) =>
                  change({ addressLine: event.target.value })
                }
              />
            </label>
            <label>
              الشارع
              <input
                value={draft.street}
                onChange={(event) => change({ street: event.target.value })}
              />
            </label>
            <label>
              المنطقة
              <input
                value={draft.area}
                onChange={(event) => change({ area: event.target.value })}
              />
            </label>
            <label>
              اسم المستلم
              <input
                value={draft.contactName}
                onChange={(event) =>
                  change({ contactName: event.target.value })
                }
              />
            </label>
            <label>
              هاتف المستلم
              <input
                dir="ltr"
                value={draft.contactPhone}
                onChange={(event) =>
                  change({ contactPhone: event.target.value })
                }
              />
            </label>
            <label>
              رقم المبنى
              <input
                value={draft.buildingNumber}
                onChange={(event) =>
                  change({ buildingNumber: event.target.value })
                }
              />
            </label>
            <label>
              الدور / الشقة
              <span className="inline-inputs">
                <input
                  aria-label="الدور"
                  value={draft.floor}
                  onChange={(event) => change({ floor: event.target.value })}
                />
                <input
                  aria-label="الشقة"
                  value={draft.apartment}
                  onChange={(event) =>
                    change({ apartment: event.target.value })
                  }
                />
              </span>
            </label>
            <label>
              علامة مميزة
              <input
                value={draft.landmark}
                onChange={(event) => change({ landmark: event.target.value })}
              />
            </label>
            <label className="span-2">
              تعليمات التسليم
              <textarea
                value={draft.instructions}
                onChange={(event) =>
                  change({ instructions: event.target.value })
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
              حفظ العنوان لهذا العميل
            </label>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">٣ · تفاصيل الطرد</p>
          <h2>ما الذي سيتم توصيله؟</h2>
          <div className="form-grid">
            <label>
              الفئة
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
              وصف مختصر
              <input
                required
                value={draft.itemDescription}
                onChange={(event) =>
                  change({ itemDescription: event.target.value })
                }
              />
            </label>
            <label>
              الحجم
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
              الوزن التقريبي بالكيلوجرام
              <input
                max="25"
                min="0.1"
                required
                step="0.1"
                type="number"
                value={draft.weightKg}
                onChange={(event) =>
                  change({ weightKg: event.target.value }, true)
                }
              />
            </label>
            <label>
              عدد الطرود
              <input
                max="20"
                min="1"
                required
                type="number"
                value={draft.packageCount}
                onChange={(event) =>
                  change({ packageCount: event.target.value }, true)
                }
              />
            </label>
            <label>
              القيمة المعلنة بالجنيه
              <input
                max="5000"
                min="0"
                required
                type="number"
                value={draft.declaredValue}
                onChange={(event) =>
                  change({ declaredValue: event.target.value }, true)
                }
              />
            </label>
            <label className="check">
              <input
                checked={draft.fragile}
                onChange={(event) =>
                  change({ fragile: event.target.checked }, true)
                }
                type="checkbox"
              />
              قابل للكسر
            </label>
            <label className="check">
              <input
                checked={draft.thermalBag}
                onChange={(event) =>
                  change({ thermalBag: event.target.checked }, true)
                }
                type="checkbox"
              />
              يحتاج حقيبة حرارية
            </label>
            <label className="span-2">
              ملاحظات للمندوب
              <textarea
                value={draft.courierNotes}
                onChange={(event) =>
                  change({ courierNotes: event.target.value })
                }
              />
            </label>
            <label className="declaration span-2">
              <input
                checked={draft.prohibitedItemsConfirmed}
                onChange={(event) =>
                  change({
                    prohibitedItemsConfirmed: event.target.checked,
                  })
                }
                required
                type="checkbox"
              />
              أؤكد أن الطرد لا يحتوي على مواد محظورة أو خطرة أو غير مدعومة.
            </label>
          </div>
        </section>
        <button
          className="primary submit-order"
          disabled={!quoteAllowed}
          title={
            quoteAllowed
              ? undefined
              : draft.locationEligibility === 'OUTSIDE'
                ? outsideServiceZoneMessage
                : 'أكد موقعاً داخل نطاق التوصيل أولاً.'
          }
        >
          حساب سعر التوصيل من الموقع المحدد
        </button>
      </form>
      {mapOpen && pendingMapPoint && (
        <MapPicker
          guidance={pendingMapGuidance}
          initialPoint={pendingMapPoint}
          onCancel={() => setMapOpen(false)}
          onConfirm={(selectedPoint) =>
            confirmLocation(selectedPoint, pendingMapSource, pendingMapsUrl)
          }
          storePoint={storePoint}
        />
      )}
    </>
  );
}

void NewOrderLegacy;

const locationSourceLabels: Record<LocationSource | 'STORE', string> = {
  SAVED_ADDRESS: 'عنوان محفوظ',
  MAP_PICKER: 'اختيار على الخريطة',
  DEVICE_LOCATION: 'موقع الجهاز لمرة واحدة',
  GOOGLE_MAPS_LINK: 'رابط Google Maps',
  MANUAL_COORDINATES: 'إحداثيات يدوية متقدمة',
  STORE: 'موقع المتجر',
};

export function LegacyNewOrder({
  stores,
  customers,
  selectedCustomer,
  quote,
  createdOrder,
  secondsLeft,
  onCustomer,
  onSubmit,
  onRecalculate,
  onConfirm,
  onOpenOrder,
  onReset,
}: {
  stores: Store[];
  customers: Customer[];
  selectedCustomer?: Customer;
  quote?: Quote;
  createdOrder?: Order;
  secondsLeft: number;
  onCustomer: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRecalculate: () => void;
  onConfirm: () => void;
  onOpenOrder: (id: string) => void;
  onReset: () => void;
}) {
  if (createdOrder) {
    return (
      <section className="searching-card">
        <img src="/brand/skka-logo.png" alt="" />
        <span className="status-dot">تم إنشاء الطلب</span>
        <h2>{createdOrder.orderNumber}</h2>
        <p className="searching-status">جارٍ البحث عن مندوب</p>
        <p>
          الطلب محفوظ بنجاح ومتاح للمندوبين المؤهلين في نطاق الخدمة. أول قبول
          ذري ناجح هو الذي يعيّن المندوب.
        </p>
        <div className="button-row">
          <button
            className="primary"
            onClick={() => onOpenOrder(createdOrder.id)}
          >
            عرض تفاصيل الطلب
          </button>
          <button className="secondary" onClick={onReset}>
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
          <p className="eyebrow">عرض السعر</p>
          <h2>راجع التكلفة قبل التأكيد</h2>
          <div className="route-summary">
            <span>{(quote.distanceMeters / 1_000).toFixed(1)} كم</span>
            <span>{Math.ceil(quote.durationSeconds / 60)} دقيقة تقريباً</span>
          </div>
          <div className="location-review">
            <h3>المراجعة النهائية للموقع</h3>
            <p>
              العميل: {quote.customerSnapshot.name} ·{' '}
              <span dir="ltr">{quote.customerSnapshot.normalizedPhone}</span>
            </p>
            <p>الاستلام: {quote.pickupAddressSnapshot.addressLine}</p>
            <p>
              التسليم: {quote.dropoffAddressSnapshot.addressLine} ·{' '}
              {quote.dropoffAddressSnapshot.area}
            </p>
            <p dir="ltr">
              {quote.dropoffAddressSnapshot.latitude},{' '}
              {quote.dropoffAddressSnapshot.longitude}
            </p>
            {quote.dropoffAddressSnapshot.sourceMapsUrl && (
              <a
                href={quote.dropoffAddressSnapshot.sourceMapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                فتح رابط خرائط Google الخارجي
              </a>
            )}
            <p className="notice">
              المسافة والمدة تقريبية ومحسوبة محلياً، وليستا مسافة طريق مضمونة.
            </p>
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
          <p>
            سيتم نسخ السعر والمسار والعناوين والطرد إلى سجل الطلب دون تغيير.
          </p>
          <button
            className="primary"
            disabled={secondsLeft === 0}
            onClick={onConfirm}
          >
            تأكيد وإنشاء الطلب
          </button>
          <button className="secondary" onClick={onRecalculate}>
            إعادة حساب السعر
          </button>
          <button className="text-button" onClick={onReset}>
            تعديل البيانات
          </button>
        </aside>
      </section>
    );
  }

  return (
    <form className="order-form" onSubmit={onSubmit}>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">١ · الاستلام والعميل</p>
            <h2>بيانات طرفي التوصيل</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            فرع الاستلام
            <select name="storeId" required>
              {stores
                .filter((store) => store.status === 'ACTIVE')
                .map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} · {store.area}
                  </option>
                ))}
            </select>
          </label>
          <label>
            عميل محفوظ
            <select
              name="customerId"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) void onCustomer(event.target.value);
              }}
            >
              <option value="">عميل جديد</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.normalizedPhone}
                </option>
              ))}
            </select>
          </label>
          {!selectedCustomer && (
            <>
              <label>
                اسم العميل الجديد
                <input name="customerName" />
              </label>
              <label>
                رقم موبايل العميل
                <input name="customerPhone" dir="ltr" />
              </label>
            </>
          )}
          {selectedCustomer && (
            <div className="selected-card">
              <strong>{selectedCustomer.name}</strong>
              <span dir="ltr">{selectedCustomer.normalizedPhone}</span>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <p className="eyebrow">٢ · عنوان التسليم</p>
        <h2>الموقع وتفاصيل الوصول</h2>
        {selectedCustomer?.addresses &&
          selectedCustomer.addresses.length > 0 && (
            <label>
              عنوان محفوظ
              <select name="addressId" defaultValue="">
                <option value="">إدخال عنوان مختلف</option>
                {selectedCustomer.addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label ?? address.area} · {address.addressLine}
                  </option>
                ))}
              </select>
            </label>
          )}
        <div className="form-grid">
          <label className="span-2">
            العنوان
            <input
              name="addressLine"
              placeholder="الشارع والمنطقة والعلامة الرئيسية"
            />
          </label>
          <label>
            الشارع (اختياري)
            <input name="street" />
          </label>
          <label>
            رابط Google Maps بإحداثيات (اختياري)
            <input
              name="sourceMapsUrl"
              dir="ltr"
              placeholder="https://www.google.com/maps/.../@30.0,31.0"
            />
          </label>
          <label>
            اسم المستلم
            <input name="contactName" />
          </label>
          <label>
            هاتف المستلم
            <input name="contactPhone" dir="ltr" />
          </label>
          <label>
            المنطقة
            <input name="area" defaultValue="الأعصر" />
          </label>
          <label>
            علامة مميزة
            <input name="landmark" />
          </label>
          <label>
            رقم المبنى
            <input name="buildingNumber" />
          </label>
          <label>
            الدور / الشقة
            <span className="inline-inputs">
              <input name="floor" aria-label="الدور" />
              <input name="apartment" aria-label="الشقة" />
            </span>
          </label>
          <div className="map-input span-2" aria-label="اختيار الموقع">
            <div>
              <strong>نقطة التسليم</strong>
              <span>
                إدخال إحداثيات محلي؛ ستستبدل هذه الواجهة بمزود خرائط لاحقاً.
              </span>
            </div>
            <label>
              خط العرض
              <input name="latitude" defaultValue="31.4321" dir="ltr" />
            </label>
            <label>
              خط الطول
              <input name="longitude" defaultValue="31.8273" dir="ltr" />
            </label>
          </div>
          <label className="span-2">
            تعليمات التسليم
            <textarea name="instructions" />
          </label>
          <label className="span-2">
            ملاحظات الوصول (اختياري)
            <textarea name="deliveryNotes" />
          </label>
          <label className="check span-2">
            <input type="checkbox" name="saveAddress" />
            حفظ العنوان لهذا العميل
          </label>
        </div>
      </section>
      <section className="panel">
        <p className="eyebrow">٣ · تفاصيل الطرد</p>
        <h2>ما الذي سيتم توصيله؟</h2>
        <div className="form-grid">
          <label>
            الفئة
            <select name="category" defaultValue="food">
              <option value="food">طعام</option>
              <option value="groceries">بقالة</option>
              <option value="pharmacy">صيدلية</option>
              <option value="documents">مستندات</option>
              <option value="clothing">ملابس</option>
              <option value="gifts">هدايا</option>
              <option value="electronics_accessories">ملحقات إلكترونية</option>
              <option value="spare_parts">قطع غيار</option>
              <option value="other">أخرى</option>
            </select>
          </label>
          <label>
            وصف مختصر
            <input name="itemDescription" required />
          </label>
          <label>
            الحجم
            <select name="size" defaultValue="small">
              <option value="small">صغير</option>
              <option value="medium">متوسط</option>
              <option value="large">كبير</option>
            </select>
          </label>
          <label>
            الوزن التقريبي بالكيلوجرام
            <input
              name="weightKg"
              type="number"
              min="0.1"
              max="25"
              step="0.1"
              defaultValue="1"
              required
            />
          </label>
          <label>
            عدد الطرود
            <input
              name="packageCount"
              type="number"
              min="1"
              max="20"
              defaultValue="1"
              required
            />
          </label>
          <label>
            القيمة المعلنة بالجنيه
            <input
              name="declaredValue"
              type="number"
              min="0"
              max="5000"
              defaultValue="100"
              required
            />
          </label>
          <label>
            مرجع التاجر
            <input name="merchantReference" />
          </label>
          <label>
            مرجع طلب العميل
            <input name="customerOrderReference" />
          </label>
          <label className="span-2">
            ملاحظات للمستلم
            <textarea name="recipientNotes" />
          </label>
          <label className="span-2">
            ملاحظات للمندوب
            <textarea name="courierNotes" />
          </label>
          <div className="check-grid span-2">
            <label className="check">
              <input type="checkbox" name="fragile" /> قابل للكسر
            </label>
            <label className="check">
              <input type="checkbox" name="requiresThermalBag" /> يحتاج حقيبة
              حرارية
            </label>
          </div>
          <label className="declaration span-2">
            <input type="checkbox" name="prohibitedItemsConfirmed" required />
            أؤكد أن الطرد لا يحتوي على مواد محظورة أو خطرة أو غير مدعومة.
          </label>
        </div>
      </section>
      <button className="primary submit-order">حساب سعر التوصيل</button>
    </form>
  );
}

function OrderList({
  orders,
  statusFilter,
  setStatusFilter,
  onOpen,
}: {
  orders: Order[];
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">سجل الطلبات</p>
          <h2>طلبات التوصيل</h2>
        </div>
        <select
          aria-label="تصفية بالحالة"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">كل الحالات</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <OrderRows orders={orders} onOpen={onOpen} />
    </section>
  );
}

function OrderRows({
  orders,
  onOpen,
}: {
  orders: Order[];
  onOpen: (id: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <div className="empty-state">
        <img src="/brand/skka-logo.png" alt="" />
        <p>لا توجد طلبات مطابقة بعد.</p>
      </div>
    );
  }
  return (
    <div className="order-table">
      <div className="order-head">
        <span>رقم الطلب</span>
        <span>العميل</span>
        <span>الحالة</span>
        <span>السعر</span>
        <span>التاريخ</span>
      </div>
      {orders.map((order) => (
        <button
          className="order-row"
          key={order.id}
          onClick={() => onOpen(order.id)}
        >
          <strong dir="ltr">{order.orderNumber}</strong>
          <span>
            {order.customer?.name ?? order.customerSnapshot?.name ?? '—'}
          </span>
          <span className={`state state-${order.status.toLowerCase()}`}>
            {statusLabels[order.status] ?? order.status}
          </span>
          <span>{money(order.merchantTotalMinor, order.currency)}</span>
          <time>{new Date(order.createdAt).toLocaleDateString('ar-EG')}</time>
        </button>
      ))}
    </div>
  );
}

export function AcceptanceCountdown({ expiresAt }: { expiresAt: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () =>
      setSeconds(
        Math.max(
          0,
          Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000),
        ),
      );
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return (
    <strong className="acceptance-countdown" aria-live="polite">
      {seconds > 0
        ? `${minutes}:${String(rest).padStart(2, '0')}`
        : 'انتهت المهلة — جارٍ تحديث الحالة'}
    </strong>
  );
}

function OrderDetails({
  order,
  canCancel,
  canRetry,
  reason,
  details,
  setReason,
  setDetails,
  onCancel,
  onRetry,
  onDispute,
  onConfirmReturn,
  onBack,
}: {
  order: Order;
  canCancel: boolean;
  canRetry: boolean;
  reason: string;
  details: string;
  setReason: (value: string) => void;
  setDetails: (value: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDispute: () => void;
  onConfirmReturn: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <button className="back" onClick={onBack}>
        → العودة إلى الطلبات
      </button>
      <header className="detail-header">
        <div>
          <p className="eyebrow">تفاصيل الطلب</p>
          <h2 dir="ltr">{order.orderNumber}</h2>
        </div>
        <span className={`state state-${order.status.toLowerCase()}`}>
          {statusLabels[order.status]}
        </span>
      </header>
      <div className="detail-grid">
        <section className="panel">
          <h3>العميل والعناوين</h3>
          <dl className="detail-list">
            <div>
              <dt>العميل</dt>
              <dd>{order.customerSnapshot.name}</dd>
            </div>
            <div>
              <dt>الاستلام</dt>
              <dd>{order.pickupAddressSnapshot.addressLine}</dd>
            </div>
            <div>
              <dt>التسليم</dt>
              <dd>{order.dropoffAddressSnapshot.addressLine}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h3>الطرد والسعر</h3>
          <dl className="detail-list">
            <div>
              <dt>الوصف</dt>
              <dd>{order.packageSnapshot.itemDescription}</dd>
            </div>
            <div>
              <dt>الوزن</dt>
              <dd>{order.packageSnapshot.weightGrams / 1_000} كجم</dd>
            </div>
            <div>
              <dt>إجمالي التاجر</dt>
              <dd>{money(order.merchantTotalMinor, order.currency)}</dd>
            </div>
          </dl>
        </section>
      </div>
      {order.status === 'SEARCHING_COURIER' && order.acceptanceExpiresAt && (
        <section className="panel search-card">
          <p className="eyebrow">
            محاولة البحث {order.dispatchAttemptCount} من 2
          </p>
          <h3>جارٍ البحث عن مندوب</h3>
          <p>يظل الطلب متاحاً للمندوبين المؤهلين لمدة خمس دقائق.</p>
          <AcceptanceCountdown expiresAt={order.acceptanceExpiresAt} />
        </section>
      )}
      {order.status === 'NO_COURIER_AVAILABLE' && (
        <section className="panel search-card">
          <h3>لم يتوفر مندوب خلال المهلة</h3>
          <p>
            لم يُحذف الطلب ولم تُحتسب أي رسوم. يمكنك إعادة البحث مرة واحدة أو
            إلغاء الطلب مجاناً.
          </p>
          {canRetry && (
            <button className="primary" onClick={onRetry}>
              إعادة البحث عن مندوب
            </button>
          )}
        </section>
      )}
      {order.status === 'NO_COURIER_AVAILABLE_FINAL' && (
        <section className="panel search-card">
          <h3>انتهت محاولتا البحث دون توفر مندوب</h3>
          <p>
            لا توجد محاولة بحث أخرى. يمكنك إلغاء الطلب مجاناً أو التواصل مع
            الدعم للمساعدة.
          </p>
        </section>
      )}
      <section className="panel timeline">
        <p className="eyebrow">سجل ثابت</p>
        <h3>الأحداث</h3>
        {order.events?.map((event) => (
          <div key={event.id}>
            <span />
            <p>{event.merchantMessage ?? event.eventType}</p>
            <time>{new Date(event.createdAt).toLocaleString('ar-EG')}</time>
          </div>
        ))}
      </section>
      {order.status === 'DELIVERED' && order.deliveryDisputeDeadlineAt && (
        <section className="panel cancel-card">
          <h3>نافذة اعتراض التسليم</h3>
          <p>
            يمكن للمالك أو المدير الإبلاغ عن عدم التسليم حتى{' '}
            {new Date(order.deliveryDisputeDeadlineAt).toLocaleString('ar-EG')}.
            لن تثبت العمولة قبل انتهاء النافذة أو قرار الإدارة.
          </p>
          <button className="danger" onClick={onDispute}>
            الإبلاغ عن عدم التسليم
          </button>
        </section>
      )}
      {order.status === 'DELIVERY_DISPUTED' && (
        <section className="panel notice">
          <h3>اعتراض مفتوح</h3>
          <p>تم إيقاف الإكمال المالي حتى قرار إدارة العمليات.</p>
        </section>
      )}
      {order.status === 'RETURN_AWAITING_MERCHANT_CONFIRMATION' && (
        <section className="panel">
          <h3>المرتجع وصل إلى المتجر</h3>
          <p>راجع الطرد ثم أكد استلامه. المندوب لا يستطيع إتمام هذه الخطوة.</p>
          <button className="primary" onClick={onConfirmReturn}>
            تأكيد استلام المرتجع بحالة سليمة
          </button>
        </section>
      )}
      {canCancel && (
        <section className="panel cancel-card">
          <h3>إلغاء الطلب</h3>
          {[
            'PICKED_UP',
            'IN_TRANSIT',
            'AT_DROPOFF',
            'DELIVERY_FAILED',
            'RETURNING_TO_STORE',
          ].includes(order.status) ? (
            <p className="notice error">
              المندوب استلم الطلب بالفعل. عند الإلغاء سيتم إرجاع الطلب إلى الفرع
              وستظل قيمة التوصيل مستحقة بالكامل.
            </p>
          ) : (
            <p>
              الإلغاء مجاني بالكامل قبل استلام المندوب للطلب، حتى لو كان المندوب
              معيّناً أو وصل إلى الفرع.
            </p>
          )}
          <label>
            السبب
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              <option value="customer_cancelled">إلغاء العميل</option>
              <option value="wrong_address">عنوان غير صحيح</option>
              <option value="duplicate_order">طلب مكرر</option>
              <option value="order_not_ready">الطلب غير جاهز</option>
              <option value="incorrect_details">بيانات غير صحيحة</option>
              <option value="no_longer_needed">لم يعد مطلوباً</option>
              <option value="other">سبب آخر</option>
            </select>
          </label>
          {reason === 'other' && (
            <label>
              التفاصيل
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
            </label>
          )}
          <button className="danger" onClick={onCancel}>
            {[
              'PICKED_UP',
              'IN_TRANSIT',
              'AT_DROPOFF',
              'DELIVERY_FAILED',
              'RETURNING_TO_STORE',
            ].includes(order.status)
              ? 'إلغاء وإرجاع الطلب إلى الفرع'
              : 'إلغاء الطلب مجاناً'}
          </button>
        </section>
      )}
    </>
  );
}

function Customers({
  customers,
  selected,
  onSelect,
  onAdd,
  onArchive,
}: {
  customers: Customer[];
  selected?: Customer;
  onSelect: (id: string) => void;
  onAdd: (event: FormEvent<HTMLFormElement>) => void;
  onArchive: (customer: Customer) => void;
}) {
  return (
    <div className="two-column">
      <section className="panel">
        <p className="eyebrow">دليل العملاء</p>
        <h2>العملاء النشطون</h2>
        <input
          type="search"
          placeholder="ابحث بالاسم أو الهاتف"
          aria-label="البحث عن عميل"
        />
        <div className="list">
          {customers.map((customer) => (
            <button
              className="customer-row"
              key={customer.id}
              onClick={() => onSelect(customer.id)}
            >
              <span>
                <strong>{customer.name}</strong>
                <small dir="ltr">{customer.normalizedPhone}</small>
              </span>
              <small>{customer._count?.addresses ?? 0} عناوين</small>
            </button>
          ))}
        </div>
      </section>
      <aside>
        {selected ? (
          <section className="panel">
            <p className="eyebrow">ملف العميل</p>
            <h2>{selected.name}</h2>
            <p dir="ltr">{selected.normalizedPhone}</p>
            <h3>العناوين المحفوظة</h3>
            {selected.addresses?.map((address) => (
              <article className="address-card" key={address.id}>
                <strong>{address.label ?? address.area}</strong>
                <span>{address.addressLine}</span>
              </article>
            ))}
            <button
              className="danger ghost"
              onClick={() => onArchive(selected)}
            >
              أرشفة العميل
            </button>
          </section>
        ) : (
          <section className="panel">
            <h2>إضافة عميل</h2>
            <form className="stack" onSubmit={onAdd}>
              <label>
                الاسم
                <input name="name" required />
              </label>
              <label>
                الهاتف
                <input name="phone" dir="ltr" required />
              </label>
              <label>
                البريد الإلكتروني
                <input name="email" type="email" />
              </label>
              <label>
                ملاحظات
                <textarea name="notes" />
              </label>
              <button className="primary">حفظ العميل</button>
            </form>
          </section>
        )}
      </aside>
    </div>
  );
}

function Settings({
  merchant,
  stores,
  staff,
  onCreateStore,
  onResolveMapsLink,
  onUpdateMerchant,
  onValidateLocation,
  onToggleStore,
  onToggleStaff,
}: {
  merchant: Merchant;
  stores: Store[];
  staff: Staff[];
  onCreateStore: (input: BranchCreationInput) => Promise<void>;
  onResolveMapsLink: (value: string) => Promise<ResolvedMapsLink>;
  onUpdateMerchant: (event: FormEvent<HTMLFormElement>) => void;
  onValidateLocation: (point: MapPoint) => Promise<LocationValidation>;
  onToggleStore: (store: Store) => void;
  onToggleStaff: (member: Staff) => void;
}) {
  const [addingBranch, setAddingBranch] = useState(false);
  const canAddBranch = canManageBranches(merchant.membership.role);
  const fallbackStore =
    stores.find(
      (store) =>
        store.status === 'ACTIVE' &&
        store.latitude !== null &&
        store.longitude !== null,
    ) ??
    stores.find((store) => store.latitude !== null && store.longitude !== null);
  const fallbackPoint =
    fallbackStore?.latitude !== null &&
    fallbackStore?.latitude !== undefined &&
    fallbackStore.longitude !== null &&
    fallbackStore.longitude !== undefined
      ? {
          latitude: fallbackStore.latitude,
          longitude: fallbackStore.longitude,
        }
      : { latitude: 31.41754, longitude: 31.81444 };

  return (
    <>
      <section className="panel">
        <p className="eyebrow">ملف المؤسسة</p>
        <h2>بيانات المتجر</h2>
        <form className="form-grid" onSubmit={onUpdateMerchant}>
          <label>
            الاسم التجاري
            <input name="displayName" defaultValue={merchant.displayName} />
          </label>
          <label>
            الاسم القانوني
            <input name="legalName" defaultValue={merchant.legalName} />
          </label>
          <button className="primary span-2">حفظ التعديلات</button>
        </form>
      </section>
      {addingBranch && canAddBranch && (
        <BranchCreationForm
          fallbackPoint={fallbackPoint}
          onCancel={() => setAddingBranch(false)}
          onCreate={onCreateStore}
          onResolveMapsLink={onResolveMapsLink}
          onValidateLocation={onValidateLocation}
        />
      )}
      <div className="two-column">
        <section className="panel">
          <div className="section-heading">
            <h2>الفروع</h2>
            {canAddBranch && !addingBranch && (
              <button
                className="primary"
                onClick={() => setAddingBranch(true)}
                type="button"
              >
                إضافة فرع جديد
              </button>
            )}
          </div>
          {stores.map((store) => (
            <article className="list-row" key={store.id}>
              <span>
                <strong>{store.name}</strong>
                <small>{store.area}</small>
                {store.coverageStatus === 'OUTSIDE_ACTIVE_ZONES' && (
                  <small className="coverage-warning">
                    خارج نطاق الخدمة الحالي
                  </small>
                )}
              </span>
              <button onClick={() => onToggleStore(store)}>
                {store.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
              </button>
            </article>
          ))}
        </section>
        <section className="panel">
          <h2>فريق العمل</h2>
          {staff.map((member) => (
            <article className="list-row" key={member.id}>
              <span>
                <strong>{member.user.displayName ?? 'عضو فريق'}</strong>
                <small>{member.role}</small>
              </span>
              <button
                disabled={member.role === 'OWNER'}
                onClick={() => onToggleStaff(member)}
              >
                {member.active ? 'تعطيل' : 'تفعيل'}
              </button>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
