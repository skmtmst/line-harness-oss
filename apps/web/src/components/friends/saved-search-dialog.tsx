'use client'

import { useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, type FriendSavedView } from '@/lib/api'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Button from '@/components/shared/button'
import type { AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import { savedSearchParams, savedSearchSummary } from '@/components/friends/saved-search-utils'

/**
 * 「保存した検索」の呼び出し窓（N-039）。
 *
 * 共通overlay規約（components/shared/overlay-utils）に合わせる：
 * Escで閉じる・開いたら中の最初の押し口へフォーカス・Tabは窓の中で
 * 回す・閉じたら開く前の場所へフォーカスを戻す・背景のスクロールは止める。
 */
export default function SavedSearchDialog({
  accountId,
  tags,
  onClose,
  onApply,
  onOpenAdvanced,
}: {
  accountId: string | null
  tags: Tag[]
  onClose: () => void
  onApply: (result: AdvancedSearchResult) => void
  onOpenAdvanced: () => void
}) {
  const panelRef = useOverlayFocus(true, onClose)
  const [saved, setSaved] = useState<FriendSavedView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    if (!accountId) {
      setSaved([])
      setLoading(false)
      return
    }
    void api.friendSavedViews.list(accountId, { suppressFeatureDisabledEvent: true }).then((res) => {
      if (!cancelled && res.success) setSaved(res.data.items)
    }).catch(() => {
      if (!cancelled) setError('保存した検索を読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [accountId])

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-ink/35 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-search-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-panel border border-hairline bg-canvas p-5 shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="saved-search-title" className="text-lg font-bold text-ink">保存した検索</h2>
        {loading ? <p className="mt-4 text-sm text-ink-faint">読み込み中…</p> : null}
        {error ? <p className="mt-4 rounded-control bg-status-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        {!loading && saved.length > 0 ? (
          <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
            {saved.map((search) => {
              const summary = savedSearchSummary(search.conditions, tags)
              return (
                <button
                  key={search.id}
                  type="button"
                  onClick={() => onApply({ params: savedSearchParams(search.id, search.conditions), summary })}
                  className="w-full rounded-card border border-divider-soft bg-surface-pearl p-4 text-left hover:border-accent"
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-ink">
                    {search.name}
                    <span className="rounded-pill bg-canvas px-2 py-0.5 text-xs font-medium text-ink-faint">{search.isShared ? '全員' : '自分だけ'}</span>
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-ink-secondary">{summary.slice(0, 3).join(' ／ ') || '条件を確認してください'}</span>
                  <span className="mt-1 block text-xs font-semibold text-accent">
                    {search.match.total === null ? search.match.error ?? '人数を確認できません' : `${search.match.total.toLocaleString('ja-JP')}人`}
                  </span>
                </button>
              )
            })}
          </div>
        ) : !loading ? (
          <div className="mt-4 rounded-card border border-hairline bg-surface-pearl p-4">
            <p className="text-sm font-semibold text-ink-secondary">保存した条件はまだありません。</p>
            <p className="mt-1 text-xs leading-5 text-ink-faint">「詳細条件」で絞り込みを組み、条件を保存すると次回からここで呼び出せます。</p>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button onClick={onClose}>閉じる</Button>
          {saved.length === 0 ? (
            <Button variant="primary" onClick={onOpenAdvanced}>詳細条件を設定</Button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
