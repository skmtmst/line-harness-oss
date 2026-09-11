'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IncomingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import { api, type IncomingWebhookDetail, type OutgoingWebhookOverview } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice, { type NoticeTone } from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, NameCell, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'

type LoadStatus = 'loading' | 'ready' | 'error'
type OutgoingFilter = 'all' | 'active' | 'paused' | 'failed'
type OutgoingSort = 'volume' | 'name'

const PAGE_SIZE = 5

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

function OutgoingKpis({
  items,
  incomingCount,
  summary,
  summaryStatus,
}: {
  items: OutgoingWebhookOverview[]
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

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4" data-design="KPIs">
      <SummaryCard
        title="こちらから送る"
        value={items.length}
        unit="本"
        detail={`止めているもの ${paused}本`}
        variant="v6"
      />
      <SummaryCard
        title="この30日に送った"
        value={summaryMissing ? null : summary?.outgoing ?? null}
        unit="回"
        detail={outgoingSuccess === null ? '集計を取得できませんでした' : `うち成功 ${outgoingSuccess.toLocaleString('ja-JP')}回`}
        loading={summaryLoading}
        variant="v6"
      />
      <SummaryCard
        title="返事がなかった"
        value={summaryMissing ? null : summary?.failed ?? null}
        unit="回"
        detail={failedNames ? `${failedNames}を確認` : 'いま確認が必要な送り先はありません'}
        badge={failedNames ? '確認' : undefined}
        badgeTone={failedNames ? 'danger' : 'neutral'}
        loading={summaryLoading}
        variant="v6"
      />
      <SummaryCard
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
  const [testingId, setTestingId] = useState<string | null>(null)
  /**
   * 「1回 試してみる」の結果(#506 中)。
   *
   * 以前は口の戻り値を読まず、成功も失敗も画面に何も出なかった。
   * 成功は届いた旨、失敗は「やり取りの記録」タブへの案内を出す。
   */
  const [testNotice, setTestNotice] = useState<{ tone: NoticeTone; message: string } | null>(null)

  const runTest = async (item: OutgoingWebhookOverview) => {
    if (!lineAccountId || testingId !== null) return
    setTestingId(item.id)
    setTestNotice(null)
    try {
      const response = await api.webhooks.outgoing.test(item.id, lineAccountId)
      if (response.success && response.data.delivered) {
        const status = response.data.responseStatus
        setTestNotice({
          tone: 'success',
          message: `「${item.name}」への試し送信が届きました${status === null ? '' : `(相手の応答 ${status})`}。`,
        })
      } else {
        const status = response.success ? response.data.responseStatus : null
        setTestNotice({
          tone: 'error',
          message: `「${item.name}」への試し送信は届きませんでした${status === null ? '' : `(相手の応答 ${status})`}。「やり取りの記録」タブで詳しく確認できます。`,
        })
      }
    } catch {
      setTestNotice({
        tone: 'error',
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

    ここは以前「設定」をもう一度押すまで閉じなかった。応答が返っても、
    画面の他の場所を押しても、Escape でも閉じない。この家の他の一覧
    (`reminders`・`tags-page-v4` が使う `components/shared/action-menu.tsx`、
    自前の `components/shared/folder-panel.tsx`)はどれも閉じる仕掛けを
    持っていて、**webhooks だけが持っていなかった。**同じ形に揃える。

    「選んだら閉じる」は入れない。押した瞬間に「止める」が消えると
    二重押しそのものが起こせなくなり、二重押し防止(page.tsx の
    togglingIdsRef)を見張っている試験の当て先が消えるため。送信中の
    見え方は #707 で別に扱う。
  */
  useEffect(() => {
    if (settingsId === null) return
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsId(null)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsId])

  return (
    <section aria-label="こちらから送る一覧">
      <OutgoingKpis
        items={items}
        incomingCount={incomingCount}
        summary={summary}
        summaryStatus={summaryStatus}
      />

      <p className="bg-accent-soft text-ink-secondary rounded-card mb-3 px-4 py-3 text-sm leading-6">
        「こちらから送る」は、うちで起きたことを相手に知らせます。「こちらで受け取る」は、相手で起きたことをうちに取り込みます。受け取る側のURLは、相手のサービスに貼ってください。
      </p>

      {testNotice ? (
        <div className="mb-3">
          <Notice tone={testNotice.tone} message={testNotice.message} onClose={() => setTestNotice(null)} />
        </div>
      ) : null}

      <ListToolbar
        searchPlaceholder="つなぎ先・送るタイミングで検索"
        searchValue={query}
        onSearchChange={setQuery}
      >
        <SelectField
          aria-label="外部連携の状態"
          value={filter}
          onChange={(event) => setFilter(event.target.value as OutgoingFilter)}
          options={[
            { value: 'all', label: `すべて ${items.length + incomingCount}` },
            { value: 'active', label: `動いている ${activeCount}` },
            { value: 'paused', label: `止めている ${pausedCount}` },
            { value: 'failed', label: `失敗あり ${failedCount}` },
          ]}
        />
        <SelectField
          aria-label="外部連携の並び順"
          value={sort}
          onChange={(event) => setSort(event.target.value as OutgoingSort)}
          options={[
            { value: 'volume', label: '送った回数が多い順' },
            { value: 'name', label: '名前順' },
          ]}
        />
      </ListToolbar>

      {status === 'loading' ? (
        <ListState kind="loading" title="こちらから送る設定を読み込んでいます" />
      ) : status === 'error' ? (
        <ListState
          kind="error"
          title="こちらから送る設定を表示できませんでした"
          description="登録内容は消えていません。再読み込みしても直らない場合はエラー報告へお知らせください。"
          action={<Button variant="secondary" onClick={onReload}>もう一度読み込む</Button>}
        />
      ) : items.length === 0 && !showCreate ? (
        <ListState
          kind="empty"
          title="まだ連携がありません"
          description="うちで起きたことを、ほかのサービスに知らせられます。右上の「送り先を追加」から作成してください。"
        />
      ) : visible.length === 0 ? (
        <ListState
          kind="empty"
          title="当てはまる送り先がありません"
          description="検索の言葉か、状態の絞り込みを変えてください。"
        />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th>つなぎ先</Th>
              <Th>いつ送るか</Th>
              <Th>送るもの</Th>
              <Th align="right">この30日</Th>
              <Th>ようす</Th>
              <Th>操作</Th>
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
                  <NameCell name={item.name} sub={maskedUrl(item.url)} />
                  <Td>{firstEventLabel(item)}</Td>
                  <Td>{payloadLabel(item)}</Td>
                  <Td align="right">
                    <span className="text-ink tabular-nums">
                      {item.deliverySummary.total.toLocaleString('ja-JP')}回
                    </span>
                    {item.deliverySummary.pending > 0 ? (
                      <span className="text-ink-faint block text-xs">
                        送信中 {item.deliverySummary.pending.toLocaleString('ja-JP')}回
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
                      <span className="text-ink-faint mt-1 block text-xs">
                        最終 {new Date(item.deliverySummary.lastResult.completedAt).toLocaleString('ja-JP')}
                      </span>
                    ) : null}
                  </Td>
                  <ActionCell>
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <Button variant="secondary" href="/webhooks?tab=interactions">
                        {item.deliverySummary.canRetry ? '失敗をやり直す' : '中身を見る'}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!lineAccountId || testingId !== null || !item.isActive}
                        onClick={() => void runTest(item)}
                      >{testingId === item.id ? '試しています…' : '1回 試してみる'}</Button>
                      <div className="relative" ref={settingsId === item.id ? settingsRef : null}>
                        <Button
                          variant="secondary"
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
                          <div className="bg-canvas border-hairline rounded-card absolute top-1/2 right-full z-10 mr-2 flex min-w-max -translate-y-1/2 gap-2 border p-2 shadow-lg">
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
                          <Button
                            variant="secondary"
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
                          <Button variant="secondary" onClick={() => onRotate(item)}>合言葉</Button>
                          <Button variant="secondary" onClick={() => onDelete(item)}>削除</Button>
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-faint text-sm">
          こちらから送る {filtered.length}本のうち {visible.length}本を表示
        </p>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      </div>
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
}: {
  items: IncomingWebhook[]
  status: LoadStatus
  showCreate: boolean
  lineAccountId: string | null
  endpointUrl: (id: string) => string
  onReload: () => void
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
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<IncomingWebhookDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading')
  const [detailReloadKey, setDetailReloadKey] = useState(0)
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

  if (status === 'loading') {
    return <ListState kind="loading" title="こちらで受け取る設定を読み込んでいます" />
  }
  if (status === 'error') {
    return (
      <ListState
        kind="error"
        title="こちらで受け取る設定を表示できませんでした"
        description="登録内容は消えていません。再読み込みしても直らない場合はエラー報告へ。"
        action={<Button variant="secondary" onClick={onReload}>こちらで受け取る設定を再読み込み</Button>}
      />
    )
  }
  if (!selected && !showCreate) {
    return (
      <ListState
        kind="empty"
        title="まだ受け取り口がありません"
        description="相手のサービスから知らせを受け取るURLを、右上の「受け取り口を追加」から作成してください。"
      />
    )
  }
  if (!selected) return null

  return (
    <section aria-label="こちらで受け取る詳細">
      <p className="bg-info-bg text-info rounded-card mb-4 px-4 py-3 text-sm leading-6">
        相手のサービスで起きたことを、うちに取り込みます。下のURLを相手に貼ってもらってください。合言葉は人に見せないでください。
      </p>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-4">
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
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2">
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
              <Button variant="secondary" onClick={() => onDelete(selected)}>削除</Button>
            </div>
          <div className="border-hairline mt-4 border-t pt-3.5">
            <h2 className="text-ink mb-3 text-lg font-bold">届いたらすること</h2>
            {detailStatus === 'loading' ? (
              <p className="text-ink-secondary text-sm">保存されている処理を読み込んでいます。</p>
            ) : detailStatus === 'error' ? (
              <ListState
                kind="error"
                title="届いた後の処理を表示できませんでした"
                description="設定は消えていません。詳細だけをもう一度読み込めます。"
                action={<Button variant="secondary" onClick={() => setDetailReloadKey((key) => key + 1)}>詳細を再読み込み</Button>}
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
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  return <Link href={href} className="text-accent-deep block font-bold">→ {children}</Link>
}
