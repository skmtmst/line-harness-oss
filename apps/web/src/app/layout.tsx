import type { Metadata, Viewport } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: 'L Harness',
  description: 'L Harness 管理画面',
  applicationName: 'L Harness',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'L Harness',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#06C755',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
