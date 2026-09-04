'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { GripVertical, LockKeyhole, Trash2 } from 'lucide-react'
import type { FriendField, FriendFieldListSummary, FriendFieldType } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import { Th } from '@/components/shared/table'

export const FIELD_TYPE_HINTS: Record<FriendFieldType, string> = {
  text: '短いテキスト', textarea: '長い文章', number: '体重など', date: '誕生日など',
  select: '決まった選択肢から選ぶ', multi_select: '決まった選択肢から複数選ぶ',
  checkbox: 'はい / いいえ', url: 'リンク', tel: '電話番号', email: 'メールアドレス',
}

export const FIELD_TYPE_LABELS: Record<FriendFieldType, string> = {
  text: '1行テキスト', textarea: '複数行テキスト', number: '数値', date: '日付',
  select: '単一選択', multi_select: '複数選択', checkbox: '真偽', url: 'URL',
  tel: '電話番号', email: 'メール',
}

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

function destinationLabel(field: FriendField): string {
  const places = ['友だち詳細', 'テンプレート差し込み']
  if (field.isStarred) places.push('友だち一覧')
  if (field.ecIsMaster) places.push('EC連携')
  return places.join('・')
}

function knownUsageCount(field: FriendField): number | null {
  return typeof field.usageCount === 'number' && Number.isFinite(field.usageCount) && field.usageCount >= 0
    ? field.usageCount
    : null
}

function fieldDeletionBlockedReason(field: FriendField): string | null {
  const usageCount = knownUsageCount(field)
  if (usageCount === null) return '使用人数を確認できないため削除できません。再読み込みしてください。'
  if (usageCount > 0) return '値が入っているため、先に項目を移行してください'
  return null
}

