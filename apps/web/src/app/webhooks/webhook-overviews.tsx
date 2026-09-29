'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IncomingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import { ApiError, api, type IncomingWebhookDetail, type IncomingWebhookTestResult, type IncomingWebhookUnmatchedItem, type OutgoingWebhookOverview } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ActionCell, DataTable, NameCell, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'
import { formatDateTime, formatNumber } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'
type OutgoingFilter = 'all' | 'active' | 'paused' | 'failed'
type OutgoingSort = 'volume' | 'name'

const PAGE_SIZE = 5

/* R401: 未照合の箱の1回の読み取り件数。一覧APIの既定と同じ50。 */
const UNMATCHED_PAGE_SIZE = 50

const EVENT_LABEL: Record<string, string> = {
  'conversion.confirmed': '注文が確定したとき',
  'friend.added': '友だちが追加されたとき',
  'form.submitted': 'フォームが送られたとき',
  'booking.created': '予約が入ったとき',
  '*': 'すべての出来事',
}

const PAYLOAD_LABEL: Record<string, string> = {
  'conversion.confirmed': '注文番号・金額・お客様名',
  'friend.added': '名前・追加日・流入元',
  'form.submitted': '回答のすべて',
  'booking.created': '予約日時・メニュー・担当',
  '*': '選んだ出来事の項目',
}

function firstEventLabel(item: OutgoingWebhookOverview): string {
  const first = item.eventTypes[0]
  if (!first) return 'まだ決めていません'
  const label = EVENT_LABEL[first] ?? first
  return item.eventTypes.length > 1 ? `${label} ほか${item.eventTypes.length - 1}件` : label
}

function payloadLabel(item: OutgoingWebhookOverview): string {
  const first = item.eventTypes[0]
  return first ? PAYLOAD_LABEL[first] ?? '選んだ出来事の項目' : 'まだ決めていません'
}

