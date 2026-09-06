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
import PageHeader from '@/components/shared/page-header'
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

/**
 * LINEアカウントの一覧。設計 ★V6 33-1（`QT91v`）。
 *
 * **これまでここは `/hq` への転送だった。** 統括の店舗管理と、
 * LINE公式アカウントの設定は別のもの（要件 §5-3）。転送をやめて画面にする。
 */
export default function AccountsPage() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AccountFilter>('all')

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

  /*
    帯の数。**取れないものは `—`。** 友だち数を返す口がこの一覧に無いので、
    人数は数を作らず未取得として出す（`docs/v6-common-rules.md`
    「取れない数字を 0 にしない」）。
  */
  const activeCount = accounts.filter((a) => a.isActive && !a.archivedAt).length
  const inactiveCount = accounts.filter((a) => !a.isActive && !a.archivedAt).length
  const archivedCount = accounts.filter((a) => Boolean(a.archivedAt)).length
  const problemCount = accounts.filter(hasConnectionProblem).length

  if (searchParams.get('tab') === 'migration') return <AccountMigration />

  return (
    <div data-design-node="QT91v">
      <PageHeader
        breadcrumb={[{ label: '設定' }, { label: 'LINEアカウント' }]}
        title="LINEアカウント"
        description="送受信に使うLINE公式アカウントを登録し、接続の状態を確かめます。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled>並び順と親子を変える</Button>
            <Button href="/accounts/new" variant="primary">＋ LINEアカウントを登録</Button>
          </div>
        )}
      />

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard title="稼働中" value={activeCount} unit="件" variant="v6"
          detail="送受信できます" />
        <SummaryCard title="停止中" value={inactiveCount} unit="件" variant="v6"
          detail="送受信を止めています" />
        <SummaryCard title="アーカイブ" value={archivedCount} unit="件" variant="v6"
          detail="一覧の通常表示から外れています" />
        <SummaryCard title="接続に問題" value={problemCount} unit="件" variant="v6"
          badge={problemCount > 0 ? '要対応' : undefined} badgeTone="danger"
          detail="Webhookが合っていません" />
      </div>

      <div className="bg-canvas rounded-card border-hairline mb-3 border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            placeholder="アカウント名・チャネルIDで検索"
            aria-label="アカウント名・チャネルIDで検索"
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            className="min-w-64 flex-1"
          />
          <span className="border-hairline rounded-control border px-3 py-2 text-sm text-ink-secondary">
            20件表示
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {ACCOUNT_FILTERS.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={filter === item.value ? 'primary' : 'secondary'}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
          <span className="text-ink-faint ml-auto text-xs">{shown.length}件を表示</span>
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
        <div className="bg-canvas rounded-card border-hairline overflow-x-auto border">
          <table className="w-full min-w-[56rem]">
            <thead>
              <TableHeadRow>
                <Th>アカウント</Th>
                <Th>接続状態</Th>
                <Th>Webhook</Th>
                <Th>友だち</Th>
                <Th>既定</Th>
                <Th>親アカウント</Th>
                <Th>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {shown.map((account) => {
                const connection = connectionLabel(account)
                const webhook = webhookLabel(account)
                return (
                  <tr key={account.id} className="border-hairline hover:bg-canvas-sunken border-t align-top">
                    <td className="px-4 py-3">
                      <p className="text-ink text-sm font-medium">{account.name}</p>
                      <p className="text-ink-faint mt-0.5 text-xs">
                        チャネル {account.channelId}
                        {account.country ? ` ・ ${account.country}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={webhook.tone}>{webhook.label}</StatusBadge>
                    </td>
                    {/*
                      友だち数を返す口がこの一覧に無い。**0 と書かない。**
                      数えて 0 だったことと、数えていないことは別。
                    */}
                    <td className="text-ink-faint px-4 py-3 text-sm">—</td>
                    <td className="text-ink-faint px-4 py-3 text-sm">—</td>
                    <td className="text-ink-secondary px-4 py-3 text-sm">
                      {parentName(account, accounts)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/accounts/detail?id=${account.id}`} className="text-action text-sm hover:underline">
                        詳細
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        設計の締めの一言（`QT91v`）。**何を見ている画面かを、下に置く。**
      */}
      <div className="bg-canvas rounded-card border-hairline mt-3 border p-4">
        <p className="text-ink text-sm font-bold">ここで見えること</p>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          接続状態は、送受信ができる状態かどうか。Webhook は、LINE側に登録した受け口がこのシステムと合っているかどうかです。
          合っていないと、友だちからのメッセージが届きません。
        </p>
        {/*
          **出す＝使える。** 既定・アーカイブ・並び順と親子は、まだ口が無い。
          押し口を置かず、理由を本文で言う（`v6-common-rules.md` §7-10）。
        */}
        <p className="text-ink-faint mt-2 text-xs leading-relaxed">
          並び順と親子の変更は、保存する画面がまだ繋がっていません。友だち数と既定の表示は、
          一覧APIから値が届いたときだけ表示します。
        </p>
      </div>
    </div>
  )
}
