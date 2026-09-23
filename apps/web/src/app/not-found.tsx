'use client'

import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * 見つからない画面（★V7 修正方針 §2 `pGlZ4`）。
 *
 * 以前は Next.js 標準の英語の画面（"This page could not be found."）だった。
 * 何が起きたかと、戻り先を1つだけ出す。画面名（h1）は上部バーが持つので、ここは h2。
 */
export default function NotFound() {
  usePageTitle('ページが見つかりません')
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
