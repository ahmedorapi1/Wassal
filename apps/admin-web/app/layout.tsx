import '@wasel/ui/styles.css';
import './styles.css';

import { defaultLocale, directionFor } from '@wasel/localization';
import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';

export const metadata: Metadata = {
  title: 'واصل | الإدارة',
  description: 'مراجعة المندوبين وإدارة التحقق في منصة واصل.',
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang={defaultLocale} dir={directionFor(defaultLocale)}>
      <body>{children}</body>
    </html>
  );
}
