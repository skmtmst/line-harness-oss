'use client'

import { Suspense } from 'react'
import TagsPageV4 from '@/components/friend-fields/tags-page-v4'
import { useAccount } from '@/contexts/account-context'

/**
 * 友だち属性（4タブ）の入口。中身は `tags-page-v4.tsx` が正本。
 * ここは選んだアカウントを渡すだけにする。
 *
 * #972 U029: 390pxではタブ行と右端の「CSVで一括登録」が重なっていた。
 * 共通タブ（components/shared/tabs）は触らず、この画面の印の下にある
 * タブ行だけを「収まらないとき折り返す」に変える。広い画面では
 * 1行に収まるので見た目は変わらない。
 */
export default function TagsPage() {
  const { selectedAccountId } = useAccount()
  return (
    <div data-tabs-row>
      <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
        <TagsPageV4 accountId={selectedAccountId} />
      </Suspense>
      <style>{`
        /* タブ行（nav > span.items + span.actions）。収まる幅では1行のまま。 */
        [data-tabs-row] nav:has(> span) { height: auto; flex-wrap: wrap; row-gap: 8px; }
        [data-tabs-row] nav:has(> span) > span { flex-wrap: wrap; row-gap: 0; }
        [data-tabs-row] nav:has(> span) > span + span { margin-left: auto; }
      `}</style>
    </div>
  )
}
