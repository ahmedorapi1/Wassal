export const defaultLocale = 'ar-EG' as const;
export const supportedLocales = ['ar-EG', 'en'] as const;

export type Locale = (typeof supportedLocales)[number];

const arabic = {
  brand: 'واصل',
  phase: 'المرحلة التأسيسية',
  status: 'البنية الأساسية جاهزة للتطوير',
  description: 'منصة توصيل عند الطلب تربط المتاجر بمندوبي التوصيل في مصر.',
  apiHealthy: 'الخدمة تعمل',
} as const;

export type MessageKey = keyof typeof arabic;

const messages: Record<Locale, Record<MessageKey, string>> = {
  'ar-EG': arabic,
  en: {
    brand: 'Wasel',
    phase: 'Foundation phase',
    status: 'The foundation is ready for development',
    description:
      'An on-demand delivery platform connecting Egyptian stores and couriers.',
    apiHealthy: 'Service is healthy',
  },
};

export function directionFor(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar-EG' ? 'rtl' : 'ltr';
}

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
