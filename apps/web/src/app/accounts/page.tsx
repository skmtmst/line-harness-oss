'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import { AccountSwitchDialog } from '@/components/accounts/account-switcher'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import { useAccount } from '@/contexts/account-context'
import AccountHierarchy from './account-hierarchy'

type WebhookStatus = 'matched' | 'mismatched' | 'unconfigured' | 'unknown'

interface LineAccountListItem {
  id: string
  channelId: string
  name: string
  displayName: string
  pictureUrl: string | null
  basicId: string | null
  isActive: boolean
  loginChannelId: string | null
  liffId: string | null
  createdAt: string
  updatedAt: string
  stats: { friendCount: number; activeScenarios: number; messagesThisMonth: number }
  webhook?: { expectedUrl: string; actualUrl: string | null; active: boolean | null; status: WebhookStatus }
  ogSiteName: string | null
  ogDefaultDescription: string | null
  ogDefaultImageUrl: string | null
  friendCapacity?: number | null
  capacityWarnAt?: number | null
  iconUrl?: string | null
  parentLineAccountId: string | null
  plan?: {
    key: 'communication' | 'light' | 'standard' | 'unknown'
    label: string
    monthlyMessageLimit: number | null
    source: 'messaging-api-quota'
  }
}

const MERGED_TABS = [
  { key: 'accounts', label: 'アカウント一覧' },
  { key: 'hierarchy', label: 'LINEアカウント構成' },
]
const PAGE_SIZE = 20

function webhookLabel(status: WebhookStatus | undefined) {
  if (status === 'matched') return '一致（正常）'
  if (status === 'mismatched') return '不一致'
  if (status === 'unconfigured') return '未設定（不一致）'
  return '未確認'
}

