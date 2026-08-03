import type { LocationEligibility } from './location-selection';

export type OrderLocationSource =
  | 'SAVED_ADDRESS'
  | 'MAP_PICKER'
  | 'DEVICE_LOCATION'
  | 'GOOGLE_MAPS_LINK'
  | 'MANUAL_COORDINATES';

export type QuoteRequestPayload = {
  storeId: string;
  customer: { name: string; phone: string };
  dropoff: {
    saveAddress: boolean;
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
    deliveryNotes?: string;
    sourceMapsUrl?: string;
    locationSource: OrderLocationSource;
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
    courierNotes?: string;
    declaredValueMinor: number;
    prohibitedItemsConfirmed: true;
  };
};

export type OrderFormInput = {
  addressLine: string;
  apartment: string;
  buildingNumber: string;
  category: string;
  courierNotes: string;
  declaredValue: string;
  floor: string;
  fragile: boolean;
  itemDescription: string;
  landmark: string;
  latitude: string;
  locationConfirmed: boolean;
  locationEligibility: LocationEligibility;
  locationSource: OrderLocationSource;
  longitude: string;
  packageCount: string;
  packageSize: string;
  prohibitedItemsConfirmed: boolean;
  customerName: string;
  customerPhone: string;
  saveAddress: boolean;
  serviceZoneCity: string;
  serviceZoneGovernorate: string;
  serviceZoneName: string;
  sourceMapsUrl: string;
  storeCoverageStatus?: string;
  storeId: string;
  street: string;
  thermalBag: boolean;
  weightKg: string;
};

export type OrderFormField =
  | 'addressLine'
  | 'declaredValue'
  | 'itemDescription'
  | 'location'
  | 'packageCount'
  | 'prohibitedItemsConfirmed'
  | 'customerName'
  | 'customerPhone'
  | 'storeId'
  | 'weightKg';

export type OrderFormErrors = Partial<Record<OrderFormField, string>>;

export type OrderFormValidation = {
  errors: OrderFormErrors;
  firstInvalidField?: OrderFormField;
};

const fieldOrder: OrderFormField[] = [
  'storeId',
  'customerName',
  'customerPhone',
  'addressLine',
  'location',
  'itemDescription',
  'weightKg',
  'packageCount',
  'declaredValue',
  'prohibitedItemsConfirmed',
];

export function normalizeEgyptianOrderPhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  if (/^01(0|1|2|5)\d{8}$/.test(compact)) {
    return `+20${compact.slice(1)}`;
  }
  if (/^201(0|1|2|5)\d{8}$/.test(compact)) return `+${compact}`;
  if (/^00201(0|1|2|5)\d{8}$/.test(compact)) {
    return `+${compact.slice(2)}`;
  }
  return compact;
}

function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

