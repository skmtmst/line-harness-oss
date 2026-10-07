'use client'

import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import NotFoundV8 from '@/v8/not-found/not-found'

/**
 * 見つからない画面（★V7 修正方針 §2 `pGlZ4`）。
 *
 * 以前は Next.js 標準の英語の画面（"This page could not be found."）だった。
 * 何が起きたかと、戻り先を1つだけ出す。画面名（h1）は上部バーが持つので、ここは h2。
 */
export default function NotFound() {
  usePageTitle('ページが見つかりません')
  // ★V8（板 Nx5dz）。v7 は今のまま（本番の切り替えまで）。
  const theme = useAdminTheme()
  if (theme === 'v8') return <NotFoundV8 />
  return (
    <section className="mx-auto flex max-w-xl flex-col gap-3 px-6 py-16">
      <h2 className="text-title font-bold text-ink">このページは見つかりませんでした</h2>
      <p className="text-body text-ink-secondary">URL が変わったか、削除された可能性があります。</p>
      <div className="mt-2">
        <Button href="/" variant="primary">ダッシュボードへ戻る</Button>
      </div>
    </section>
  )
}
