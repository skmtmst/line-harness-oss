import type { Metadata } from 'next'
import { Inter, Noto_Sans_JP } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/app-shell'
import ClientErrorReporter from '@/components/client-error-reporter'
import ToastHost from '@/components/shared/toast'

/**
 * 書き出しの時点で決まる題。
 *
 * 描いたあとは上の帯（app-top-bar）と usePageTitle が「<画面名> | musubo」に
 * 差し替える（lib/document-title.ts）。ここはそれまでの間の名前。
 * 製品の名前を出す場所なので musubo と書く（LINE Harness は出さない）。
 */
const DEFAULT_TITLE = 'musubo LINE管理システム'

/*
 * 見た目は常に V8（2026-10-09 オーナー決定）。`<html data-theme="v8">` が
 * globals.css の `[data-theme="v8"]` の値を効かせる。環境変数・このブラウザに
 * 保存した選択・設定画面の切り替えはもう無い（最初の描画から v8。v7 が一瞬出ない）。
 */
/*
 * 管理画面の書体。英字と数字は Inter、かなと漢字は Noto Sans JP に見える
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
  icons: {
    icon: '/icon.svg',
  },
  // 管理画面は検索に出さない（public/robots.txt・_headers の X-Robots-Tag と同じ）。
  robots: { index: false, follow: false },
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
    <html lang="ja" data-theme="v8" className={`${inter.variable} ${notoSansJp.variable}`}>
      {/* 書体は globals.css の --font-sans が正本（#976 U080）。inline style はやめる。 */}
      <body className="bg-canvas-sunken text-ink antialiased font-sans">
        <ClientErrorReporter />
        <AppShell>
          {children}
        </AppShell>
        {/* 保存の知らせ（Toast）の置き場所。全画面で1つ。画面側は置かない。 */}
        <ToastHost />
      </body>
    </html>
  )
}
