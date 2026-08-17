import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'
import BrandTitle from '@/components/brand-title'

/**
 * 書き出しの時点で決まる題。
 *
 * 実際にタブへ出るのは公式アカウントの表示名で、読み込んだあとに
 * BrandTitle が差し替える。ここはそれが取れるまでの間と、取れなかった
 * ときの名前。以前は末尾に「TEST」を足して本番と見分けていたが、
 * 名前そのものを変えると利用者にもテスト用に見える。
 */
const DEFAULT_TITLE = '然-NEN- LINE管理システム'

export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  description: DEFAULT_TITLE,
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_TITLE,
    type: 'website',
    locale: 'ja_JP',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        <BrandTitle />
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