/** ★V6 `HBTk0` 友だち情報欄一覧。 */
export default function FriendFieldList({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<FriendField[]>([])
  const [summary, setSummary] = useState<FriendFieldListSummary | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | FriendFieldType>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FriendField | null>(null)

  const load = useCallback(async () => {
    if (!accountId) {
      setItems([]); setSummary(null); setStatus('error'); setError('LINE公式アカウントを選んでください')
      return
    }
    setStatus('loading'); setError('')
    try {
      const [list, stats] = await Promise.all([
        api.friendFields.list(accountId, { withUsage: true }), api.friendFields.stats(accountId),
      ])
      if (!list.success || !stats.success) throw new Error('load failed')
      setItems(list.data); setSummary(stats.data); setStatus('ready')
    } catch (reason) {
      const forbidden = reason instanceof ApiError && reason.status === 403
      setItems([])
      setStatus(forbidden ? 'forbidden' : 'error')
      setSummary(null)
      setError(forbidden ? '' : '再読み込みしても直らない場合はエラー報告へ。')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => items.filter((field) => {
    if (query && !field.name.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja'))) return false
    if (type !== 'all' && field.type !== type) return false
    return true
  }), [items, query, type])

  const move = async (targetId: string) => {
    if (!accountId || !dragId || dragId === targetId) return setDragId(null)
    const order = visible.map((field) => field.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const next = order.map((id) => items.find((field) => field.id === id)).filter(Boolean) as FriendField[]
    setItems(next)
    try {
      await Promise.all(next.filter((field) => !field.isInherited).map((field, index) => api.friendFields.update(field.id, accountId, { displayOrder: index })))
      await load()
    } catch {
      setError('並び順を保存できませんでした'); await load()
    }
  }

  const remove = async (field: FriendField) => {
    if (!accountId) return
    const blockedReason = fieldDeletionBlockedReason(field)
    if (blockedReason) {
      setError(blockedReason)
      return
    }
    setError('')
    try { await api.friendFields.delete(field.id, accountId); await load() }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : '削除できませんでした') }
  }

  /*
    **数が出せないときは、なぜ出せないのかを添える。**

    以前は `summary` が無いと 1枚目の補足が空文字になり、残る3枚は
    「1項目以上を登録」「追加・編集」という**数え方の説明のまま**だった。
    そのため読込中も取得失敗も、画面には `—` と数え方の説明が並ぶだけで、
    **待てば出るのか、壊れているのか、まだ無いのかが区別できなかった。**

    言葉は共通部品（`components/shared/not-connected.tsx`）に決めてある
    ものを使う。画面ごとに言い方を作らない。
  */
  /*
    **権限不足は `status` で見る。**
    もとの直しは `status === 'error'` の中で `error === ''` を権限不足の
    しるしにしていたが、403 は `setStatus('forbidden')` へ行く（この下の
    `load`）ので、その枝には**一度も入らなかった**。実際、403 を返して
    開くと帯は「1項目以上を登録」「追加・編集」という数え方の説明のままで、
    **見る権限が無いのか、まだ数が来ていないのかが区別できなかった。**
  */
  const kpiReason = status === 'loading' ? STATE_TEXT.loading
    : status === 'forbidden' ? STATE_TEXT.forbiddenView
      : status === 'error' ? STATE_TEXT.error
        : null
  /** 数が出せるときの補足（数え方の説明）と、出せないときの理由を切り替える。 */
  const detailOf = (whenAvailable: string): string => kpiReason ?? whenAvailable

  const cards = [
    /*
      **`undefined` を画面に出さない。**
      `summary` があるかどうかだけ見ていたので、器はあるが `inUse` が
      入っていないとき「使用中 undefined件」と出ていた。
      型は `inUse: number` だが、返事が形どおりとは限らない。
      値が無いなら数を語らず、取れていないことを言う。

      **読込中・失敗・権限不足のほうが先。** 数え方の説明を出す前に
      `detailOf` で状態の理由へ差し替える。器が来ているのに `inUse` だけ
      入っていない場合だけ「使用中の数は取得できません」を出す。
    */
    {
      title: '項目数',
      value: summary?.total ?? null,
      unit: '件',
      detail: detailOf(typeof summary?.inUse === 'number' ? `使用中 ${summary.inUse}件` : '使用中の数は取得できません'),
    },
    { title: '登録済み友だち', value: summary?.registeredFriends ?? null, unit: '人', detail: detailOf('1項目以上を登録') },
    {
      title: 'フォーム連携',
      value: summary?.formLinks ?? null,
      unit: summary?.formLinks === null ? '' : '件',
      // 口そのものが無いときは、読込・失敗とは別の言葉にする。
      detail: kpiReason ?? (summary?.formLinks === null ? notConnectedText('回答フォームの登録先') : '回答の登録先'),
    },
    { title: '今月の更新', value: summary?.updatedThisMonth ?? null, unit: '件', detail: detailOf('追加・編集') },
  ]

  return (
    <div data-design-node="HBTk0">
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map((card) => <SummaryCard key={card.title} {...card} loading={status === 'loading'} variant="v6" />)}</div>
      <NoteBar className="mb-4">既定値は友だち情報が空欄のときの送信値です。種類は新規登録後に変更せず、回答フォーム・友だち詳細・変数挿入で同じ定義を使います。</NoteBar>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="項目名で検索" aria-label="項目名で検索" className="h-9 w-[150px] rounded-control border border-hairline bg-canvas px-3 text-label outline-none focus:border-accent" />
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="v6-select h-9 w-[150px] rounded-control border border-hairline bg-canvas px-3 text-label font-semibold text-ink" aria-label="項目の種類">
          <option value="all">種類：すべて</option>
          {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className="flex-1" />
        {status === 'ready' ? <Button href="/tags/fields/new" variant="primary">＋ 項目を追加</Button> : null}
      </div>

      {status === 'ready' && error ? <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}

      <div className="overflow-hidden rounded-card border border-hairline bg-canvas [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-hairline bg-canvas-sunken text-caption text-ink-faint"><tr>
            <Th className="w-14 px-3 py-3">順番</Th><Th className="w-[18%] px-3 py-3">項目名</Th><Th className="w-[13%] px-3 py-3">種類</Th><Th className="w-[10%] px-3 py-3">使用中</Th><Th className="w-[14%] px-3 py-3">回答フォーム</Th><Th className="px-3 py-3">表示先</Th><Th className="w-24 px-3 py-3">操作</Th>
          </tr></thead>
          <tbody className="divide-y divide-hairline">
            {status === 'loading' ? <tr><td colSpan={7} className="p-0"><ListState kind="loading" /></td></tr>
              : status === 'forbidden' ? <tr><td colSpan={7} className="p-0"><ListState kind="forbidden" description="友だち情報欄を見る権限がありません。オーナーか管理者に確認してください。" /></td></tr>
              : status === 'error' ? <tr><td colSpan={7} className="p-0"><ListState kind="error" description={error || '友だち情報欄を読み込めませんでした。'} onRetry={() => void load()} /></td></tr>
              : items.length === 0 ? <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="まだ友だち情報欄がありません" description="「＋ 項目を追加」から最初の項目を作ってください。" /></td></tr>
              : visible.length === 0 ? <tr><td colSpan={7} className="p-0"><ListState kind="empty" title="条件に合う項目はありません" description="項目名か種類を変えてください。" /></td></tr>
              : visible.map((field) => <tr key={field.id} className="hover:bg-canvas-sunken">
                  <td draggable={!field.isInherited} onDragStart={() => setDragId(field.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void move(field.id)} className={`${field.isInherited ? 'cursor-not-allowed' : 'cursor-grab'} px-3 py-3 text-hairline`} title={field.isInherited ? '共通項目は移行後に並び替えできます' : 'ドラッグして並び替え'}><GripVertical size={16} aria-hidden="true" /></td>
                  <td className="px-3 py-3"><p className="truncate font-semibold text-accent" title={field.name}>{field.name}</p><p className="truncate font-mono text-caption text-ink-faint" title={`{{field.${field.fieldKey}}}`}>{`{{field.${field.fieldKey}}}`}</p></td>
                  <td className="px-3 py-3 text-ink">{FIELD_TYPE_LABELS[field.type] ?? field.type}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{knownUsageCount(field) ?? '—'}{knownUsageCount(field) === null ? '' : '人'}</td>
                  <td className="px-3 py-3 text-ink-faint" title="回答フォームにアカウント所属が付くまで件数は出しません">—</td>
                  <td className="truncate px-3 py-3 text-ink" title={destinationLabel(field)}>{destinationLabel(field)}</td>
                  <td className="px-3 py-3 text-center"><div className="flex items-center justify-center gap-2">
                    {(knownUsageCount(field) ?? 0) > 0 ? <Link href={`/tags/fields/migrate?id=${encodeURIComponent(field.id)}`} className="text-caption font-semibold text-accent hover:underline">移行</Link> : null}
                    {field.isInherited ? <span title="共通項目は直接削除できません" className="text-ink-faint"><LockKeyhole size={18} aria-label="共通項目のため削除できません" /></span> : <button type="button" disabled={fieldDeletionBlockedReason(field) !== null} onClick={() => setPendingDelete(field)} aria-label={`${field.name}を削除`} title={fieldDeletionBlockedReason(field) ?? '項目を削除'} className="text-danger hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={18} /></button>}
                  </div></td>
                </tr>)}
          </tbody>
        </table>
      </div>

      <section className="mt-4 rounded-card border border-hairline bg-canvas px-5 py-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]"><h2 className="text-sm font-bold text-ink">既定値・種類・削除の安全確認</h2><p className="mt-1 text-xs leading-relaxed text-ink-faint">既定値は空欄送信事故を防ぎます。種類は新規登録後に変更不可とし、値が入っている項目は削除せず新しい項目へ移行します。</p></section>
      <ConfirmDialog open={pendingDelete !== null} title={`項目「${pendingDelete?.name ?? ''}」を削除しますか？`} description="値が入っていない項目だけ削除できます。この操作は元に戻せません。" confirmLabel="削除する" destructive onCancel={() => setPendingDelete(null)} onConfirm={() => { const target = pendingDelete; setPendingDelete(null); if (target) void remove(target) }} />
    </div>
  )
}
