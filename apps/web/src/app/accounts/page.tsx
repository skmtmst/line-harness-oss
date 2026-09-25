'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SummaryCard from '@/components/shared/summary-card'
import StatusBadge from '@/components/shared/status-badge'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import AccountOrdering from '@/components/accounts/account-ordering'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  ACCOUNT_FILTERS,
  connectionLabel,
  hasConnectionProblem,
  matchesFilter,
  matchesQuery,
  parentName,
  webhookLabel,
  type AccountFilter,
} from './account-list-view'
import AccountMigration from './migration'
import ListRange from '@/components/ui/list-range'

type AccountWithStats = LineAccount & {
  stats?: { friendCount: number; activeScenarios: number; messagesThisMonth: number }
  timezone?: string
}

/**
 * LINEアカウントの一覧。設計 ★V6 33-1（`QT91v`）。
 *
 * **これまでここは `/hq` への転送だった。** 統括の店舗管理と、
 * LINE公式アカウントの設定は別のもの（要件 §5-3）。転送をやめて画面にする。
 */
export default function AccountsPage() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [orderingOpen, setOrderingOpen] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await api.lineAccounts.list()
      if (!res.success) { setStatus('error'); return }
      setAccounts(res.data)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(
    () => accounts.filter((a) => matchesFilter(a, filter) && matchesQuery(a, query)),
    [accounts, filter, query],
  )

  // アーカイブは停止と重ねて数えず、4枚の帯を互いに読み違えないようにする。
  const activeCount = accounts.filter((a) => a.isActive && !a.archivedAt).length
  const inactiveCount = accounts.filter((a) => !a.isActive && !a.archivedAt).length
  const archivedCount = accounts.filter((a) => Boolean(a.archivedAt)).length
  const problemCount = accounts.filter(hasConnectionProblem).length
  const activeFriendCounts = accounts
    .filter((account) => account.isActive && !account.archivedAt)
    .map((account) => account.stats?.friendCount)
  const activeFriendDetail = activeFriendCounts.every((count): count is number => typeof count === 'number')
    ? `友だち ${activeFriendCounts.join('・')}人`
    : '友だち数は未取得'

  if (searchParams.get('tab') === 'migration') return <AccountMigration />

  return (
    <div data-design-node="QT91v">
      <div data-design="Head" className="mb-4 flex min-h-10 flex-wrap items-center justify-between gap-3">
        {/* ★V7：上の帯の画面名と同じ1段だけのパンくずは出さない。 */}
        <div />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setOrderingOpen((open) => !open)}>
            {orderingOpen ? '並び順と親子を閉じる' : '並び順と親子を変える'}
          </Button>
          <Button href="/accounts/new" variant="primary">＋ LINEアカウントを登録</Button>
        </div>
      </div>

      {orderingOpen && <AccountOrdering />}

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {/* ★V7：「100%」の札は何の割合でもない固定の文字だったので外す。 */}
        <SummaryCard title="稼働中" value={activeCount} unit="" variant="v6"
          detail={activeFriendDetail} />
        <SummaryCard title="停止中" value={inactiveCount} unit="" variant="v6"
          detail="送受信を止めています" />
        <SummaryCard title="アーカイブ" value={archivedCount} unit="" variant="v6"
          detail="記録は残っています" />
        <SummaryCard title="接続に問題" value={problemCount} unit="" variant="v6"
          badge={problemCount > 0 ? '要対応' : undefined} badgeTone="danger"
          detail="Webhookが合っていません" />
      </div>

      <div className="bg-canvas rounded-card border-hairline mb-3 border p-3">
        {/*
          検索は独立した全幅の行にする（U019）。件数の札を隣に置くと、
          狭い幅でプレースホルダーが途中までしか見えなくなる。
        */}
        <div data-search-row>
          <SearchField
            placeholder="アカウント名・チャネルIDで検索"
            aria-label="アカウント名・チャネルIDで検索"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            className="w-full"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* ★V7：絞り込みは緑の塗りボタンではなく、他の一覧と同じ絞り込みの札にする。 */}
          {ACCOUNT_FILTERS.map((item) => (
            <FilterChip key={item.value} selected={filter === item.value} onChange={() => setFilter(item.value)}>
              {item.label}
            </FilterChip>
          ))}
          {/* 件数は結果の件数だけ。選べない件数の文字は置かない（★V7）。 */}
          <ListRange className="ml-auto whitespace-nowrap" total={shown.length} first={shown.length === 0 ? 0 : 1} last={shown.length} />
        </div>
      </div>

      {status === 'loading' ? (
        <ListState kind="loading" />
      ) : status === 'error' ? (
        <ListState
          kind="error"
          /*
            読み直しの押し口は `ListState` 側に足す途中（台帳 #7 / PR #757）。
            入るまでは `action` で出しておく。**失敗したときに、運用者が
            できることを必ず1つ置く。**
          */
          action={<Button type="button" onClick={() => void load()}>再読み込み</Button>}
        />
      ) : shown.length === 0 ? (
        <ListState
          kind="empty"
          title={accounts.length === 0 ? 'LINEアカウントがありません' : 'この条件に合うアカウントはありません'}
          description={accounts.length === 0
            ? '「＋ LINEアカウントを登録」から、送受信に使うアカウントを登録してください。'
            : '検索の言葉か、表示する状態を変えてください。'}
        />
      ) : (
        <div className="bg-canvas rounded-card border-hairline border">
          {/*
            U042: 768px 未満では表の右端の「詳細」へ横スクロールしないと
            届かなかった。スマホでは名前＋状態＋操作が先に見えるカードにし、
            細かい項目は開いて確認する形にする。
          */}
          <ul className="divide-hairline divide-y md:hidden" data-design="List">
            {shown.map((account) => {
              const connection = connectionLabel(account)
              const webhook = webhookLabel(account)
              return (
                <li key={account.id} className="p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink truncate text-sm font-medium" title={account.name}>{account.name}</p>
                      <p className="text-ink-faint mt-0.5 truncate text-xs">
                        チャネル {account.channelId}
                        {` ・ ${account.timezone ?? 'Asia/Tokyo'}`}
                      </p>
                    </div>
                    {/* #641: カード表示でも行操作は同じ枠つきボタン */}
                    <Button
                      href={`/accounts/detail?id=${account.id}`}
                      variant="secondary"
                      className="shrink-0"
                    >
                      詳細
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
                    <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
                    {account.isDefault ? <StatusBadge tone="success">既定</StatusBadge> : null}
                  </div>
                  <details className="mt-3">
                    <summary className="text-ink-secondary cursor-pointer text-xs font-semibold">詳しい情報を見る</summary>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-3"><dt className="text-ink-faint">友だち</dt><dd className="text-ink-secondary tabular-nums">{account.stats ? `${account.stats.friendCount.toLocaleString('ja-JP')}人` : '—'}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-ink-faint">親アカウント</dt><dd className="text-ink-secondary truncate" title={parentName(account, accounts)}>{parentName(account, accounts)}</dd></div>
                    </dl>
                  </details>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[56rem]">
            <thead>
              <TableHeadRow>
                {/*
                  表の外側の余白は左右で同じにする（左端 pl-5・右端 pr-5）。
                  操作列はボタン幅で固定し右へ寄せる。残りは中身の列で吸収する。
                */}
                <Th className="pl-5">アカウント</Th>
                <Th>接続状態</Th>
                <Th>Webhook</Th>
                <Th>友だち</Th>
                <Th>既定</Th>
                <Th>親アカウント</Th>
                <Th align="right" className="w-28 pr-5">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((account) => {
                const connection = connectionLabel(account)
                const webhook = webhookLabel(account)
                return (
                  <tr key={account.id} className="border-hairline hover:bg-canvas-sunken border-t align-middle">
                    <td className="py-3 pr-4 pl-5">
                      <p className="text-ink text-sm font-medium">{account.name}</p>
                      <p className="text-ink-faint mt-0.5 text-xs">
                        チャネル {account.channelId}
                        {` ・ ${account.timezone ?? 'Asia/Tokyo'}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm tabular-nums">
                      {account.stats ? `${account.stats.friendCount.toLocaleString('ja-JP')}人` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {account.isDefault
                        ? <StatusBadge tone="success">既定</StatusBadge>
                        : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {parentName(account, accounts)}
                    </td>
                    <td className="py-3 pr-5 pl-4 text-right whitespace-nowrap">
                      {/* #641: 行操作は枠つきボタンにそろえる。押せない「•••」の飾りは出さない */}
                      <Button href={`/accounts/detail?id=${account.id}`} variant="secondary">
                        詳細
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/*
        設計の締めの一言（`QT91v`）。**何を見ている画面かを、下に置く。**
      */}
      <div className="bg-canvas rounded-card border-hairline mt-3 border p-4">
        <p className="text-ink text-sm font-bold">ここで見えること</p>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          接続状態は、送受信ができる状態かどうか。Webhook は、LINE側に登録した受け口がこのシステムと合っているかどうかです。
          合っていないと、友だちからのメッセージが届きません。アーカイブしたアカウントは記録が残り、送受信だけを止めます。
        </p>
      </div>
    </div>
  )
}
