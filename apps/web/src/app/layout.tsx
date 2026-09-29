import type { Metadata } from 'next'
import { Inter, Noto_Sans_JP } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/app-shell'
import BrandTitle from '@/components/brand-title'
import ClientErrorReporter from '@/components/client-error-reporter'
import ToastHost from '@/components/shared/toast'

/**
 * 書き出しの時点で決まる題。
 *
 * 実際にタブへ出るのは公式アカウントの表示名で、読み込んだあとに
 * BrandTitle が差し替える。ここはそれが取れるまでの間と、取れなかった
 * ときの名前。以前は末尾に「TEST」を足して本番と見分けていたが、
 * 名前そのものを変えると利用者にもテスト用に見える。
 */
const DEFAULT_TITLE = '然-NEN- LINE管理システム'

/*
 * ★V7 の書体。英字と数字は Inter、かなと漢字は Noto Sans JP に見える
 * （--font-sans の並びが正本。Inter に日本語グリフが無いので、かなと漢字は
 * 自動で Noto Sans JP に落ちる）。
 *
 * next/font でビルド時にフォントを同梱するので、実行時に Google への
 * 通信は起きない。Noto Sans JP は unicode-range で分割されているため、
 * preload は欧文の Inter だけにする（全幅面の先読みは帯域の無駄）。
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const notoSansJp = Noto_Sans_JP({
  variable: '--font-noto-sans-jp',
  display: 'swap',
  preload: false,
})

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
    <html lang="ja" className={`${inter.variable} ${notoSansJp.variable}`}>
      {/* 書体は globals.css の --font-sans が正本（#976 U080）。inline style はやめる。 */}
      <body className="bg-canvas-sunken text-ink antialiased font-sans">
        <ClientErrorReporter />
        <BrandTitle />
        <AppShell>
          {children}
        </AppShell>
        {/* 保存の知らせ（Toast）の置き場所。全画面で1つ。画面側は置かない。 */}
        <ToastHost />
      </body>
    </html>
  )
}
