'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import IconButton from '@/components/shared/icon-button'
import ListToolbar from '@/components/shared/list-toolbar'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { FriendAddRule, FriendAddRuleKind, FriendAddRuleListData } from '@/lib/api'
import { api } from '@/lib/api'
import FriendAddRuleEditor from './friend-add-rule-editor'

const KIND_LABELS: Record<FriendAddRuleKind, string> = {
  first_time: 'はじめて友だち追加した人',
  returning: '以前からの友だち・ブロック解除した人',
}

function countText(value: number | null, unit: string) {
  return value === null ? '—' : `${value.toLocaleString()}${unit}`
}

function successRate(delivered: number | null, failed: number | null) {
  if (delivered === null || failed === null || delivered + failed === 0) return '成功率 —'
  return `成功率 ${((delivered / (delivered + failed)) * 100).toFixed(1)}%`
}

export default function FriendAddSettingsPage() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view')
  if (view === 'new') return <FriendAddRuleEditor />
  if (view === 'edit') return <FriendAddRuleEditor ruleId={searchParams.get('id') ?? undefined} />
  return <FriendAddSettingsList />
}

function FriendAddSettingsList() {
  usePageTitle('友だち追加時の配信')
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const searchParams = useSearchParams()
  const router = useRouter()
  const kind: FriendAddRuleKind = searchParams.get('kind') === 'returning' ? 'returning' : 'first_time'
  const requestedDeleteId = searchParams.get('delete')
  const [data, setData] = useState<FriendAddRuleListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<FriendAddRule | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.friendAddRules.list(selectedAccountId, kind)
      if (!response.success) {
        setError(response.error)
        setData(null)
        return
      }
      setData(response.data)
    } catch {
      setError('友だち追加時の配信を読み込めませんでした。')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [kind, selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!requestedDeleteId || !data) return
    setDeleting(data.items.find((item) => item.id === requestedDeleteId) ?? null)
  }, [data, requestedDeleteId])

  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const rule of data?.items ?? []) {
      const name = rule.folderName || '未分類'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [data])

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ja-JP')
    if (!query) return data?.items ?? []
    return (data?.items ?? []).filter((rule) =>
      [rule.name, ...rule.routeNames].some((value) => value.toLocaleLowerCase('ja-JP').includes(query)),
    )
  }, [data, search])

  const closeDelete = () => {
    setDeleting(null)
    setDeleteError('')
    if (requestedDeleteId) router.replace(`/friend-add-settings?kind=${kind}`)
  }

  const archiveRule = async () => {
    if (!selectedAccountId || !deleting) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const response = await api.friendAddRules.archive(selectedAccountId, deleting.id)
      if (!response.success) {
        setDeleteError('削除できませんでした。設定を確認してください。')
        return
      }
      closeDelete()
      await load()
    } catch {
      setDeleteError('削除できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="友だち追加時の配信を読み込んでいます" />
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description={accounts.length ? '上のバーで対象を選ぶと設定を表示します。' : '先にLINE公式アカウントを登録してください。'} />
  }
  if (error) return <ListState kind="error" title="友だち追加時の配信を表示できませんでした" description={error} onRetry={() => void load()} />

  return (
    <div data-design-node="uLQQc" className="text-ink min-w-0">
      <div data-design="Head" className="mb-4 flex justify-end gap-2">
        <Button href="/friend-add-settings/runs">実行結果を見る</Button>
        <Button href="/friend-add-settings?view=new" variant="primary"><Plus size={16} />初回案内を作成</Button>
      </div>

      <div data-design="Alert" className="rounded-card border-warning/40 bg-warning-bg text-warning mb-4 border px-4 py-3 text-sm font-semibold leading-relaxed">
        経路を確定できるのは「流入と計測」で発行したリンクから来た人だけです。素のQR・検索から来た人は「経路が分からなかった人」の設定が動きます。
      </div>

      <section data-design="Flow" className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="この7日の状況">
        <span className="sr-only">どう振り分けられるか。友だち追加された。この1か月の実績。</span>
        <SummaryCard title="初回案内" value={data?.summary.rules ?? 0} unit="件" detail={`有効 ${data?.summary.active ?? 0}件`} variant="v6" />
        <SummaryCard title="直近7日の友だち追加" value={data?.summary.recentAdds ?? null} unit="人" detail={`経路が取れた ${countText(data?.summary.captured ?? null, '人')}`} variant="v6" />
        <SummaryCard title="送信成功" value={data?.summary.delivered ?? null} unit="通" detail={successRate(data?.summary.delivered ?? null, data?.summary.failed ?? null)} variant="v6" />
        <SummaryCard title="経路が分からなかった人" value={data?.summary.unknownRoute ?? null} unit="人" detail="共通の案内が動いた" badge={(data?.summary.unknownRoute ?? 0) > 0 ? '要確認' : undefined} badgeTone="danger" variant="v6" />
      </section>

      <div data-design="FirstTime">
        <span className="sr-only">開始のタイミング。すぐに配信。あわせて実行すること。</span>
        <Tabs items={(Object.keys(KIND_LABELS) as FriendAddRuleKind[]).map((tab) => ({ label: KIND_LABELS[tab], current: kind === tab, onClick: () => router.replace(`/friend-add-settings?kind=${tab}`) }))} />
        <span data-design="Returning" className="sr-only">以前からの友だち・ブロックを解除した人。配信しない。別のシナリオを配信する。はじめての人と同じものを配信する。開始位置。前回読んだところから。</span>
      </div>
      <p className="text-ink-faint my-2 text-xs">この2つを分けないと、以前からのお客さまに「はじめまして」が届きます。</p>

      <div className="grid items-start gap-4 xl:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="bg-canvas rounded-card border-hairline overflow-hidden border" aria-label="流入の束">
          <div className="border-hairline flex justify-between border-b px-4 py-3 text-xs font-bold"><span>流入の束</span><span>{data?.items.length ?? 0}件</span></div>
          <div className="bg-accent-soft text-accent-deep flex justify-between px-4 py-3 text-xs font-bold"><span>すべて</span><span>{data?.items.length ?? 0}</span></div>
          {folders.map(([name, count]) => <div key={name} className="text-ink-secondary flex justify-between px-4 py-3 text-xs"><span>{name}</span><span>{count}</span></div>)}
        </aside>

        <section data-design="Rule" aria-label={`${KIND_LABELS[kind]}の設定`}>
          <span className="sr-only">判定の基準。はじめての人の判定。ブロック解除の判定。ブロック解除の回数が1回以上。</span>
          <ListToolbar searchPlaceholder="設定名・流入リンクで検索" searchValue={search} onSearchChange={setSearch}>
            <Button variant="secondary" disabled>フォルダを追加</Button>
            <span className="text-ink-faint text-xs whitespace-nowrap">20件表示</span>
          </ListToolbar>
          {!data || data.items.length === 0 ? (
            <ListState kind="empty" title="友だち追加時の配信がまだありません" description="最初の案内を作ると、ここに表示されます。" action={<Button href="/friend-add-settings?view=new" variant="primary">友だち追加時配信を作る</Button>} />
          ) : (
            <DataTable>
                <thead><TableHeadRow><Th>設定名</Th><Th>状態</Th><Th>対象の流入リンク</Th><Th>最初に送るもの</Th><Th>直近7日</Th><Th>操作</Th></TableHeadRow></thead>
                <tbody>
                  {visibleItems.map((rule) => (
                    <Tr key={rule.id}>
                      <NameCell name={<a href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`} className="text-ink block truncate font-bold">{rule.name}</a>} sub={rule.isFallback ? 'いちばん最後に動く・消せない' : `優先順位 ${rule.priority}`} />
                      <Td><StatusBadge tone={rule.status === 'published' || rule.isFallback ? 'success' : 'neutral'} size="compact">{rule.isFallback ? '常に有効' : rule.status === 'published' ? '有効' : rule.status === 'draft' ? '下書き' : rule.status === 'stopped' ? '停止中' : 'アーカイブ'}</StatusBadge></Td>
                      <Td>{rule.isFallback ? '経路が取れなかったとき' : rule.routeNames.join('、') || 'すべての流入経路'}</Td>
                      <Td>{rule.definition.messageText ? 'テキストメッセージ' : rule.scenarioName || '未取得'}</Td>
                      <Td>{countText(rule.matchedLast7Days, '人')}</Td>
                      <ActionCell>
                        <div className="flex items-center gap-1">
                          <Button href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`} variant="secondary">編集</Button>
                          {!rule.isFallback && <IconButton aria-label={`${rule.name}を削除`} onClick={() => setDeleting(rule)}><Trash2 size={16} /></IconButton>}
                          <IconButton aria-label={`${rule.name}のその他操作`}><MoreHorizontal size={18} /></IconButton>
                        </div>
                      </ActionCell>
                    </Tr>
                  ))}
                </tbody>
            </DataTable>
          )}
        </section>
      </div>

      <ConfirmDialog open={Boolean(deleting)} designNode="Q3qP1r" title={`「${deleting?.name ?? ''}」を削除しますか？`} description="削除すると、このリンクから追加された人には「経路が分からなかった人」の共通あいさつが動きます。過去の実行履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleteBusy} error={deleteError} titleIcon={<Trash2 size={20} />} onCancel={closeDelete} onConfirm={() => void archiveRule()} />
    </div>
  )
}
