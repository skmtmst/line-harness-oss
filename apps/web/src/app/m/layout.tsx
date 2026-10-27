import type { Metadata, Viewport } from 'next'

/*
 * 電話の専用の画面（/m）。ホーム画面に置けるよう manifest をここだけで出す（PC の画面では勧めない）。
 * 端末の安全域（ノッチ・下のバー）まで描けるよう viewport-fit=cover にする。
 */
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'musubo', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return children
}
