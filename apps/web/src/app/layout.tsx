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
 * ★V8 移行②: テーマの切り替え。
 *
 * `<html data-theme="v7|v8">` が globals.css の `[data-theme="v8"]` の
 * 値を効かせるスイッチ。既定は v7（値は何も書かなくても :root のもの）。
 *
 *   環境変数 NEXT_PUBLIC_ADMIN_THEME=v8 … その環境（検証環境）の既定を v8 に
 *   localStorage lh-admin-theme        … 担当者が設定画面の「画面の見た目
 *                                         （試作）」でこのブラウザだけ切り替える
 *
 * localStorage は書き出しの時点では読めないので、描画が始まる前に
 * 下の短いスクリプトで `<html>` の data-theme を差し替える。
 */
const ADMIN_THEME = process.env.NEXT_PUBLIC_ADMIN_THEME === 'v8' ? 'v8' : 'v7'
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('lh-admin-theme');if(t==='v7'||t==='v8'){document.documentElement.dataset.theme=t}}catch(e){}})()`

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
    // 描く前の短いスクリプトが data-theme を v8 へ差し替えるので、html の属性だけは食い違いの警告を出さない（開発時の「1 Issue」）。
    <html lang="ja" data-theme={ADMIN_THEME} className={`${inter.variable} ${notoSansJp.variable}`} suppressHydrationWarning>
      {/* 書体は globals.css の --font-sans が正本（#976 U080）。inline style はやめる。 */}
      <body className="bg-canvas-sunken text-ink antialiased font-sans">
        {/* localStorage のテーマ指定を描画前に反映する（白い板のちらつき防止） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
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