export function validateOrderForm(input: OrderFormInput): OrderFormValidation {
  const errors: OrderFormErrors = {};
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const weightKg = Number(input.weightKg);
  const packageCount = Number(input.packageCount);
  const declaredValue = Number(input.declaredValue);

  if (!input.storeId) {
    errors.storeId = 'فرع الاستلام مطلوب.';
  } else if (input.storeCoverageStatus !== 'INSIDE_ACTIVE_ZONE') {
    errors.storeId = 'الفرع المحدد غير صالح للاستلام داخل نطاق الخدمة.';
  }
  if (input.customerName.trim().length < 2) {
    errors.customerName = 'اسم العميل مطلوب ويجب ألا يقل عن حرفين.';
  }
  if (
    !/^\+20(10|11|12|15)\d{8}$/.test(
      normalizeEgyptianOrderPhone(input.customerPhone),
    )
  ) {
    errors.customerPhone = input.customerPhone.trim()
      ? 'رقم الموبايل غير صحيح.'
      : 'رقم الموبايل مطلوب.';
  }
  if (!input.addressLine.trim()) {
    errors.addressLine = 'العنوان النصي مطلوب.';
  } else if (input.addressLine.trim().length < 5) {
    errors.addressLine = 'العنوان النصي يجب ألا يقل عن 5 أحرف.';
  }
  if (
    !input.locationConfirmed ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    errors.location = 'يرجى تحديد موقع التسليم على الخريطة.';
  } else if (input.locationEligibility !== 'INSIDE') {
    errors.location = 'موقع التسليم خارج نطاق الخدمة.';
  }
  if (input.itemDescription.trim().length < 2) {
    errors.itemDescription = 'وصف الطلب مطلوب ويجب ألا يقل عن حرفين.';
  }
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 25) {
    errors.weightKg = 'أدخل وزناً صحيحاً من 0.1 إلى 25 كيلوجراماً.';
  }
  if (
    !Number.isInteger(packageCount) ||
    packageCount < 1 ||
    packageCount > 20
  ) {
    errors.packageCount = 'أدخل عدداً صحيحاً من 1 إلى 20 طرداً.';
  }
  if (
    !Number.isFinite(declaredValue) ||
    declaredValue < 0 ||
    declaredValue > 5_000
  ) {
    errors.declaredValue = 'أدخل قيمة معلنة صحيحة من 0 إلى 5000 جنيه.';
  }
  if (!input.prohibitedItemsConfirmed) {
    errors.prohibitedItemsConfirmed = 'يجب تأكيد خلو الطلب من المواد المحظورة.';
  }

  return {
    errors,
    firstInvalidField: fieldOrder.find((field) => errors[field]),
  };
}

export function buildQuoteRequestPayload(
  input: OrderFormInput,
): QuoteRequestPayload {
  const contactName = input.customerName.trim();
  const contactPhone = normalizeEgyptianOrderPhone(input.customerPhone);
  const street = optionalText(input.street);
  const buildingNumber = optionalText(input.buildingNumber);
  const floor = optionalText(input.floor);
  const apartment = optionalText(input.apartment);
  const landmark = optionalText(input.landmark);
  const courierNotes = optionalText(input.courierNotes);
  const sourceMapsUrl = optionalText(input.sourceMapsUrl);

  return {
    storeId: input.storeId,
    customer: {
      name: contactName,
      phone: contactPhone,
    },
    dropoff: {
      saveAddress: input.saveAddress,
      contactName,
      contactPhone,
      addressLine: input.addressLine.trim(),
      ...(street ? { street } : {}),
      ...(buildingNumber ? { buildingNumber } : {}),
      ...(floor ? { floor } : {}),
      ...(apartment ? { apartment } : {}),
      ...(landmark ? { landmark } : {}),
      area: input.serviceZoneName.trim(),
      city: input.serviceZoneCity.trim(),
      governorate: input.serviceZoneGovernorate.trim(),
      ...(courierNotes ? { deliveryNotes: courierNotes } : {}),
      ...(sourceMapsUrl ? { sourceMapsUrl } : {}),
      locationSource: input.locationSource,
      latitude: Number(input.latitude),
      longitude: Number(input.longitude),
    },
    package: {
      category: input.category,
      itemDescription: input.itemDescription.trim(),
      size: input.packageSize,
      weightGrams: Math.round(Number(input.weightKg) * 1_000),
      packageCount: Number(input.packageCount),
      fragile: input.fragile,
      requiresThermalBag: input.thermalBag,
      ...(courierNotes ? { courierNotes } : {}),
      declaredValueMinor: Math.round(Number(input.declaredValue) * 100),
      prohibitedItemsConfirmed: true,
    },
  };
}

type StructuredApiError = Error & {
  code?: string;
  fields?: Record<string, string>;
};

