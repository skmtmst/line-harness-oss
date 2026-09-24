'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Tag } from '@line-crm/shared'
import { api, type FriendSavedView } from '@/lib/api'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Button from '@/components/shared/button'
import type { AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import {
  conditionsToEditorState,
  describeSavedVisibility,
  savedSearchParams,
  savedSearchSummary,
} from '@/components/friends/saved-search-utils'

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
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    /*
     * FRIEND-19: 前のアカウントの候補を残さない。切替・再読込のたびに
     * 一覧を空にし、現在アカウントの成功応答だけが候補を並べる。
     * Aの応答がBの取得中に遅れて届いても、cancelled で捨てる。
     */
    setSaved([])
    if (!accountId) {
      setLoading(false)
      return
    }
    void api.friendSavedViews.list(accountId, { suppressFeatureDisabledEvent: true }).then((res) => {
      if (cancelled) return
      if (res.success) {
        setSaved(res.data.items)
      } else {
        /* FRIEND-18: 失敗は「保存なし」と混ぜない。 */
        setError(res.error || '保存した検索を読み込めませんでした')
      }
    }).catch(() => {
      if (!cancelled) setError('保存した検索を読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [accountId, reloadKey])

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
        /*
         * FRIEND-30: 低い画面・ブラウザー200%でもタイトル・閉じる・適用へ
         * 到達できるよう、パネル全体を画面内に収めて候補領域だけ縦に伸縮する。
         */
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-panel border border-hairline bg-canvas shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
          <h2 id="saved-search-title" className="text-lg font-bold text-ink">保存した検索</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">
        {loading ? <p className="mt-4 text-sm text-ink-faint">読み込み中…</p> : null}
        {error ? (
          <div className="mt-4 rounded-control bg-status-danger-soft p-3 text-sm text-danger">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-2 font-semibold text-action underline"
            >
              再読み込み
            </button>
          </div>
        ) : null}
        {!loading && !error && saved.length > 0 ? (
          <div className="mt-4 space-y-2">
            {saved.map((search) => (
              <SavedSearchItem
                key={search.id}
                search={search}
                tags={tags}
                onApply={onApply}
              />
            ))}
          </div>
        ) : null}
        {!loading && !error && saved.length === 0 ? (
          <div className="mt-4 rounded-card border border-hairline bg-surface-pearl p-4">
            <p className="text-sm font-semibold text-ink-secondary">保存した条件はまだありません。</p>
            <p className="mt-1 text-xs leading-5 text-ink-faint">「詳細条件」で絞り込みを組み、条件を保存すると次回からここで呼び出せます。</p>
          </div>
        ) : null}
        </div>
        {!loading && !error && saved.length === 0 ? (
          <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-divider-soft px-5 py-4">
            <Button variant="primary" onClick={onOpenAdvanced}>詳細条件を設定</Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

const SUMMARY_PREVIEW_LINES = 3

function SavedSearchItem({
  search,
  tags,
  onApply,
}: {
  search: FriendSavedView
  tags: Tag[]
  onApply: (result: AdvancedSearchResult) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = savedSearchSummary(search.conditions, tags)
  const shown = expanded ? summary : summary.slice(0, SUMMARY_PREVIEW_LINES)
  const hiddenCount = summary.length - shown.length

  return (
    <div className="rounded-card border border-divider-soft bg-surface-pearl p-4">
      {/*
        FRIEND-29: 区切りのない長い名前でも共有範囲のバッジを押し出さない。
        名前は最大2行で折り返し、全文は title と展開で確認できる。
      */}
      <div className="flex min-w-0 items-start gap-2">
        <span
          title={search.name}
          className="min-w-0 flex-1 text-sm font-bold text-ink line-clamp-2 wrap-anywhere"
        >
          {search.name}
        </span>
        <span className="shrink-0 rounded-pill bg-canvas px-2 py-0.5 text-xs font-medium text-ink-faint">
          {search.isShared ? '全員' : '自分だけ'}
        </span>
      </div>
      {/* FRIEND-20: 対象（表示中/非表示/すべて）は常に出す。 */}
      <p className="mt-2 text-xs font-semibold text-ink-secondary">
        対象：{describeSavedVisibility(search.conditions)}
      </p>
      <div className="mt-1 text-xs leading-5 text-ink-secondary">
        {shown.length ? shown.join(' ／ ') : '条件を確認してください'}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="mt-1 text-xs font-semibold text-action hover:underline"
        >
          ほか{hiddenCount}件の条件を表示
        </button>
      ) : null}
      {expanded && summary.length > SUMMARY_PREVIEW_LINES ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="mt-1 text-xs font-semibold text-action hover:underline"
        >
          条件を折りたたむ
        </button>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">
          {search.match.total === null ? search.match.error ?? '人数を確認できません' : `${search.match.total.toLocaleString('ja-JP')}人`}
        </span>
        <Button
          variant="primary"
          onClick={() => onApply({
            params: savedSearchParams(search.id, search.conditions),
            summary: [`対象：${describeSavedVisibility(search.conditions)}`, ...summary],
            editorState: conditionsToEditorState(search.conditions),
          })}
        >
          この条件で表示
        </Button>
      </div>
    </div>
  )
}
