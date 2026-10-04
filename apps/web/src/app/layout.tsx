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
 *
 * ここは製品の名前を出す場所なので musubo と書く。契約先の名前は公式
 * アカウントから取れたものだけを出す。
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
    <html lang="ja" data-theme={ADMIN_THEME} className={`${inter.variable} ${notoSansJp.variable}`}>
      {/* 書体は globals.css の --font-sans が正本（#976 U080）。inline style はやめる。 */}
      <body className="bg-canvas-sunken text-ink antialiased font-sans">
        {/* localStorage のテーマ指定を描画前に反映する（白い板のちらつき防止） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
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
