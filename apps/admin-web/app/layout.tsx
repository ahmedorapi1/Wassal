import '@wasel/ui/styles.css';
import './styles.css';

import { defaultLocale, directionFor } from '@wasel/localization';
import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';

export const metadata: Metadata = {
  title: 'SKKA | إدارة العمليات',
  description: 'إدارة طلبات التوصيل ومناطق الخدمة والتسعير والتحقق في سِكّة.',
  icons: {
    icon: '/brand/skka-logo.png',
    apple: '/brand/skka-logo.png',
  },
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang={defaultLocale} dir={directionFor(defaultLocale)}>
      <body>{children}</body>
    </html>
  );
}