const backendFieldMap: Record<string, OrderFormField> = {
  addressLine: 'addressLine',
  declaredValue: 'declaredValue',
  'dropoff.addressLine': 'addressLine',
  'dropoff.contactName': 'customerName',
  'dropoff.contactPhone': 'customerPhone',
  'dropoff.latitude': 'location',
  'dropoff.longitude': 'location',
  itemDescription: 'itemDescription',
  location: 'location',
  'package.declaredValueMinor': 'declaredValue',
  'package.itemDescription': 'itemDescription',
  'package.packageCount': 'packageCount',
  'package.prohibitedItemsConfirmed': 'prohibitedItemsConfirmed',
  'package.weightGrams': 'weightKg',
  packageCount: 'packageCount',
  prohibitedItemsConfirmed: 'prohibitedItemsConfirmed',
  customerName: 'customerName',
  customerPhone: 'customerPhone',
  recipientName: 'customerName',
  recipientPhone: 'customerPhone',
  'customer.name': 'customerName',
  'customer.phone': 'customerPhone',
  storeId: 'storeId',
  weightKg: 'weightKg',
};

const localizedFieldErrors: Record<OrderFormField, string> = {
  addressLine: 'العنوان النصي غير صحيح.',
  declaredValue: 'القيمة المعلنة غير صحيحة.',
  itemDescription: 'وصف الطلب غير صحيح.',
  location: 'يرجى مراجعة موقع التسليم على الخريطة.',
  packageCount: 'عدد الطرود غير صحيح.',
  prohibitedItemsConfirmed: 'يجب تأكيد خلو الطلب من المواد المحظورة.',
  customerName: 'اسم العميل غير صحيح.',
  customerPhone: 'رقم الموبايل غير صحيح.',
  storeId: 'الفرع المحدد غير صالح.',
  weightKg: 'وزن الطلب غير صحيح.',
};

export function orderApiError(error: unknown): {
  errors: OrderFormErrors;
  summary: string;
} {
  const structured = error as StructuredApiError;
  const message = error instanceof Error ? error.message : '';
  const fields = structured?.fields ?? {};
  const errors: OrderFormErrors = {};

  for (const key of Object.keys(fields)) {
    const field = backendFieldMap[key];
    if (field && !errors[field]) errors[field] = localizedFieldErrors[field];
  }

  if (
    structured?.code === 'order_outside_service_zone' ||
    /both be inside an active service zone|outside.*service zone/iu.test(
      message,
    )
  ) {
    errors.location = 'موقع التسليم خارج نطاق الخدمة.';
    return { errors, summary: errors.location };
  }
  if (structured?.code === 'order_pickup_delivery_zone_mismatch') {
    errors.location =
      'فرع الاستلام وموقع التسليم غير مشمولين داخل منطقة خدمة واحدة.';
    return { errors, summary: errors.location };
  }
  if (structured?.code === 'order_service_zone_pricing_unavailable') {
    errors.location =
      'منطقة الخدمة المحددة لا تحتوي على قاعدة تسعير نشطة حالياً.';
    return { errors, summary: errors.location };
  }
  if (
    structured?.code === 'order_route_distance_exceeded' ||
    /route exceeds|supported distance|maximum route/iu.test(message)
  ) {
    errors.location = 'المسافة الفعلية للطلب تتجاوز الحد الأقصى المسموح.';
    return { errors, summary: errors.location };
  }
  if (
    structured?.code === 'order_route_calculation_failed' ||
    /route coordinates|calculate.*route|routing/iu.test(message)
  ) {
    errors.location = 'تعذر حساب المسافة، حاول تحديد الموقع مرة أخرى.';
    return { errors, summary: errors.location };
  }
  if (
    structured?.code === 'order_invalid_store' ||
    /store.*not found|invalid store/iu.test(message)
  ) {
    errors.storeId = 'الفرع المحدد غير صالح.';
    return { errors, summary: errors.storeId };
  }
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed/iu.test(message)
  ) {
    return {
      errors,
      summary: 'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مرة أخرى.',
    };
  }

  const summary =
    Object.keys(errors).length > 0 ||
    structured?.code === 'validation_failed' ||
    /request data is invalid/iu.test(message)
      ? 'تعذر إنشاء الطلب بسبب بيانات غير صحيحة. راجع الحقول الموضحة.'
      : /[\u0600-\u06ff]/u.test(message)
        ? message
        : 'تعذر حساب سعر التوصيل. راجع البيانات والموقع ثم حاول مرة أخرى.';
  return { errors, summary };
}
