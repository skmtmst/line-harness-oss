'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { IncomingWebhook, OutgoingWebhook, WebhookInteractionSummary } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Pagination from '@/components/shared/pagination'
import SelectField from '@/components/shared/select-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, NameCell, Td, Th, TableHeadRow, Tr } from '@/components/shared/table'

type LoadStatus = 'loading' | 'ready' | 'error'
type OutgoingFilter = 'all' | 'active' | 'paused' | 'failed'
type OutgoingSort = 'recent' | 'name'

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

function firstEventLabel(item: OutgoingWebhook): string {
  const first = item.eventTypes[0]
  if (!first) return 'まだ決めていません'
  const label = EVENT_LABEL[first] ?? first
  return item.eventTypes.length > 1 ? `${label} ほか${item.eventTypes.length - 1}件` : label
}

function payloadLabel(item: OutgoingWebhook): string {
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

function matchesOutgoing(item: OutgoingWebhook, filter: OutgoingFilter, query: string): boolean {
  const matchesFilter = filter === 'all'
    || (filter === 'active' && item.isActive)
    || (filter === 'paused' && !item.isActive)
    || (filter === 'failed' && (item.consecutiveFailures ?? 0) > 0)
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
  items: OutgoingWebhook[]
  incomingCount: number
  summary: WebhookInteractionSummary | null
  summaryStatus: LoadStatus
}) {
  const paused = items.filter((item) => !item.isActive).length
  const failedNames = items
    .filter((item) => (item.consecutiveFailures ?? 0) > 0)
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
  onReload,
  onToggle,
  onRotate,
  onDelete,
}: {
  items: OutgoingWebhook[]
  status: LoadStatus
  showCreate: boolean
  summary: WebhookInteractionSummary | null
  summaryStatus: LoadStatus
  incomingCount: number
  onReload: () => void
  onToggle: (id: string, active: boolean) => void
  onRotate: (item: OutgoingWebhook) => void
  onDelete: (item: OutgoingWebhook) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OutgoingFilter>('all')
  const [sort, setSort] = useState<OutgoingSort>('recent')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const rows = items.filter((item) => matchesOutgoing(item, filter, query))
    return [...rows].sort((a, b) => sort === 'name'
      ? a.name.localeCompare(b.name, 'ja-JP')
      : b.updatedAt.localeCompare(a.updatedAt))
  }, [filter, items, query, sort])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const activeCount = items.filter((item) => item.isActive).length + incomingCount
  const pausedCount = items.filter((item) => !item.isActive).length
  const failedCount = items.filter((item) => (item.consecutiveFailures ?? 0) > 0).length

  useEffect(() => {
    setPage(1)
  }, [filter, query, sort])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

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
            { value: 'recent', label: '更新が新しい順' },
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
              const failed = (item.consecutiveFailures ?? 0) > 0
              const canActivate = item.hasSecret && isHttpsUrl(item.url)
              return (
                <Tr key={item.id}>
                  <NameCell name={item.name} sub={maskedUrl(item.url)} />
                  <Td>{firstEventLabel(item)}</Td>
                  <Td>{payloadLabel(item)}</Td>
                  <Td align="right">
                    <span className="text-ink-faint">—</span>
                    <span className="text-ink-faint block text-xs">接続別集計待ち</span>
                  </Td>
                  <Td>
                    <StatusBadge tone={failed ? 'danger' : item.isActive ? 'success' : 'neutral'} size="compact">
                      {failed ? '返事がありません' : item.isActive ? 'うまくいっています' : '止めています'}
                    </StatusBadge>
                    {failed && item.lastFailedAt ? (
                      <span className="text-ink-faint mt-1 block text-xs">
                        最終 {new Date(item.lastFailedAt).toLocaleString('ja-JP')}
                      </span>
                    ) : null}
                  </Td>
                  <ActionCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => onToggle(item.id, item.isActive)}
                        disabled={!item.isActive && !canActivate}
                        title={!item.isActive && !canActivate ? 'URLと合言葉を確かめてください' : undefined}
                      >
                        {item.isActive ? '止める' : '動かす'}
                      </Button>
                      <Button variant="secondary" onClick={() => onRotate(item)}>合言葉</Button>
                      <Button variant="secondary" onClick={() => onDelete(item)}>削除</Button>
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
  endpointUrl,
  onReload,
  onToggle,
  onRotate,
  onDelete,
}: {
  items: IncomingWebhook[]
  status: LoadStatus
  showCreate: boolean
  endpointUrl: (id: string) => string
  onReload: () => void
  onToggle: (id: string, active: boolean) => void
  onRotate: (item: IncomingWebhook) => void
  onDelete: (item: IncomingWebhook) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [items, selectedId])

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
      <p className="bg-accent-soft text-ink-secondary rounded-card mb-4 px-4 py-3 text-sm leading-6">
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
                <dt className="text-ink-faint text-xs">だれの出来事か</dt>
                <dd className="text-ink mt-1 text-sm">照合方法のAPI待ち</dd>
              </div>
              <div>
                <dt className="text-ink-faint text-xs">見つからなかったとき</dt>
                <dd className="text-ink mt-1 text-sm">設定のAPI待ち</dd>
              </div>
              <div>
                <dt className="text-ink-faint text-xs">合言葉</dt>
                <dd className="mt-1"><StatusBadge tone={selected.hasSecret ? 'success' : 'warning'} size="compact">{selected.hasSecret ? '設定済み（再表示しません）' : '未設定'}</StatusBadge></dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => onToggle(selected.id, selected.isActive)} disabled={!selected.hasSecret && !selected.isActive}>
                {selected.isActive ? '止める' : '動かす'}
              </Button>
              <Button variant="secondary" onClick={() => onRotate(selected)}>合言葉を更新</Button>
              <Button variant="secondary" onClick={() => onDelete(selected)}>削除</Button>
            </div>
          </section>

          <section className="bg-canvas border-hairline rounded-card border p-5">
            <h2 className="text-ink mb-3 text-lg font-bold">届いたらすること</h2>
            <p className="text-ink-secondary text-sm leading-6">
              この受け取り口に届いたあと動かす処理は、詳細APIがまだ無いため確かめられません。設定値が返るまでは、作り物のタグや配信を表示しません。
            </p>
          </section>

          <section className="bg-canvas border-hairline rounded-card border p-5">
            <h2 className="text-ink mb-2 text-lg font-bold">届いたデータの見かた</h2>
            <p className="text-ink-secondary text-sm leading-6">
              最近届いた本文を安全にマスクして返すAPIがまだありません。APIが接続されたら、ここに最新時刻・見本・差し込み項目を表示します。
            </p>
            <div className="bg-canvas-sunken text-ink-faint rounded-control mt-3 p-4 text-sm">
              届いたデータの見本はまだ表示できません
            </div>
          </section>

          <section>
            <h2 className="text-ink mb-2 text-base font-bold">そのほかの受け取り口</h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {items.filter((item) => item.id !== selected.id).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="bg-canvas border-hairline rounded-card flex items-center justify-between gap-3 border p-4 text-left"
                >
                  <span>
                    <strong className="text-ink block text-sm">{item.name}</strong>
                    <span className="text-ink-faint mt-1 block text-xs">{sourceName(item.sourceType)}</span>
                  </span>
                  <StatusBadge tone={item.isActive ? 'success' : 'neutral'} size="compact">
                    {item.isActive ? '動いています' : '止めています'}
                  </StatusBadge>
                </button>
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
