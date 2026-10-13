'use client'

import { useEffect, useState } from 'react'
import { Bookmark } from 'lucide-react'
import HelpTip from '@/components/shared/help-tip'
import type { Tag } from '@line-crm/shared'
import { api, type FriendSavedView } from '@/lib/api'
import { EntityPickerDialog } from '@/components/shared/entity-picker'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import type { AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
import {
  conditionsToEditorState,
  describeSavedVisibility,
  savedSearchParams,
  savedSearchSummary,
} from '@/components/friends/saved-search-utils'
import { formatNumber } from '@/lib/format'

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

  const apply = (id: string) => {
    const search = saved.find((item) => item.id === id)
    if (!search) return
    const summary = savedSearchSummary(search.conditions, tags)
    onApply({ params: savedSearchParams(search.id, search.conditions), summary: [`対象：${describeSavedVisibility(search.conditions)}`, ...summary], editorState: conditionsToEditorState(search.conditions) })
  }
  const state = loading ? <p role="status">読み込み中…</p> : error ? <Notice tone="info" action={<Button onClick={() => setReloadKey((key) => key + 1)}>再読み込み</Button>}>{error}</Notice>
    : saved.length === 0 ? <div><p>保存した条件はまだありません。</p><p>「詳細条件」で絞り込みを組み、条件を保存すると次回からここで呼び出せます。</p><Button onClick={onOpenAdvanced}>詳細条件を設定</Button></div> : undefined
  return <EntityPickerDialog key={accountId ?? ''} title="保存した検索" designNode="CYJ0L" description="条件を選び、中身を確かめて一覧へ適用します。" confirmLabel="この条件で表示"
    items={saved.map((search) => ({ id: search.id, name: search.name, meta: `${search.match.total === null ? search.match.error ?? '人数を確認できません' : `${formatNumber(search.match.total)}人`} ／ ${search.isShared ? '全員' : '自分だけ'} ／ 対象：${describeSavedVisibility(search.conditions)}`, keywords: savedSearchSummary(search.conditions, tags).join(' ') }))}
    state={state} onCancel={onClose} onConfirm={apply}
    preview={(item) => { const search = saved.find((row) => row.id === item?.id); return search ? <SavedSearchItem search={search} tags={tags} /> : null }} />
}

const SUMMARY_PREVIEW_LINES = 3

function SavedSearchItem({
  search,
  tags,
}: {
  search: FriendSavedView
  tags: Tag[]
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = savedSearchSummary(search.conditions, tags)
  const shown = expanded ? summary : summary.slice(0, SUMMARY_PREVIEW_LINES)
  const hiddenCount = summary.length - shown.length

  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-divider-soft py-4">
      <Bookmark aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-start gap-2">
        <span
          title={search.name}
          className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
        >
          {search.name}
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
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-semibold text-ink">
          {search.match.total === null ? search.match.error ?? '人数を確認できません' : `${formatNumber(search.match.total)}人`}
        </span>
        <span className="shrink-0 rounded-pill bg-canvas px-2 py-0.5 text-xs font-medium text-ink-faint">
          {search.isShared ? '全員' : '自分だけ'}
        </span>
        <HelpTip label="共有範囲の説明">「全員」は担当者みんなに見えます。「自分だけ」は保存した本人だけに見えます。</HelpTip>
      </div>
    </div>
  )
}
