import '@wasel/ui/styles.css';
import './styles.css';

import { defaultLocale, directionFor } from '@wasel/localization';
import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';

export const metadata: Metadata = {
  title: 'واصل | التجار',
  description: 'إدارة ملف التاجر والفروع وفريق العمل في منصة واصل.',
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang={defaultLocale} dir={directionFor(defaultLocale)}>
      <body>{children}</body>
    </html>
  );
}
