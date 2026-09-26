'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { LockKeyhole, Trash2 } from 'lucide-react'
import ReorderGrip from './reorder-grip'
import { mergeVisibleOrder, movableIds } from './reorder-utils'
import type { FriendField, FriendFieldListSummary, FriendFieldType } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import KpiCard from '@/components/shared/kpi-card'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import { Th } from '@/components/shared/table'

export const FIELD_TYPE_HINTS: Record<FriendFieldType, string> = {
  text: '短いテキスト', textarea: '長い文章', number: '体重など', date: '誕生日など', datetime: '予約日時など',
  select: '決まった選択肢から選ぶ', multi_select: '決まった選択肢から複数選ぶ',
  checkbox: 'はい / いいえ', url: 'リンク', tel: '電話番号', email: 'メールアドレス', image: '画像ファイル', pdf: 'PDFファイル',
}

export const FIELD_TYPE_LABELS: Record<FriendFieldType, string> = {
  text: '1行テキスト', textarea: '複数行テキスト', number: '数値', date: '日付', datetime: '日時',
  select: '単一選択', multi_select: '複数選択', checkbox: '真偽', url: 'URL',
  tel: '電話番号', email: 'メール', image: '画像', pdf: 'PDF',
}

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

function destinationLabel(field: FriendField): string {
  if (field.displayTargets?.length) return field.displayTargets.join('・')
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
  /*
    #1017 PERF-14: 上部の数値カード（集計）は一覧とは別の要求で、
    別の状態を持つ。以前は Promise.all で束ねていたため、集計が
    遅いと一覧まで待ち、集計が失敗すると一覧まで取得失敗になった。
    集計が落ちても一覧は出し、一覧が落ちても届いた集計は出す。
  */
  const [statsStatus, setStatsStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  /*
    操作の失敗は読み込みの失敗とは別の状態にする（#1014 ATTR-02）。
    load() の先頭で error を消すので、ここに載せないと「保存に失敗した」
    が再読込ですぐ消えてしまう。再試行できるのは並び替えだけ。
  */
  const [actionError, setActionError] = useState('')
  const [retryOrder, setRetryOrder] = useState<FriendField[] | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | FriendFieldType>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FriendField | null>(null)

  /*
    ATTR-01: アカウント切替のあとに届いた古い応答で一覧を上書きしない。
    Aの取得中にBへ切り替えると、A→B→A応答の順でB選択中にAの一覧が
    残った。要求ごとに世代の印を取り、応答時にアカウントと世代の両方が
    今のものと一致するときだけ反映する。
  */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(accountId)
  accountRef.current = accountId

  /*
    切替で残るものは閉じる。別アカウントの削除確認や掴んだままの
    つまみが残ると、表示と操作対象がずれる。
  */
  useEffect(() => {
    gateRef.current.invalidate()
    setPendingDelete(null)
    setDragId(null)
    setError('')
    setActionError('')
    setRetryOrder(null)
  }, [accountId])

  const load = useCallback(async () => {
    const account = accountId
    const token = gateRef.current.begin()
    if (!account) {
      setItems([]); setSummary(null); setStatus('error'); setStatsStatus('error'); setError('LINE公式アカウントを選んでください')
      return
    }
    setStatus('loading'); setStatsStatus('loading'); setError('')
    /*
      応答が今の世代・今のアカウントのものかを確かめる印。
      一覧と集計の両方で同じ印を使い、古いほうの応答が新しい画面へ
      混ざらないようにする（ATTR-01）。
    */
    const stale = () => !gateRef.current.current(token) || accountRef.current !== account
    /*
      集計は一覧の応答を待たず、届いた時点でカードへ入れる。
      失敗しても一覧は止めず、カード側が「出せない理由」を出す。
      数が無いときに 0 を作って入れない（帯の契約試験が見張る）。
    */
    void api.friendFields.stats(account).then((stats) => {
      if (stale()) return
      if (stats.success) { setSummary(stats.data); setStatsStatus('ready') }
      else { setSummary(null); setStatsStatus('error') }
    }, (reason) => {
      if (stale()) return
      setSummary(null)
      setStatsStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    })
    try {
      const list = await api.friendFields.list(account, { withUsage: true })
      if (stale()) return
      if (!list.success) throw new Error('load failed')
      setItems(list.data); setStatus('ready')
    } catch (reason) {
      if (stale()) return
      const forbidden = reason instanceof ApiError && reason.status === 403
      setItems([])
      setStatus(forbidden ? 'forbidden' : 'error')
      setError(forbidden ? '' : '再読み込みしても直らない場合はエラー報告へ。')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => items.filter((field) => {
    if (query && !field.name.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja'))) return false
    if (type !== 'all' && field.type !== type) return false
    return true
  }), [items, query, type])

  /*
    並び替えの保存。ドラッグとキーボード（N-049）で同じ経路を使う。

    **行ごとの PATCH ではなく /api/friend-fields/reorder へ1回で渡す**
    （#1014 ATTR-02/03/04）。行ごとだと途中失敗で一部だけ新しい順位が
    残り、絞り込みで隠れた行や共通項目にも順位が衝突した。サーバーは
    「動かせる行だけの新しい順」を受け取り、隠れた行と共通項目の位置を
    保ったまま原子的に書く。
  */
  const applyOrder = async (next: FriendField[]) => {
    if (!accountId) return
    const account = accountId
    const previous = items
    setItems(next)
    setActionError('')
    setRetryOrder(null)
    try {
      const res = await api.friendFields.reorder(account, movableIds(next, (field) => !field.isInherited))
      if (!res.success) throw new Error(res.error)
      await load()
    } catch (reason) {
      // 失敗した並びは保存済みと見せず元に戻す。理由と再試行は次の操作まで残す。
      setItems(previous)
      setActionError(reason instanceof ApiError ? `並び順を保存できませんでした（${reason.message}）` : '並び順を保存できませんでした')
      setRetryOrder(next)
    }
  }

  const move = async (targetId: string) => {
    if (!accountId || !dragId || dragId === targetId) return setDragId(null)
    const order = visible.map((field) => field.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((id) => items.find((field) => field.id === id)).filter(Boolean) as FriendField[]
    // 絞り込み中は見えている行だけを入れ替え、隠れた行・共通項目の位置を保つ。
    await applyOrder(mergeVisibleOrder(items, visibleNext, (field) => field.isInherited === true))
  }

  /** つまみにフォーカスして ↑/↓。表示中の並びで1つ動かす（N-049）。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = visible.map((field) => field.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((field) => field.id === i)).filter(Boolean) as FriendField[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (field) => field.isInherited === true))
  }

  const remove = async (field: FriendField) => {
    if (!accountId) return
    const blockedReason = fieldDeletionBlockedReason(field)
    if (blockedReason) {
      setActionError(blockedReason)
      return
    }
    setActionError('')
    try { await api.friendFields.delete(field.id, accountId); await load() }
    catch (reason) { setActionError(reason instanceof ApiError ? reason.message : '削除できませんでした') }
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
  const kpiReason = statsStatus === 'loading' ? STATE_TEXT.loading
    : statsStatus === 'forbidden' ? STATE_TEXT.forbiddenView
      : statsStatus === 'error' ? STATE_TEXT.error
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
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map((card) => <KpiCard key={card.title} {...card} loading={statsStatus === 'loading'} variant="v6" />)}</div>
      <NoteBar className="mb-4">既定値は友だち情報が空欄のときの送信値です。種類は新規登録後に変更せず、回答フォーム・友だち詳細・変数挿入で同じ定義を使います。</NoteBar>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="項目名で検索" aria-label="項目名で検索" className="h-9 w-[150px] rounded-control border border-hairline bg-canvas px-3 text-label" />
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="v6-select h-9 w-[150px] rounded-control border border-hairline bg-canvas px-3 text-label font-semibold text-ink" aria-label="項目の種類">
          <option value="all">種類：すべて</option>
          {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className="flex-1" />
        {/* 追加ボタンはタブの右に1個だけ（#1014 ATTR-22）。一覧の中には置かない。 */}
      </div>

      {status === 'ready' && actionError ? (
        <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">
          {actionError}
          {retryOrder ? (
            <button
              type="button"
              className="ml-2 font-semibold underline underline-offset-2"
              onClick={() => {
                const next = retryOrder
                setRetryOrder(null)
                if (next) void applyOrder(next)
              }}
            >
              再試行
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-card border border-hairline bg-canvas [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]">
        {/* 960px以上は表。それ未満は縦に重ねたカード（#1014 ATTR-14）。 */}
        <table className="hidden w-full table-fixed text-sm md:table">
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
                  <td draggable={!field.isInherited} onDragStart={() => setDragId(field.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void move(field.id)} className={`${field.isInherited ? 'cursor-not-allowed' : 'cursor-grab'} px-3 py-3 text-hairline`}><ReorderGrip label={field.name} disabled={field.isInherited} disabledReason="共通項目は移行後に並び替えできます" onMove={(direction) => void keyboardMove(field.id, direction)} /></td>
                  {/*
                    ATTR-05: 項目名から編集画面へ進める。以前は文字だけで
                    行操作は移行/削除しかなく、名前・既定値・保護設定を
                    変える入口がなかった。種類と差し込み名は編集画面でも固定。
                  */}
                  <td className="px-3 py-3"><Link href={`/tags/fields/edit?id=${encodeURIComponent(field.id)}`} className="block truncate font-semibold text-action hover:underline" title={`${field.name}を編集`}>{field.name}</Link><p className="truncate font-mono text-caption text-ink-faint" title={`{{field.${field.fieldKey}}}`}>{`{{field.${field.fieldKey}}}`}</p></td>
                  <td className="px-3 py-3 text-ink">{FIELD_TYPE_LABELS[field.type] ?? field.type}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{knownUsageCount(field) ?? '—'}{knownUsageCount(field) === null ? '' : '人'}</td>
                  <td className="px-3 py-3 text-ink-faint" title={field.formUsageCount === undefined ? '回答フォームの使用数を取得できません' : undefined}>{field.formUsageCount === undefined ? '—' : `回答フォーム ${field.formUsageCount}個`}</td>
                  <td className="truncate px-3 py-3 text-ink" title={destinationLabel(field)}>{destinationLabel(field)}</td>
                  <td className="px-3 py-3 text-center"><div className="flex items-center justify-center gap-2">
                    {(knownUsageCount(field) ?? 0) > 0 ? <Link href={`/tags/fields/migrate?id=${encodeURIComponent(field.id)}`} className="text-caption font-semibold text-action hover:underline">移行</Link> : null}
                    {field.isInherited ? <span title="共通項目は直接削除できません" className="text-ink-faint"><LockKeyhole size={18} aria-label="共通項目のため削除できません" /></span> : <button type="button" disabled={fieldDeletionBlockedReason(field) !== null} onClick={() => setPendingDelete(field)} aria-label={`${field.name}を削除`} title={fieldDeletionBlockedReason(field) ?? '項目を削除'} className="text-danger hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={18} /></button>}
                  </div></td>
                </tr>)}
          </tbody>
        </table>
        {/*
          960px未満では表がつぶれて操作列まで届かないので、縦に重ねた
          カードに切り替える。並び替えはキーボードの ↑/↓ が使える。
        */}
        {/* 狭い画面でも、読込・失敗・0件の案内は表と同じ言葉で出す。 */}
        {status !== 'ready' || items.length === 0 || visible.length === 0 ? (
          <div className="md:hidden">
            {status === 'loading' ? <ListState kind="loading" />
              : status === 'forbidden' ? <ListState kind="forbidden" description="友だち情報欄を見る権限がありません。オーナーか管理者に確認してください。" />
              : status === 'error' ? <ListState kind="error" description={error || '友だち情報欄を読み込めませんでした。'} onRetry={() => void load()} />
              : items.length === 0 ? <ListState kind="empty" title="まだ友だち情報欄がありません" description="「＋ 項目を追加」から最初の項目を作ってください。" />
              : <ListState kind="empty" title="条件に合う項目はありません" description="項目名か種類を変えてください。" />}
          </div>
        ) : null}
        {status === 'ready' && visible.length > 0 ? (
          <ul className="divide-y divide-hairline md:hidden">
            {visible.map((field) => (
              <li key={field.id} className="px-3 py-3">
                <div className="flex items-start gap-2">
                  <span className="pt-1 text-hairline">
                    <ReorderGrip label={field.name} disabled={field.isInherited} disabledReason="共通項目は移行後に並び替えできます" onMove={(direction) => void keyboardMove(field.id, direction)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/tags/fields/edit?id=${encodeURIComponent(field.id)}`} className="block truncate font-semibold text-action hover:underline" title={`${field.name}を編集`}>{field.name}</Link>
                    <p className="truncate font-mono text-caption text-ink-faint">{`{{field.${field.fieldKey}}}`}</p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {FIELD_TYPE_LABELS[field.type] ?? field.type}・使用中 {knownUsageCount(field) ?? '—'}{knownUsageCount(field) === null ? '' : '人'}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {field.formUsageCount === undefined ? '回答フォーム —' : `回答フォーム ${field.formUsageCount}個`}・{destinationLabel(field)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pt-1">
                    {(knownUsageCount(field) ?? 0) > 0 ? <Link href={`/tags/fields/migrate?id=${encodeURIComponent(field.id)}`} className="text-caption font-semibold text-action hover:underline">移行</Link> : null}
                    {field.isInherited ? <span title="共通項目は直接削除できません" className="text-ink-faint"><LockKeyhole size={18} aria-label="共通項目のため削除できません" /></span> : <button type="button" disabled={fieldDeletionBlockedReason(field) !== null} onClick={() => setPendingDelete(field)} aria-label={`${field.name}を削除`} title={fieldDeletionBlockedReason(field) ?? '項目を削除'} className="text-danger hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={18} /></button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <section className="mt-4 rounded-card border border-hairline bg-canvas px-5 py-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]"><h2 className="text-sm font-bold text-ink">既定値・種類・削除の安全確認</h2><p className="mt-1 text-xs leading-relaxed text-ink-faint">既定値は空欄送信事故を防ぎます。種類は新規登録後に変更不可とし、値が入っている項目は削除せず新しい項目へ移行します。</p></section>
      <ConfirmDialog open={pendingDelete !== null} title={`項目「${pendingDelete?.name ?? ''}」を削除しますか？`} description="値が入っていない項目だけ削除できます。この操作は元に戻せません。" confirmLabel="削除する" destructive onCancel={() => setPendingDelete(null)} onConfirm={() => { const target = pendingDelete; setPendingDelete(null); if (target) void remove(target) }} />
    </div>
  )
}
