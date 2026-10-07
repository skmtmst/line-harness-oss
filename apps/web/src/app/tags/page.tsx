'use client'

import { Suspense } from 'react'
import TagsPageV4 from '@/components/friend-fields/tags-page-v4'
import TagsListV8 from '@/v8/tags/list'
import { useAccount } from '@/contexts/account-context'
import { useAdminTheme } from '@/lib/use-admin-theme'

/**
 * 友だち属性（4タブ）の入口。
 *
 * 見た目テーマが v8 のときだけ新しい一覧（`src/v8/tags/list.tsx`）を出す。
 * タグ以外のタブの本文（友だち情報欄・対応マーク・保存した検索）は今の V8 のものを渡す。
 * v7 では従来どおり `tags-page-v4.tsx`（見た目は1画素も変えない）。
 *
 * #972 U029: 390pxではタブ行と右端の「CSVで一括登録」が重なっていた。
 * 共通タブ（components/shared/tabs）は触らず、この画面の印の下にある
 * タブ行だけを「収まらないとき折り返す」に変える。広い画面では
 * 1行に収まるので見た目は変わらない。
 */
export default function TagsPage() {
  const { selectedAccountId } = useAccount()
  const theme = useAdminTheme()
  return (
    <div data-tabs-row>
      <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}>
        {theme === 'v8' ? (
          <TagsListV8
            accountId={selectedAccountId}
          />
        ) : (
          <TagsPageV4 accountId={selectedAccountId} />
        )}
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