function AccountsPageInner() {
  const { selectedAccountId, selectedAccount, setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [uniqueFriendCount, setUniqueFriendCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'friends' | 'name' | 'status'>('friends')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<LineAccountListItem | null>(null)
  const [switching, setSwitching] = useState<LineAccountListItem | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    const [accountsResult, summaryResult] = await Promise.allSettled([
      api.lineAccounts.list(),
      api.lineAccounts.summary(),
    ])
    if (accountsResult.status === 'fulfilled' && accountsResult.value.success) {
      setAccounts(accountsResult.value.data as unknown as LineAccountListItem[])
    } else {
      setError('アカウント情報の取得に失敗しました')
    }
    if (summaryResult.status === 'fulfilled' && summaryResult.value.success) {
      setUniqueFriendCount(summaryResult.value.data.uniqueFriendCount)
    } else {
      setUniqueFriendCount(null)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    const filtered = accounts.filter((account) =>
      !needle || [account.name, account.displayName, account.basicId, account.channelId]
        .some((value) => value?.toLocaleLowerCase('ja-JP').includes(needle)),
    )
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.displayName.localeCompare(b.displayName, 'ja')
      if (sort === 'status') return Number(b.isActive) - Number(a.isActive)
      return (b.stats?.friendCount ?? 0) - (a.stats?.friendCount ?? 0)
    })
  }, [accounts, query, sort])

  useEffect(() => { setPage(1) }, [query, sort])

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const pageItems = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const matchedCount = accounts.filter((account) => account.webhook?.status === 'matched').length
  const warningAccount = accounts.find((account) =>
    account.webhook?.status === 'mismatched' || account.webhook?.status === 'unconfigured',
  )

  const exportCsv = () => {
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
    const rows = [
      ['アカウント名', 'LINE ID', 'プラン', '友だち', 'Webhook', '状態'],
      ...shown.map((account) => [
        account.displayName,
        account.basicId ?? '',
        account.plan?.label ?? '取得できません',
        account.stats?.friendCount ?? 0,
        webhookLabel(account.webhook?.status),
        account.isActive ? '稼働中' : '停止中',
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(quote).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `line-accounts-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const confirmSwitch = () => {
    if (!switching) return
    setSelectedAccountId(switching.id)
    setSwitching(null)
    window.location.assign('/')
  }

  return (
    <div>
      {warningAccount && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-bg px-4 py-3 text-sm text-ink">
          <p className="min-w-0 flex-1 leading-5">
            <span className="mr-2 text-warning">⚠</span>
            <strong>「{warningAccount.displayName}」のWebhook URLが{warningAccount.webhook?.status === 'unconfigured' ? '設定されていません' : '一致していません'}</strong>
            <span className="ml-3 text-xs text-ink-secondary">当システムが発行したURLと、LINE公式アカウント側のURLを確認してください。</span>
          </p>
          <button onClick={() => setEditing(warningAccount)} className="cursor-pointer whitespace-nowrap rounded-control border border-hairline bg-canvas px-3 py-2 text-xs font-medium hover:bg-canvas-sunken">
            → 設定を確認する
          </button>
        </div>
      )}

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="接続アカウント" value={accounts.length} unit="件" note={`稼働中 ${accounts.filter((account) => account.isActive).length}`} />
        <Kpi label="友だち合計" value={uniqueFriendCount ?? accounts.reduce((sum, account) => sum + (account.stats?.friendCount ?? 0), 0)} unit="人" note={uniqueFriendCount == null ? '重複判定は未確認' : '重複を除く'} />
        <Kpi label="Webhook 一致" value={`${matchedCount} / ${accounts.length}`} warning={matchedCount !== accounts.length} note={`要確認 ${Math.max(0, accounts.length - matchedCount)}件`} />
      </div>

      {error && <div className="mb-4 rounded-card border border-danger/20 bg-danger-bg p-4 text-sm text-danger">{error}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary focus-within:border-accent">
          <span aria-hidden>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="アカウント名で検索" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint" />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-faint">
          <span className="whitespace-nowrap">並び順</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none">
            <option value="friends">友だちが多い順</option>
            <option value="name">アカウント名順</option>
            <option value="status">稼働中を先に表示</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-faint">
          <span className="whitespace-nowrap">期間</span>
          <select aria-label="集計期間" className="rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none"><option>過去30日</option></select>
        </label>
        <button onClick={exportCsv} disabled={shown.length === 0} className="ml-auto cursor-pointer whitespace-nowrap px-2 py-2 text-xs font-medium text-accent disabled:cursor-not-allowed disabled:opacity-40">⇩ CSVで書き出す</button>
      </div>

      <div className="min-h-[560px] overflow-hidden rounded-card border border-hairline bg-canvas">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-8" /><col className="w-[22%]" /><col className="w-[14%]" /><col className="w-[14%]" />
            <col className="w-[10%]" /><col className="w-[18%]" /><col className="w-[13%]" /><col className="w-12" />
          </colgroup>
          <thead><tr className="border-b border-hairline bg-canvas-sunken text-xs text-ink-faint">
            <th aria-label="並び替え" /><th className="px-2 py-3 font-medium">アカウント名</th>
            <th className="hidden px-2 py-3 font-medium lg:table-cell">LINE ID</th><th className="hidden px-2 py-3 font-medium lg:table-cell">プラン</th>
            <th className="px-2 py-3 font-medium">友だち</th><th className="px-2 py-3 font-medium">Webhook の一致</th>
            <th className="px-2 py-3 font-medium">状態</th><th aria-label="詳細" />
          </tr></thead>
          <tbody className="divide-y divide-hairline">
            {loading ? (
              <tr><td colSpan={8} className="p-10 text-center text-ink-faint">読み込み中…</td></tr>
            ) : pageItems.length === 0 ? (
              <tr><td colSpan={8} className="p-10 text-center text-ink-faint">{accounts.length === 0 ? '未設定のアカウントはありません' : '検索条件に一致するアカウントはありません'}</td></tr>
            ) : pageItems.map((account) => (
              <tr key={account.id} className="hover:bg-canvas-sunken">
                <td className="px-2 py-3 text-center text-ink-faint" title="並び替えはLINEアカウント構成から行えます">⠇</td>
                <td className="px-2 py-3"><div className="flex min-w-0 items-center gap-2"><button onClick={() => account.id === selectedAccountId ? setEditing(account) : setSwitching(account)} title={account.id === selectedAccountId ? `${account.displayName}の設定を開く` : `${account.displayName}へ切り替える`} className="min-w-0 max-w-full cursor-pointer truncate whitespace-nowrap font-semibold text-accent hover:underline">{account.displayName}</button>{account.id === selectedAccountId && <span className="shrink-0 rounded-pill bg-accent-soft px-2 py-1 text-[10px] font-semibold text-success">表示中</span>}</div></td>
                <td className="hidden truncate whitespace-nowrap px-2 py-3 text-xs text-ink-secondary lg:table-cell" title={account.basicId ?? account.channelId}>{account.basicId ?? account.channelId}</td>
                <td className={`hidden truncate whitespace-nowrap px-2 py-3 text-xs font-medium lg:table-cell ${account.plan?.key === 'unknown' || !account.plan ? 'text-ink-faint' : 'text-ink'}`} title={account.plan?.monthlyMessageLimit == null ? 'LINEからプラン判定情報を取得できませんでした' : `LINE APIの当月送信上限 ${account.plan.monthlyMessageLimit.toLocaleString('ja-JP')}通から自動判定`}>{account.plan?.label ?? '取得できません'}</td>
                <td className="whitespace-nowrap px-2 py-3 font-semibold tabular-nums">{(account.stats?.friendCount ?? 0).toLocaleString('ja-JP')} 人</td>
                <td className={`truncate whitespace-nowrap px-2 py-3 text-xs ${account.webhook?.status === 'matched' ? 'text-success' : account.webhook?.status === 'unknown' ? 'text-ink-faint' : 'text-warning'}`} title={`${webhookLabel(account.webhook?.status)}${account.webhook?.actualUrl ? `: ${account.webhook.actualUrl}` : ''}`}>{webhookLabel(account.webhook?.status)}</td>
                <td className="px-2 py-3"><span className={`inline-flex whitespace-nowrap rounded-pill px-2 py-1 text-xs font-medium ${account.isActive ? 'bg-accent-soft text-success' : 'bg-warning-bg text-warning'}`}>{account.isActive ? '稼働中' : '停止中'}</span></td>
                <td className="px-2 py-3 text-center"><button onClick={() => setEditing(account)} aria-label={`${account.displayName}の設定を開く`} className="h-7 w-7 cursor-pointer rounded-full border border-hairline text-ink-secondary hover:border-accent hover:text-accent">→</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && accounts.length > 0 && <p className="border-t border-hairline bg-info-bg px-4 py-3 text-xs leading-5 text-ink-secondary">ⓘ 「当システムが発行したWebhook URL」と「LINE公式アカウント側に実際に設定されているURL」をすべて照合しています。</p>}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-ink-faint">
          <span>全 {shown.length} 件</span><div className="flex items-center gap-2">
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="cursor-pointer rounded-control border border-hairline px-3 py-1.5 text-ink disabled:cursor-not-allowed disabled:opacity-40">前へ</button>
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent-soft font-medium text-success">{page}</span>
            <button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount} className="cursor-pointer rounded-control border border-hairline px-3 py-1.5 text-ink disabled:cursor-not-allowed disabled:opacity-40">次へ</button>
          </div>
        </div>
      </div>

      {editing && <AccountEditModal
        accountId={editing.id} initialName={editing.name} initialChannelId={editing.channelId}
        initialLoginChannelId={editing.loginChannelId} initialLiffId={editing.liffId}
        initialOgSiteName={editing.ogSiteName} initialOgDefaultDescription={editing.ogDefaultDescription}
        initialOgDefaultImageUrl={editing.ogDefaultImageUrl} initialFriendCapacity={editing.friendCapacity ?? null}
        initialCapacityWarnAt={editing.capacityWarnAt ?? null} initialIconUrl={editing.iconUrl ?? null}
        onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await Promise.all([load(), refreshAccounts()]) }}
      />}
      {switching && <AccountSwitchDialog current={selectedAccount} target={switching} onClose={() => setSwitching(null)} onConfirm={confirmSwitch} />}
    </div>
  )
}

function Kpi({ label, value, unit, note, warning = false }: { label: string; value: string | number; unit?: string; note: string; warning?: boolean }) {
  return <div className="rounded-card border border-hairline bg-canvas p-4">
    <p className="text-xs font-medium text-ink-faint">{label}</p>
    <p className={`mt-1 text-2xl font-bold tabular-nums ${warning ? 'text-warning' : 'text-ink'}`}>{typeof value === 'number' ? value.toLocaleString('ja-JP') : value}{unit && <span className="ml-1 text-xs font-normal text-ink-faint">{unit}</span>}</p>
    <p className="mt-1 text-xs text-ink-faint">{note}</p>
  </div>
}

function AccountsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  const tabs = <div data-design="Tabs"><MergedTabs basePath="/accounts" paramName="tab" tabs={MERGED_TABS} active={tab} /></div>
  if (tab === 'hierarchy') return <AccountHierarchy tabs={tabs} />
  return <div>
    <div data-design="Head"><Header
      title="アカウント"
      description="接続しているLINE公式アカウントと、アカウント同士の階層構成を管理します。チャネル設定とWebhookの状態も、この画面から確認できます。"
      action={<div className="flex items-center gap-3"><button disabled title="マニュアルは準備中です" className="whitespace-nowrap text-xs text-ink-faint opacity-70">▫ マニュアル</button><Link href="/accounts/new" className="cursor-pointer whitespace-nowrap rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent">＋ アカウントを追加</Link></div>}
    /></div>
    {tabs}
    <AccountsPageInner />
  </div>
}

export default function AccountsPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><AccountsPageHost /></Suspense>
}
