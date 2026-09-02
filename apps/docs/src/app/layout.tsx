import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'musubo マニュアル',
    template: '%s | musubo マニュアル',
  },
  description: 'musuboをご利用いただくための公開マニュアルです。',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <p>musubo Manual</p>
          <p>必要な操作を、迷わず進めるためのガイドです。</p>
        </footer>
      </body>
    </html>
  );
}