/** URLの値やqueryを一覧へ出さず、相手を見分けられる範囲だけ残す。 */
function maskedUrl(value: string): string {
  try {
    const url = new URL(value)
    const firstPath = url.pathname.split('/').filter(Boolean)[0]
    return `${url.origin}${firstPath ? `/${firstPath}` : ''}/•••`
  } catch {
    return 'URLを確かめてください'
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function matchesOutgoing(item: OutgoingWebhookOverview, filter: OutgoingFilter, query: string): boolean {
  const matchesFilter = filter === 'all'
    || (filter === 'active' && item.isActive)
    || (filter === 'paused' && !item.isActive)
    || (filter === 'failed' && item.deliverySummary.failed > 0)
  const needle = query.trim().toLocaleLowerCase('ja-JP')
  if (!matchesFilter) return false
  if (!needle) return true
  return [item.name, item.url, ...item.eventTypes].some((value) =>
    value.toLocaleLowerCase('ja-JP').includes(needle),
  )
}

export function OutgoingKpis({
  items,
  status,
  incomingCount,
  summary,
  summaryStatus,
}: {
  items: OutgoingWebhookOverview[]
  /** 一覧の読み込み状態。取れない間、件数に 0 を出さない（★V7 `x63W5x`）。 */
  status: LoadStatus
  incomingCount: number
  summary: WebhookInteractionSummary | null
  summaryStatus: LoadStatus
}) {
  const paused = items.filter((item) => !item.isActive).length
  const failedNames = items
    .filter((item) => item.deliverySummary.failed > 0)
    .map((item) => item.name.split('／')[0].trim())
    .join('、')
  const summaryLoading = summaryStatus === 'loading'
  const summaryMissing = summaryStatus === 'error' || summary === null
  const outgoingSuccess = summary ? Math.max(0, summary.outgoing - summary.failed) : null

  // ★V7 `x63W5x`：取れない KPI は「—」。読み込み中は「読み込んでいます」、
  // 失敗は「読み込めませんでした」と言い分け、0（本当に0本）と混ぜない。
  const listFailed = status === 'error'
  const listLoading = status === 'loading'
  const listDetail = listFailed ? '読み込めませんでした' : listLoading ? '読み込んでいます' : `止めているもの ${paused}本`

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-design="KPIs">
      <KpiCard
        title="こちらから送る"
        value={status === 'ready' ? items.length : null}
        unit="本"
        detail={listDetail}
        loading={listLoading}
        variant="v6"
      />
      <KpiCard
        title="この30日に送った"
        value={summaryMissing ? null : summary?.outgoing ?? null}
        unit="回"
        detail={outgoingSuccess === null ? '集計を取得できませんでした' : `うち成功 ${formatNumber(outgoingSuccess)}回`}
        loading={summaryLoading}
        variant="v6"
      />
      <KpiCard
        title="返事がなかった"
        value={summaryMissing ? null : summary?.failed ?? null}
        unit="回"
        detail={failedNames ? `${failedNames}を確認` : 'いま確認が必要な送り先はありません'}
        badge={failedNames ? '確認' : undefined}
        badgeTone="warning"
        loading={summaryLoading}
        variant="v6"
      />
      <KpiCard
        title="受け取った"
        value={summaryMissing ? null : summary?.incoming ?? null}
        unit="回"
        detail={incomingCount > 0 ? `受け取り口 ${incomingCount}本` : '外部から届いたお知らせ'}
        loading={summaryLoading}
        variant="v6"
      />
    </div>
  )
}

export function OutgoingOverview({
  items,
  status,
  showCreate,
  summary,
  summaryStatus,
  incomingCount,
  lineAccountId,
  onReload,
  onToggle,
  togglingIds,
  onRotate,
  onDelete,
  canManage,
}: {
  items: OutgoingWebhookOverview[]
  status: LoadStatus
  showCreate: boolean
  summary: WebhookInteractionSummary | null
  summaryStatus: LoadStatus
  incomingCount: number
  lineAccountId: string | null
  onReload: () => void
  onToggle: (id: string, active: boolean) => void
  /** 開始・停止の応答を待っている行のID(#707)。 */
  togglingIds: string[]
  onRotate: (item: OutgoingWebhookOverview) => void
  onDelete: (item: OutgoingWebhookOverview) => void
  /**
   * 送り先の変更（開始・停止・直す・合言葉・削除）は統括だけ（R32）。
   * 口側が `requireRole('owner')` で守っている。試し送信とやり取りの記録は
   * 管理者も使えるので残す。
   */
  canManage: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OutgoingFilter>('all')
  const [sort, setSort] = useState<OutgoingSort>('volume')
  const [page, setPage] = useState(1)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  /*
    開いている行の「設定」ボタンと吹き出しを、まとめて包む入れ物(#705)。
    外側を押したかどうかは、この入れ物の中かどうかで決める。ボタンまで
    含めて包むのは、ボタンを押したときに「外側なので閉じる」と
    「onClick で開き直す」が続けて起きて、閉じられなくなるのを避けるため。
  */
  const settingsRef = useRef<HTMLDivElement | null>(null)
  /** 開いている設定メニューの箱。キー操作の対象をここから拾う。 */
  const settingsMenuRef = useRef<HTMLDivElement | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  /**
   * 「1回 試してみる」の確認中の送り先(N-388)。
   *
   * 試し送信は登録した**本物のURL**へ届く。押した瞬間に送るのではなく、
   * どこへ送るかを省略せず見せてから送る。確認画面で URL を伏せると
   * 確認の意味がないので、一覧の maskedUrl ではなく設定値をそのまま出す。
   */
  const [testTarget, setTestTarget] = useState<OutgoingWebhookOverview | null>(null)
  /**
   * 「1回 試してみる」の結果(#506 中)。
   *
   * 以前は口の戻り値を読まず、成功も失敗も画面に何も出なかった。
   * 成功は届いた旨、失敗は「やり取りの記録」タブへの案内を出す。
   */
  const [testNotice, setTestNotice] = useState<{ tone: 'danger'; message: string } | null>(null)

  // d23b R421: アカウントを切り替えたあと、前のアカウントの結果が
  // 新しい画面へ出ないよう、開始時点のアカウントと今のアカウントを照合する。
  const lineAccountIdRef = useRef(lineAccountId)
  lineAccountIdRef.current = lineAccountId

  // 切り替えたら、前のアカウントの確認窓・結果・進行中表示を閉じる。
  useEffect(() => {
    setTestTarget(null)
    setTestNotice(null)
    setTestingId(null)
  }, [lineAccountId])

  const runTest = async (item: OutgoingWebhookOverview) => {
    const requestAccountId = lineAccountId
    if (!requestAccountId || testingId !== null) return
    setTestTarget(null)
    setTestingId(item.id)
    setTestNotice(null)
    try {
      const response = await api.webhooks.outgoing.test(item.id, requestAccountId)
      if (lineAccountIdRef.current !== requestAccountId) return
      if (response.success && response.data.delivered) {
        const status = response.data.responseStatus
        notifyToast(`「${item.name}」への試し送信が届きました${status === null ? '' : `(相手の応答 ${status})`}。`)
      } else {
        const status = response.success ? response.data.responseStatus : null
        setTestNotice({
          tone: 'danger',
          message: `「${item.name}」への試し送信は届きませんでした${status === null ? '' : `(相手の応答 ${status})`}。「やり取りの記録」タブで詳しく確認できます。`,
        })
      }
    } catch {
      if (lineAccountIdRef.current !== requestAccountId) return
      setTestNotice({
        tone: 'danger',
        message: `「${item.name}」への試し送信に失敗しました。「やり取りの記録」タブで詳しく確認できます。`,
      })
    } finally {
      setTestingId(null)
    }
  }

  const filtered = useMemo(() => {
    const rows = items.filter((item) => matchesOutgoing(item, filter, query))
    return [...rows].sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name, 'ja-JP')
      : b.deliverySummary.total - a.deliverySummary.total)
  }, [filter, items, query, sort])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const activeCount = items.filter((item) => item.isActive).length + incomingCount
  const pausedCount = items.filter((item) => !item.isActive).length
  const failedCount = items.filter((item) => item.deliverySummary.failed > 0).length

  useEffect(() => {
    setPage(1)
  }, [filter, query, sort])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  /*
    操作の吹き出しを、外側を押したときと Escape で閉じる(#705)。
    N-385: さらにキーボードだけで開いて選べるようにする。

    ここは以前「設定」をもう一度押すまで閉じなかった。応答が返っても、
    画面の他の場所を押しても、Escape でも閉じない。この家の他の一覧
    (`reminders`・`tags-page-v4` が使う `components/shared/action-menu.tsx`、
    自前の `components/shared/folder-panel.tsx`)はどれも閉じる仕掛けを
    持っていて、**webhooks だけが持っていなかった。**同じ形に揃える。
    N-385 ではメニュー作法（role=menu、最初の項目へフォーカス、矢印キーで
    移動、Escape で閉じて「設定」ボタンへ戻る）も揃える。

    「選んだら閉じる」は入れない。押した瞬間に「止める」が消えると
    二重押しそのものが起こせなくなり、二重押し防止(page.tsx の
    togglingIdsRef)を見張っている試験の当て先が消えるため。送信中の
    見え方は #707 で別に扱う。
  */
  const settingsMenuItems = useCallback((): HTMLElement[] => {
    // 押せない項目（disabled / aria-disabled）は移動先に含めない。
    return Array.from(
      settingsMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')
  }, [])

  useEffect(() => {
    if (settingsId === null) return
    // 開いたら最初の項目へフォーカスを移す。マウスで開いたときも同じで、
    // 矢印キーを押せばすぐ移動できる（menu の一般的な作法）。
    settingsMenuItems()[0]?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsId(null)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSettingsId(null)
      // 閉じたあとフォーカスが本文へ落ちないよう、開いた「設定」ボタンへ戻す。
      settingsRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsId, settingsMenuItems])

  const onSettingsMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = settingsMenuItems()
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      items[(currentIndex + 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      items[(currentIndex - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  return (
    <section aria-label="こちらから送る一覧">
      <Notice tone="info" className="mb-3">
        「こちらから送る」は、うちで起きたことを相手に知らせます。「こちらで受け取る」は、相手で起きたことをうちに取り込みます。受け取る側のURLは、相手のサービスに貼ってください。
      </Notice>

      {testNotice ? (
        <div className="mb-3">
          <Notice tone="danger" message={testNotice.message} onClose={() => setTestNotice(null)} />
        </div>
      ) : null}

      <ListToolbar
        search={{ placeholder: 'つなぎ先・送るタイミングで検索', value: query, onChange: setQuery }}
        filters={
          <Select
            aria-label="外部連携の状態"
            value={filter}
            onChange={(value) => setFilter(value as OutgoingFilter)}
            // ★V7 `x63W5x`：取れていない間の件数は出さない（0 と読めるため）。
            options={(() => {
              const count = (n: number) => (status === 'ready' ? ` ${n}` : '')
              return [
                { value: 'all', label: `すべて${count(items.length + incomingCount)}` },
                { value: 'active', label: `動いている${count(activeCount)}` },
                { value: 'paused', label: `止めている${count(pausedCount)}` },
                { value: 'failed', label: `失敗あり${count(failedCount)}` },
              ]
            })()}
          />
        }
        trailing={
          <Select
            aria-label="外部連携の並び順"
            value={sort}
            onChange={(value) => setSort(value as OutgoingSort)}
            options={[
              { value: 'volume', label: '送った回数が多い順' },
              { value: 'name', label: '名前順' },
            ]}
          />
        }
      />

      {status === 'loading' ? (
        <ListState kind="loading" title="こちらから送る設定を読み込んでいます" />
      ) : status === 'error' ? (
        <ListState
          kind="error"
          title="こちらから送る設定を表示できませんでした"
          description="登録内容は消えていません。再読み込みしても直らない場合はエラー報告へお知らせください。"
          onRetry={onReload}
        />
      ) : items.length === 0 && !showCreate ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            title="まだ連携がありません"
            description={canManage
              ? 'うちで起きたことを、ほかのサービスに知らせられます。「＋ 送り先を作る」から作成してください。'
              : 'うちで起きたことを、ほかのサービスに知らせられます。送り先の作成は統括に頼んでください。'}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline border">
          <ListState
            kind="empty"
            title="当てはまる送り先がありません"
            description="検索の言葉か、状態の絞り込みを変えてください。"
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th className="w-2/12">つなぎ先</Th>
              <Th className="w-2/12">いつ送るか</Th>
              <Th className="w-2/12">送るもの</Th>
              <Th className="w-1/12" align="right">この30日</Th>
              <Th className="w-2/12">ようす</Th>
              <Th className="w-3/12">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {visible.map((item) => {
              const toggling = togglingIds.includes(item.id)
              const pending = item.deliverySummary.lastResult?.status === 'pending'
              const failed = !pending && (item.deliverySummary.lastResult?.status === 'failed'
                || item.deliverySummary.failed > 0)
              const canActivate = item.hasSecret && isHttpsUrl(item.url)
              return (
                <Tr key={item.id}>
                  <NameCell
                    name={<span className="block truncate" title={item.name}>{item.name}</span>}
                    sub={<span className="block truncate" title={maskedUrl(item.url)}>{maskedUrl(item.url)}</span>}
                  />
                  <Td><span className="block truncate" title={firstEventLabel(item)}>{firstEventLabel(item)}</span></Td>
                  <Td><span className="block truncate" title={payloadLabel(item)}>{payloadLabel(item)}</span></Td>
                  <Td align="right">
                    <span className="text-ink tabular-nums">
                      {formatNumber(item.deliverySummary.total)}回
                    </span>
                    {item.deliverySummary.pending > 0 ? (
                      <span className="text-ink-faint block text-xs">
                        送信中 {formatNumber(item.deliverySummary.pending)}回
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {/*
                      応答待ちは一覧の帯にも出す(#707)。操作の吹き出しは外側を
                      押すと閉じるので、ボタンの文言だけだと、閉じた瞬間にどの行が
                      待ちなのか分からなくなる。
                      言葉は `切り替え中`。すぐ左の `送信中` は配信の待ち件数で
                      別の意味なので、同じ言葉を重ねない。
                    */}
                    <StatusBadge tone={toggling ? 'info' : failed ? 'danger' : pending ? 'neutral' : item.isActive ? 'success' : 'neutral'} size="compact">
                      {toggling ? '切り替え中' : failed ? '返事がありません' : pending ? '送信中' : item.isActive ? 'うまくいっています' : '止めています'}
                    </StatusBadge>
                    {failed && item.deliverySummary.lastResult?.completedAt ? (
                      <span
                        className="text-ink-faint mt-1 block truncate text-xs"
                        title={`最終 ${formatDateTime(item.deliverySummary.lastResult.completedAt)}`}
                      >
                        最終 {formatDateTime(item.deliverySummary.lastResult.completedAt)}
                      </span>
                    ) : null}
                  </Td>
                  <ActionCell>
                    {/*
                      行に直接置くのは「失敗をやり直す／中身を見る」だけ。
                      「1回 試してみる」まで横に並べると操作列が「ようす」列へ
                      重なり、状態の札が読めなくなる。試し送信は使用頻度が
                      低いので「設定」メニューの末尾へ畳む（確認ダイアログを
                      挟む仕掛けはそのまま）。
                    */}
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <Button variant="secondary" href="/webhooks?tab=interactions">
                        {item.deliverySummary.canRetry ? '失敗をやり直す' : '中身を見る'}
                      </Button>
                      <div className="relative" ref={settingsId === item.id ? settingsRef : null}>
                        <Button
                          variant="secondary"
                          aria-haspopup="menu"
                          aria-expanded={settingsId === item.id}
                          onClick={() => setSettingsId((current) => current === item.id ? null : item.id)}
                        >
                          設定
                        </Button>
                        {settingsId === item.id ? (
                          /*
                            吹き出しは**自分の行の帯の中**に出す(#705)。

                            以前はボタンの下(`mt-2`)へ垂らしていたので、次の行の
                            操作ボタンに 14〜25px かぶさっていた。かぶさった所を
                            押すと、狙った行ではなく**この行の「削除」「合言葉」が
                            動く。**1280px幅では中心が 4px だけ空いていて偶然
                            押せていたが、1600px幅では中心も覆われて次の行の
                            「設定」がまったく押せない。

                            行の高さは58px以上、吹き出しは54px なので、上下中央に
                            置けば他の行へはみ出さない。応答が返るまで開いたままでも、
                            奪うのは自分の行の中だけになる。
                          */
                          <div
                            ref={settingsMenuRef}
                            role="menu"
                            aria-label={`「${item.name}」の設定`}
                            onKeyDown={onSettingsMenuKeyDown}
                            className="bg-canvas border-hairline rounded-card absolute top-1/2 right-full z-10 mr-2 flex min-w-max -translate-y-1/2 gap-2 border p-2 shadow-float"
                          >
                          {/*
                            送信中でも**押せる状態のまま**にする(#707)。

                            `disabled` にすると二重押しがそもそも起こせなくなり、
                            二重押し防止(page.tsx の togglingIdsRef)を見張っている
                            試験2が、防止が壊れても緑のままになる。押せる状態を
                            保ったまま、文言と `aria-busy` で送信中だと分かるようにする。

                            幅を固定する理由(#707 で実測)。固定を外すと、押した
                            瞬間にボタンが **幅 67px → 119px・左へ 52px** 伸びる
                            (1280×720 と 1600×900 のどちらでも同じ)。試験の
                            `dblclick` は2発とも同じ座標へ落ちるので、押下位置が
                            動くのは危ない。

                            **ただし今の並びでは2発目は当たる。**吹き出しが
                            `right-full` で右端を固定しており、この `止める` が
                            いちばん左なので、伸びても押した点は箱の中に残る。
                            重ねがけの逆変異(幅の固定を外す + 二重押し防止を外す)で
                            送信が2回になることを確かめた。**当たっているのは
                            吹き出しの向きに助けられているだけ**で、向きや並び順を
                            変えた瞬間に2発目が外れ、防止が壊れていても試験2が緑に
                            なる。幅を固定して伸びをゼロにし、その不動を試験2が
                            押下前後の座標で見張る。押した指の下でボタンの大きさが
                            変わらなくなる利点も兼ねる。
                          */}
                          {canManage ? (
                            <>
                              <Button
                                variant="secondary"
                                role="menuitem"
                                className="min-w-36"
                                onClick={() => onToggle(item.id, item.isActive)}
                                disabled={!item.isActive && !canActivate}
                                aria-busy={toggling || undefined}
                                data-webhook-toggle-pending={toggling ? `outgoing:${item.id}` : undefined}
                                title={!item.isActive && !canActivate ? 'URLと合言葉を確かめてください' : undefined}
                              >
                                {toggling
                                  ? (item.isActive ? '止めています…' : '動かしています…')
                                  : (item.isActive ? '止める' : '動かす')}
                              </Button>
                              {/* N-363: 名前・URL・いつ送るか・送り直す回数を直す画面へ。 */}
                              <Button variant="secondary" role="menuitem" href={`/webhooks/edit?id=${item.id}`}>直す</Button>
                              <Button variant="secondary" role="menuitem" onClick={() => onRotate(item)}>合言葉</Button>
                              <Button variant="secondary" role="menuitem" onClick={() => onDelete(item)}>削除</Button>
                            </>
                          ) : null}
                          {/*
                            試し送信は本物のURLへ届くので、押しただけでは送らず
                            確認ダイアログへ回す(N-388)。確認を開くと同時に
                            メニューを閉じる。幅は固定しない(`min-w-36` は
                            「止める」の押下座標を動かさないための固定で#707)。
                          */}
                          <Button
                            variant="secondary"
                            role="menuitem"
                            disabled={!lineAccountId || testingId !== null || !item.isActive}
                            onClick={() => { setSettingsId(null); setTestTarget(item) }}
                          >
                            {testingId === item.id ? '試しています…' : '1回 試してみる'}
                          </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </ActionCell>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      )}

      {/*
        ★V7 `x63W5x`：取れていない間の件数（「0本のうち 0本を表示」）は出さない。
        一覧が読めてから出す。
      */}
      {status === 'ready' ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink-faint text-sm">
            こちらから送る {filtered.length}本のうち {visible.length}本を表示
          </p>
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      ) : null}

      {/*
        N-388: 試し送信は登録した本物のURLへ届く。ボタンを押しただけでは
        送らず、どこへ何を送るかを確かめてから送る。URLは確認のために
        省略せずそのまま出す。
      */}
      <ConfirmDialog
        open={testTarget !== null}
        title="試し送信をします"
        description={
          testTarget
            ? `「${testTarget.name}」へ、試し用のデータを1回だけ送ります。実際の連携先へ届きます。`
            : ''
        }
        confirmLabel="この送り先へ送る"
        cancelLabel="やめる"
        busy={testingId !== null}
        onConfirm={() => {
          if (testTarget) void runTest(testTarget)
        }}
        onCancel={() => setTestTarget(null)}
      >
        {testTarget ? (
          <div className="bg-canvas-sunken rounded-control p-3">
            <p className="text-ink-faint text-xs">送り先のURL</p>
            <code className="text-ink mt-1 block break-all text-sm">{testTarget.url}</code>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  )
}

export function IncomingOverview({
  items,
  status,
  showCreate,
  lineAccountId,
  endpointUrl,
  onReload,
  onToggle,
  togglingIds,
  onRotate,
  onDelete,
  canManage,
  canResolveUnmatched,
}: {
  items: IncomingWebhook[]
  status: LoadStatus
  showCreate: boolean
  lineAccountId: string | null
  endpointUrl: (id: string) => string
  onReload: () => void
  /**
   * 受け取り口の変更（開始・停止・合言葉・削除）は統括だけ（R32）。
   * 口側が `requireRole('owner')` で守っている。「届いたつもりで試す」は
   * 管理者も使えるので残す。
   */
  canManage: boolean
  onToggle: (id: string, active: boolean) => void
  /**
   * 開始・停止の応答を待っている行のID(#707)。
   *
   * 外向きとまったく同じ「黙って落とす」作りだったので、見え方も同じに揃える。
   * ただし内向きの `止める` は詳細の窓の中にあり、`webhook-runtime.spec.ts` に
   * 当て先が無い。**ここは見え方だけで、二重押し防止の見張りは付いていない。**
   */
  togglingIds: string[]
  onRotate: (item: IncomingWebhook) => void
  onDelete: (item: IncomingWebhook) => void
  /**
   * R399: 未照合の「結び付ける」「確認した」は owner/admin の口
   * （`POST /api/webhooks/unmatched/:id/resolve`）なので、その権限で
   * 出し分ける。staff にはボタンを出さず依頼案内にする。
   */
  canResolveUnmatched: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<IncomingWebhookDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading')
  const [detailReloadKey, setDetailReloadKey] = useState(0)
  /*
    人が見つからなかった届物の箱(#939 N-367)。
    「未照合として確認する」「友だち候補を作る」を選んだ口だけ使う。
  */
  const [unmatched, setUnmatched] = useState<IncomingWebhookUnmatchedItem[]>([])
  const [unmatchedStatus, setUnmatchedStatus] = useState<LoadStatus>('ready')
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  /*
   * R399: 行の操作が失敗したときの理由と次の行動。操作は1件ずつ直列
   * （dismissingId）なので置き場は1つで足りる。
   * R401: 50件超えは shown 件ずつ読み足す。total は空表示の判定にも使う。
   */
  const [unmatchedActionError, setUnmatchedActionError] = useState<{ id: string; message: string } | null>(null)
  const [unmatchedTotal, setUnmatchedTotal] = useState<number | null>(null)
  const [unmatchedShown, setUnmatchedShown] = useState(UNMATCHED_PAGE_SIZE)
  const [unmatchedReloadKey, setUnmatchedReloadKey] = useState(0)
  const [unmatchedMoreBusy, setUnmatchedMoreBusy] = useState(false)
  /*
    S (#939 機能26): 届いたつもりで試す窓。見本のJSONを入れて
    「どの人に届くか・何が動くか」を確かめる。実行はしない。
  */
  const [testOpen, setTestOpen] = useState(false)
  const [testJson, setTestJson] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState<IncomingWebhookTestResult | null>(null)
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const selectedDetailId = selected?.id ?? null

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [items, selectedId])

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    if (!selectedDetailId || !lineAccountId) {
      setDetailStatus('ready')
      return () => { cancelled = true }
    }
    setDetailStatus('loading')
    void api.webhooks.incoming.detail(selectedDetailId, lineAccountId)
      .then((response) => {
        if (cancelled) return
        if (!response.success) {
          setDetailStatus('error')
          return
        }
        setDetail(response.data)
        setDetailStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setDetailStatus('error')
      })
    return () => { cancelled = true }
  }, [detailReloadKey, lineAccountId, selectedDetailId])

  /*
    箱の中身は詳細が読めたときに一緒に読む。「何もしない」を選んでいる口でも、
    以前の選択で溜まった届物があれば見せる（R400）。
    R401: shown 件ずつ読む。処理が終わるたび読み直して不足分を補充するので、
    件数の勘定は手元で引かずサーバー（total・詳細の件数）に任せる。
  */
  useEffect(() => {
    let cancelled = false
    if (!selectedDetailId || !lineAccountId || detailStatus !== 'ready') return
    const webhookId = selectedDetailId
    const accountId = lineAccountId
    const limit = unmatchedShown
    // 既に並んでいる読み直しは静かに（R401）。初回と失敗後は帯を出す。
    if (unmatched.length === 0) setUnmatchedStatus('loading')
    void api.webhooks.incoming.unmatched(webhookId, accountId, undefined, { limit })
      .then((response) => {
        if (cancelled) return
        if (!response.success) {
          setUnmatchedStatus('error')
          return
        }
        setUnmatched(response.data)
        setUnmatchedTotal(response.total ?? null)
        setUnmatchedStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setUnmatchedStatus('error')
      })
      .finally(() => {
        if (!cancelled) setUnmatchedMoreBusy(false)
      })
    return () => { cancelled = true }
  }, [detailStatus, lineAccountId, selectedDetailId, unmatchedShown, unmatchedReloadKey])

  /* 受け取り口が変わったら箱の表示を捨てる（R401: 古い50件を残さない）。 */
  useEffect(() => {
    setUnmatched([])
    setUnmatchedTotal(null)
    setUnmatchedShown(UNMATCHED_PAGE_SIZE)
    setUnmatchedActionError(null)
    setUnmatchedStatus('ready')
  }, [lineAccountId, selectedDetailId])

  /*
   * R399: 403/409/500/通信断で未処理Promiseを残さず、行に理由と次の行動を出す。
   * - 403 … 権限不足。統括または管理者への引き継ぎ
   * - 409 … 処理済み。最新を読み直した旨
   * - 応答なし（通信断）… 結果不明。先に読み直し、残っていれば再試行
   * - その他の応答あり失敗 … 確定失敗。再試行の案内
   * 成功時は手元で引かず読み直す（R401: 残件と空表示の矛盾を防ぐ）。
   */
  const reloadUnmatchedBox = () => {
    setUnmatchedReloadKey((key) => key + 1)
    setDetailReloadKey((key) => key + 1)
  }

  const resolveUnmatched = async (
    item: IncomingWebhookUnmatchedItem,
    payload: { action: 'dismiss' } | { action: 'link'; friendId: string },
  ) => {
    if (!lineAccountId || dismissingId !== null) return
    setDismissingId(item.id)
    setUnmatchedActionError(null)
    try {
      const res = await api.webhooks.incoming.resolveUnmatched(item.id, lineAccountId, payload)
      if (!res.success) {
        setUnmatchedActionError({
          id: item.id,
          message: res.error || '保存できませんでした。一覧を読み直してから、もう一度お試しください。',
        })
        return
      }
      reloadUnmatchedBox()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        reloadUnmatchedBox()
        setUnmatchedActionError({ id: item.id, message: 'すでに処理済みです。最新の状態を読み直しました。' })
        return
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setUnmatchedActionError({ id: item.id, message: 'この操作は統括または管理者だけができます。必要なときは統括に頼んでください。' })
        return
      }
      if (caught instanceof ApiError) {
        setUnmatchedActionError({
          id: item.id,
          message: describeApiFailure(caught, '確認', {
            forbidden: 'この操作は統括または管理者だけができます。必要なときは統括に頼んでください。',
          }),
        })
        return
      }
      reloadUnmatchedBox()
      setUnmatchedActionError({ id: item.id, message: '結果が分かりませんでした。一覧を読み直しました。残っていれば、もう一度お試しください。' })
    } finally {
      setDismissingId(null)
    }
  }

  const dismissUnmatched = async (item: IncomingWebhookUnmatchedItem) => {
    await resolveUnmatched(item, { action: 'dismiss' })
  }

  /* S: 複数一致で保留した届物から、運用者が友だちを1人選んで結び付ける。 */
  const linkUnmatched = async (item: IncomingWebhookUnmatchedItem, friendId: string) => {
    await resolveUnmatched(item, { action: 'link', friendId })
  }

  const runIncomingTest = async () => {
    if (!lineAccountId || !selectedDetailId || testBusy) return
    let payload: unknown
    try {
      payload = JSON.parse(testJson) as unknown
    } catch {
      setTestError('JSONの形が正しくありません。見本を確かめてください。')
      return
    }
    setTestBusy(true)
    setTestError('')
    try {
      const res = await api.webhooks.incoming.test(selectedDetailId, lineAccountId, payload)
      if (!res.success) {
        setTestError(res.error)
        setTestResult(null)
        return
      }
      setTestResult(res.data)
    } catch (caught) {
      // 試す口は管理者も使える。失敗は原因どおりに（R32）。
      setTestError(describeApiFailure(caught, '試し', {
        forbidden: 'この操作を行う権限がありません。統括に頼んでください。',
      }))
      setTestResult(null)
    } finally {
      setTestBusy(false)
    }
  }

  if (status === 'loading') {
    return <ListState kind="loading" title="こちらで受け取る設定を読み込んでいます" />
  }
  if (status === 'error') {
    return (
      <ListState
        kind="error"
        title="こちらで受け取る設定を表示できませんでした"
        description="登録内容は消えていません。再読み込みしても直らない場合はエラー報告へ。"
        onRetry={onReload}
      />
    )
  }
  if (!selected && !showCreate) {
    return (
      <ListState
        kind="empty"
        title="まだ受け取り口がありません"
        description={canManage
          ? '相手のサービスから知らせを受け取るURLを、「＋ 受け取り口を作る」から作成してください。'
          : '相手のサービスから知らせを受け取るURLは、まだありません。受け取り口の作成は統括に頼んでください。'}
      />
    )
  }
  if (!selected) return null

  return (
    <section aria-label="こちらで受け取る詳細" className="flex flex-col gap-4">
      <p className="bg-info-bg text-info rounded-card px-4 py-3 text-sm leading-6">
        相手のサービスで起きたことを、うちに取り込みます。下のURLを相手に貼ってもらってください。合言葉は人に見せないでください。
      </p>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <section className="bg-canvas border-hairline rounded-card border p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-ink text-lg font-bold">受け取り口 1 ／ {selected.name}</h2>
                <p className="text-ink-secondary mt-1 text-sm">相手のサービスの「Webhook URL」に、下のURLを貼ってください。</p>
              </div>
              <StatusBadge tone={selected.isActive ? 'success' : 'neutral'}>
                {selected.isActive ? '動いています' : '止めています'}
              </StatusBadge>
            </div>
            <div className="bg-canvas-sunken rounded-control mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
              <code className="text-ink break-all text-sm">{endpointUrl(selected.id)}</code>
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(endpointUrl(selected.id))}>
                コピー
              </Button>
            </div>
            <dl className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <dt className="text-ink-faint text-xs">だれの出来事か（人の見分けかた）</dt>
                <dd className="text-ink mt-1 text-sm">
                  {detailStatus === 'loading'
                    ? '読み込んでいます'
                    : detailStatus === 'error'
                      ? '確認できませんでした'
                      : identityMatchingLabel(detail)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint text-xs">見つからなかったとき</dt>
                <dd className="text-ink mt-1 text-sm">
                  {detailStatus === 'loading'
                    ? '読み込んでいます'
                    : detailStatus === 'error'
                      ? '確認できませんでした'
                      : notFoundLabel(detail?.identityMatching.onNotFound)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint text-xs">合言葉（相手にも同じものを入れてもらう）</dt>
                <dd className="mt-1"><StatusBadge tone={selected.hasSecret ? 'success' : 'warning'} size="compact">{selected.hasSecret ? '設定済み（再表示しません）' : '未設定'}</StatusBadge></dd>
                {/* S: 入れ替えたばかりなら、前の合言葉が切れる時刻を示す。 */}
                {detail?.previousSecretUsableUntil ? (
                  <dd className="text-ink-faint mt-1 text-xs">
                    前の合言葉は {formatReceivedAt(detail.previousSecretUsableUntil)} まで使えます
                  </dd>
                ) : null}
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2">
              {canManage ? (
                <>
                  <Button
                    variant="secondary"
                    className="min-w-36"
                    onClick={() => onToggle(selected.id, selected.isActive)}
                    disabled={!selected.hasSecret && !selected.isActive}
                    aria-busy={togglingIds.includes(selected.id) || undefined}
                    data-webhook-toggle-pending={togglingIds.includes(selected.id) ? `incoming:${selected.id}` : undefined}
                  >
                    {togglingIds.includes(selected.id)
                      ? (selected.isActive ? '止めています…' : '動かしています…')
                      : (selected.isActive ? '止める' : '動かす')}
                  </Button>
                  <Button variant="secondary" onClick={() => onRotate(selected)}>合言葉を更新</Button>
                </>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setTestJson(detail?.latestSample
                    ? `{\n  "friendId": "ここに届くデータの形を入れてください"\n}`
                    : '')
                  setTestResult(null)
                  setTestError('')
                  setTestOpen(true)
                }}
              >
                届いたつもりで試す
              </Button>
              {canManage ? (
                <Button variant="secondary" onClick={() => onDelete(selected)}>削除</Button>
              ) : null}
            </div>
            {canManage ? null : (
              <p className="text-ink-secondary mt-2 text-xs">止める・合言葉の更新・削除は統括だけができます。</p>
            )}
          <div className="border-hairline mt-4 border-t pt-3.5">
            <h2 className="text-ink mb-3 text-lg font-bold">届いたらすること</h2>
            {detailStatus === 'loading' ? (
              <p className="text-ink-secondary text-sm">保存されている処理を読み込んでいます。</p>
            ) : detailStatus === 'error' ? (
              <ListState
                kind="error"
                title="届いた後の処理を表示できませんでした"
                description="設定は消えていません。詳細だけをもう一度読み込めます。"
                onRetry={() => setDetailReloadKey((key) => key + 1)}
              />
            ) : detail && detail.actions.length > 0 ? (
              <div className="space-y-2">
                {detail.actions.map((action, index) => (
                  <div key={`${action.refKind}-${index}`} className="bg-canvas-sunken rounded-control px-4 py-2">
                    <strong className="text-ink block text-sm">{incomingActionLabel(action.refKind)}</strong>
                    <span className="text-ink-secondary mt-1 block text-xs">{action.displayName}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ink-secondary text-sm">届いた後に動かす処理は、まだ設定されていません。</p>
            )}
          </div>
          </section>

          {/*
            N-367: 「未照合として確認する」「友だち候補を作る」を選んだ口に
            届いて、人が見つからなかったものをここへ置く。選び方が変わっても
            溜まった届物は残るので、残っている限り見せる。
            R400: 「何もしない」を選んでいても、未確認が残っていれば欄を出す。
            読めなかったときも欄ごと消さず、理由と読み直しを出す。
          */}
          {(detail && (detail.identityMatching.onNotFound !== 'do_nothing'
            || unmatched.length > 0
            || (detail.pendingUnmatched ?? 0) > 0
            || unmatchedStatus === 'error')) ? (
            <section className="bg-canvas border-hairline rounded-card border p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-ink text-lg font-bold">人が見つからなかった届物</h2>
                {(detail.pendingUnmatched ?? 0) > 0 ? (
                  <StatusBadge tone="warning" size="compact">
                    未確認 {detail.pendingUnmatched}件
                  </StatusBadge>
                ) : null}
              </div>
              {unmatchedStatus === 'loading' ? (
                <p className="text-ink-secondary text-sm">届物を読み込んでいます。</p>
              ) : unmatchedStatus === 'error' ? (
                <div className="space-y-2">
                  <p className="text-ink-secondary text-sm">届物を表示できませんでした。確認待ちの届物は消えていません。</p>
                  <Button variant="secondary" onClick={() => setUnmatchedReloadKey((key) => key + 1)}>
                    届物だけ読み直す
                  </Button>
                </div>
              ) : (unmatchedTotal ?? detail.pendingUnmatched ?? unmatched.length) === 0 ? (
                <p className="text-ink-secondary text-sm">いま確認が必要な届物はありません。</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {unmatched.map((item) => (
                      <li key={item.id} className="bg-canvas-sunken rounded-control flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                        <div className="min-w-0">
                          <strong className="text-ink block text-sm">
                            {item.kind === 'candidate'
                              ? '友だち候補'
                              : item.kind === 'ambiguous'
                                ? '2人以上に一致'
                                : '未照合'}・{formatReceivedAt(item.receivedAt)}
                          </strong>
                          <span className="text-ink-secondary mt-1 block text-xs">
                            {item.identityAttempts.length > 0
                              ? item.identityAttempts.map((attempt) => `${identityKindLabel(attempt.kind)}：${attempt.value}`).join('、')
                              : '照合に使える値が届いていません'}
                          </span>
                          {/*
                            S: 同じ値で2人以上に一致した届物は自動では動かさない。
                            どの友だちか候補から人が選ぶ。どれでもなければ閉じる。
                          */}
                          {item.kind === 'ambiguous' && item.candidates.length > 0 && canResolveUnmatched ? (
                            <ul className="mt-2 space-y-1">
                              {item.candidates.map((candidate) => (
                                <li key={candidate.friendId} className="flex items-center gap-2">
                                  <span className="text-ink text-xs">{candidate.displayName ?? candidate.friendId}</span>
                                  <Button
                                    variant="secondary"
                                    disabled={dismissingId !== null}
                                    onClick={() => void linkUnmatched(item, candidate.friendId)}
                                  >
                                    {dismissingId === item.id ? '結び付けています…' : 'この人に結び付ける'}
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        {canResolveUnmatched ? (
                          <Button
                            variant="secondary"
                            disabled={dismissingId !== null}
                            onClick={() => void dismissUnmatched(item)}
                          >
                            {dismissingId === item.id
                              ? '閉じています…'
                              : item.kind === 'ambiguous' ? 'どれでもない' : '確認した'}
                          </Button>
                        ) : (
                          <p className="text-ink-secondary text-xs">結び付け・確認は統括または管理者に頼んでください。</p>
                        )}
                        {/*
                          R399: 失敗の理由と次の行動は操作した行に出す。
                          失敗・警告の文は ? に入れず行に書く（直し方が要るため）。
                        */}
                        {unmatchedActionError && unmatchedActionError.id === item.id ? (
                          <p role="alert" className="text-danger w-full text-xs leading-5">{unmatchedActionError.message}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {/*
                    R401: 残りがあれば「ほかN件」と次への導線を出す。
                    空表示は残件0のときだけ（total が無い古い応答では件数表示で代用）。
                  */}
                  {(unmatchedTotal ?? detail.pendingUnmatched ?? 0) > unmatched.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-ink-secondary text-xs">
                        ほか{(unmatchedTotal ?? detail.pendingUnmatched ?? 0) - unmatched.length}件あります。
                      </p>
                      <Button
                        variant="secondary"
                        disabled={unmatchedMoreBusy}
                        onClick={() => {
                          setUnmatchedMoreBusy(true)
                          setUnmatchedShown((shown) => shown + UNMATCHED_PAGE_SIZE)
                        }}
                      >
                        {unmatchedMoreBusy ? '読み込んでいます…' : 'さらに表示'}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          <section className="bg-canvas border-hairline rounded-card border p-5">
            <h2 className="text-ink mb-2 text-lg font-bold">届いたデータの見かた</h2>
            {detailStatus === 'loading' ? (
              <p className="text-ink-secondary text-sm">いちばん最近届いた見本を読み込んでいます。</p>
            ) : detailStatus === 'error' ? (
              <p className="text-ink-secondary text-sm">見本を表示できませんでした。上の「詳細を再読み込み」をお試しください。</p>
            ) : detail?.latestSample ? (
              <>
                <p className="text-ink-secondary text-sm leading-6">
                  いちばん最近届いたものです。値は安全のため隠しています。項目名を差し込みに使えます。
                </p>
                <p className="text-ink-faint mt-2 text-xs">
                  {formatReceivedAt(detail.latestSample.receivedAt)} に届いたもの
                </p>
                <pre className="bg-ink text-canvas rounded-control mt-3 overflow-x-auto p-4 text-sm leading-6">{maskedSampleText(detail.latestSample.fields)}</pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.templateFields.map((field) => (
                    <code key={field.token} className="bg-accent-soft text-accent-deep rounded-control px-2 py-1 text-xs">
                      {field.token}
                    </code>
                  ))}
                </div>
                {detail.latestSample.truncated ? (
                  <p className="text-ink-faint mt-2 text-xs">項目が多いため、先頭50件まで表示しています。</p>
                ) : null}
              </>
            ) : (
              <div className="bg-canvas-sunken text-ink-faint rounded-control mt-3 p-4 text-sm">
                まだ受け取ったデータはありません
              </div>
            )}
          </section>

          <section>
            <h2 className="text-ink mb-2 text-base font-bold">そのほかの受け取り口</h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {items.filter((item) => item.id !== selected.id).map((item) => (
                <div key={item.id} className="bg-canvas border-hairline rounded-card flex items-center justify-between gap-3 border p-4">
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-label={`受け取り口「${item.name}」を見る`}
                  >
                    <strong className="text-ink block text-sm">{item.name}</strong>
                    <span className="text-ink-faint mt-1 block text-xs">{sourceName(item.sourceType)}</span>
                    <span className="text-ink-faint mt-1 block text-xs">{maskedEndpoint(endpointUrl(item.id))}</span>
                  </button>
                  <StatusBadge tone={item.isActive ? 'success' : 'neutral'} size="compact">
                    {item.isActive ? '動いています' : '止めています'}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4" aria-label="外部連携の案内">
          <GuideCard title="むずかしい言葉の言いかえ">
            <GuideTerm name="Webhook（ウェブフック）">何かが起きたら、決めたURLに知らせるしくみです</GuideTerm>
            <GuideTerm name="合言葉（署名）">ほかの人が勝手に送ってこないようにします</GuideTerm>
            <GuideTerm name="JSON（ジェイソン）">データの書き方の決まりです</GuideTerm>
          </GuideCard>
          <GuideCard title="つながる先">
            <GuideLink href="/tags">友だち属性</GuideLink>
            <GuideLink href="/templates">テンプレート</GuideLink>
            <GuideLink href="/automations">オートメーション</GuideLink>
            <GuideLink href="/webhooks?tab=interactions">やり取りの記録</GuideLink>
          </GuideCard>
          <GuideCard title="気をつけること" warning>
            <p>合言葉は人に見せないでください。知られると、第三者がデータを送れるようになります。</p>
            <p>人が見つからないと何も起きません。照合に使う値を先に確かめてください。</p>
          </GuideCard>
        </aside>
      </div>

      {/*
        S (#939 機能26): 届いたつもりで試す窓。見本のJSONで「どの人に届くか・
        何が動くか」を確かめるだけで、実際の処理は動かない。閉じ方は右上の×。
      */}
      <Dialog
        open={testOpen}
        title="届いたつもりで試す"
        description="見本のJSONで、どの人に届くかと何が動くかを確かめます。実際の処理は動きません。"
        onCancel={() => setTestOpen(false)}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void runIncomingTest()} disabled={testBusy || !testJson.trim()}>
              {testBusy ? '試しています…' : '試す'}
            </Button>
          </div>
        }
      >
        <label className="text-ink-secondary block text-xs" htmlFor="incoming-test-json">
          届いたつもりのJSON
        </label>
        <textarea
          id="incoming-test-json"
          className="border-hairline text-ink mt-1 h-36 w-full rounded-control border p-3 font-mono text-sm"
          value={testJson}
          onChange={(event) => setTestJson(event.target.value)}
          placeholder='{"friendId": "…"}'
        />
        {testError ? <p className="text-danger mt-2 text-sm" role="alert">{testError}</p> : null}
        {testResult ? (
          <div className="mt-4 space-y-3">
            <div>
              <strong className="text-ink text-sm">だれに届くか</strong>
              <p className="text-ink-secondary mt-1 text-sm">
                {testResult.match.status === 'matched'
                  ? '1人の友だちに一致しました'
                  : testResult.match.status === 'ambiguous'
                    ? `同じ値の友だちが${testResult.match.friendIds.length}人います。実際に届くと保留になり、人が選びます。`
                    : '一致する友だちがいません'}
              </p>
            </div>
            <div>
              <strong className="text-ink text-sm">動く予定の処理</strong>
              {testResult.actions.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {testResult.actions.map((action) => (
                    <li key={action.refIndex} className="text-sm">
                      <span className="text-ink">{incomingActionLabel(action.refKind)}：{action.displayName}</span>
                      {action.ok
                        ? <span className="text-ink-faint ml-2 text-xs">({action.plan?.length ?? 0}件の処理)</span>
                        : <span className="text-danger ml-2 text-xs">{action.error}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-secondary mt-1 text-sm">動く処理はまだ設定されていません</p>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}

function identityMatchingLabel(detail: IncomingWebhookDetail | null): string {
  if (!detail || detail.identityMatching.methods.length === 0) return '照合しない'
  return detail.identityMatching.methods.map((method) => ({
    harness_friend_id: '友だちIDで探す',
    external_customer_id: '外部サービスのお客様IDで探す',
    verified_email: 'メールアドレスで探す',
    verified_phone: '電話番号で探す',
  })[method.kind]).join('、')
}

function notFoundLabel(value: IncomingWebhookDetail['identityMatching']['onNotFound'] | undefined): string {
  return ({
    do_nothing: '何もしない',
    unmatched_box: '未照合として確認する',
    create_candidate: '友だち候補を作る',
  } as const)[value ?? 'do_nothing']
}

function identityKindLabel(kind: string): string {
  return ({
    harness_friend_id: '友だちID',
    external_customer_id: '外部サービスのお客様ID',
    verified_email: 'メールアドレス',
    verified_phone: '電話番号',
  } as Record<string, string>)[kind] ?? kind
}

function incomingActionLabel(kind: string): string {
  return ({
    common_action: '共通アクションを動かす',
    tag: 'タグを付ける',
    friend_field: '友だち情報を更新する',
    support_mark: '対応マークを付ける',
    template: 'テンプレートを送る',
    scenario: 'シナリオを開始する',
    reminder: 'リマインダを開始する',
    conversion: '成果を記録する',
    mileage_rule: 'マイルを付ける',
    score_rule: 'スコアを更新する',
    outgoing_webhook: '別のサービスへ知らせる',
    operator_notification: '担当者へ知らせる',
  } as Record<string, string>)[kind] ?? '保存済みの処理を動かす'
}

function formatReceivedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '受信時刻不明'
  return formatDateTime(date)
}

function maskedSampleText(fields: NonNullable<IncomingWebhookDetail['latestSample']>['fields']): string {
  const rows = fields.map((field) => {
    const name = field.path.replace(/^\$\.?/, '') || '$'
    return `"${name}": "${field.maskedValue}"`
  })
  return `{ ${rows.join(', ')} }`
}

function maskedEndpoint(value: string): string {
  const parts = value.split('/')
  const id = parts.pop() ?? ''
  return `${parts.join('/')}/${id.slice(0, 4)}•••`
}

function sourceName(value: string): string {
  return {
    booking: '予約サービス',
    form: 'アンケートツール',
    ec: 'ECサイト',
    line: 'LINE公式アカウント',
    payment: '決済サービス',
  }[value] ?? value ?? '送信元未設定'
}

function GuideCard({
  title,
  children,
  warning = false,
}: {
  title: string
  children: React.ReactNode
  warning?: boolean
}) {
  return (
    <section className={warning
      ? 'bg-warning-bg border-warning rounded-card space-y-3 border p-4 text-sm leading-6'
      : 'bg-canvas border-hairline rounded-card space-y-3 border p-4 text-sm leading-6'}>
      <h2 className={warning ? 'text-warning font-bold' : 'text-ink font-bold'}>{title}</h2>
      {children}
    </section>
  )
}

function GuideTerm({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <strong className="text-ink block">{name}</strong>
      <span className="text-ink-secondary">{children}</span>
    </div>
  )
}

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-action block font-bold">→ {children}</Link>
}
