'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import IconButton from '@/components/shared/icon-button'
import ListToolbar from '@/components/shared/list-toolbar'
import ListState from '@/components/shared/list-state'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
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

function deliverySummary(rule: FriendAddRule) {
  const message = rule.definition.messageType === 'template'
    ? 'テンプレート'
    : rule.definition.messageType === 'form'
      ? '回答フォーム'
      : rule.definition.messageText ? 'テキスト' : null
  return [message, rule.scenarioName].filter(Boolean).join('＋') || '未取得'
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
  const [appliedSearch, setAppliedSearch] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null])
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const folderKey = useRef(crypto.randomUUID())
  const requestSequence = useRef(0)
  const cursor = cursorStack[cursorStack.length - 1]

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!selectedAccountId) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      // 検索とフォルダ絞りはサーバ側へ送る。取得済みページ内だけに効かせると
      // 21件目以降が検索に出ない。
      const response = await api.friendAddRules.list(selectedAccountId, kind, {
        cursor: cursor ?? undefined,
        limit: 20,
        q: appliedSearch.trim() || undefined,
        folder: folder ?? undefined,
      })
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setError(response.error)
        setData(null)
        return
      }
      setData(response.data)
    } catch {
      if (requestId !== requestSequence.current) return
      setError('友だち追加時の配信を読み込めませんでした。')
      setData(null)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [appliedSearch, cursor, folder, kind, selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => { setCursorStack([null]) }, [kind, selectedAccountId])

  // 検索の入力は少し待ってから、巻き戻しと一緒に1回だけサーバへ送る。
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search)
      setCursorStack([null])
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const selectFolder = (next: string | null) => {
    setFolder(next)
    setCursorStack([null])
  }

  useEffect(() => {
    if (!requestedDeleteId || !data) return
    setDeleting(data.items.find((item) => item.id === requestedDeleteId) ?? null)
  }, [data, requestedDeleteId])

  /*
   * フォルダ欄の件数はサーバの全ページ合計 (folderCounts)。取得済みページ内
   * で数えると、2ページ目以降があるときに件数が少なく見える。
   */
  const folders = useMemo(() => {
    const counts = new Map<string | null, number>()
    for (const entry of data?.folderCounts ?? []) counts.set(entry.name, entry.count)
    const rows: Array<{ key: string; name: string; count: number }> = []
    for (const option of data?.options.folders ?? []) {
      rows.push({ key: option.name, name: option.name, count: counts.get(option.name) ?? 0 })
    }
    const uncategorized = counts.get(null) ?? 0
    if (uncategorized > 0 || !rows.some((row) => row.name === '未分類')) {
      rows.push({ key: '__uncategorized', name: '未分類', count: uncategorized })
    }
    return rows
  }, [data])

  const createFolder = async () => {
    if (!selectedAccountId || folderBusy) return
    const name = folderName.trim()
    if (!name) return
    setFolderBusy(true)
    setError('')
    try {
      const response = await api.friendAddRules.createFolder(selectedAccountId, name, folderKey.current)
      if (!response.success) {
        setError(response.error)
        return
      }
      folderKey.current = crypto.randomUUID()
      setFolderName('')
      setFolderDialogOpen(false)
      await load()
    } catch {
      setError('フォルダを追加できませんでした。通信を確認して、もう一度お試しください。')
    } finally {
      setFolderBusy(false)
    }
  }

  // 検索はサーバ側で全ページに効かせる。ここでは表示絞りをしない。
  const visibleItems = useMemo(() => data?.items ?? [], [data])

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

      <div style={FOLDER_RAIL_STYLE} className="grid items-start gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        <FolderPanel
          total={`${data?.total ?? data?.items.length ?? 0}件`}
          activeId={folder ?? ''}
          onSelect={(id) => selectFolder(id || null)}
          onAddFolder={() => setFolderDialogOpen(true)}
          addFolderDisabled={folderBusy}
          rows={[
            { id: '', label: 'すべて', count: data?.total ?? data?.items.length ?? 0 },
            ...folders.map((entry) => ({ id: entry.key, label: entry.name, count: entry.count })),
          ]}
        />

        <section data-design="Rule" aria-label={`${KIND_LABELS[kind]}の設定`}>
          <span className="sr-only">判定の基準。はじめての人の判定。ブロック解除の判定。ブロック解除の回数が1回以上。</span>
          <ListToolbar searchPlaceholder="設定名で検索" searchValue={search} onSearchChange={setSearch}>
            <span className="text-ink-faint text-xs whitespace-nowrap">20件表示</span>
          </ListToolbar>
          {!data || data.items.length === 0 ? (
            appliedSearch.trim() || folder ? (
              <ListState kind="empty" title="条件に合う設定はありません" description="検索やフォルダの絞り込みを変えてください。" />
            ) : (
              <ListState kind="empty" title="友だち追加時の配信がまだありません" description="最初の案内を作ると、ここに表示されます。" action={<Button href="/friend-add-settings?view=new" variant="primary">友だち追加時配信を作る</Button>} />
            )
          ) : (
            <>
              <DataTable>
                <thead><TableHeadRow><Th>設定名</Th><Th>状態</Th><Th>対象の流入リンク</Th><Th>最初に送るもの</Th><Th>直近7日</Th><Th>操作</Th></TableHeadRow></thead>
                <tbody>
                  {visibleItems.map((rule) => (
                    <Tr key={rule.id}>
                      <NameCell name={<a href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`} className="text-ink block truncate font-bold">{rule.name}</a>} sub={rule.isFallback ? 'いちばん最後に動く・消せない' : `優先順位 ${rule.priority}`} />
                      <Td><StatusBadge tone={rule.status === 'published' || rule.isFallback ? 'success' : 'neutral'} size="compact">{rule.isFallback ? '常に有効' : rule.status === 'published' ? '有効' : rule.status === 'draft' ? '下書き' : rule.status === 'stopped' ? '停止中' : 'アーカイブ'}</StatusBadge></Td>
                      <Td>{rule.isFallback ? '経路が取れなかったとき' : rule.routeNames.join('、') || 'すべての流入経路'}</Td>
                      <Td>{deliverySummary(rule)}</Td>
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
              <div className="mt-3 flex items-center justify-end gap-2" aria-label="ページ送り">
                <Button disabled={cursorStack.length === 1 || loading} onClick={() => setCursorStack((current) => current.slice(0, -1))}>前へ</Button>
                <Button variant="primary" aria-current="page">{cursorStack.length}</Button>
                <Button disabled={!data.nextCursor || loading} onClick={() => data.nextCursor && setCursorStack((current) => [...current, data.nextCursor])}>次へ</Button>
              </div>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog open={Boolean(deleting)} designNode="Q3qP1r" title={`「${deleting?.name ?? ''}」を削除しますか？`} description="削除すると、このリンクから追加された人には「経路が分からなかった人」の共通あいさつが動きます。過去の実行履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleteBusy} error={deleteError} titleIcon={<Trash2 size={20} />} onCancel={closeDelete} onConfirm={() => void archiveRule()} />
      <ConfirmDialog
        open={folderDialogOpen}
        title="流入の束を追加"
        description="設定を整理するフォルダ名を入力してください。"
        confirmLabel="追加する"
        busy={folderBusy}
        onCancel={() => {
          setFolderDialogOpen(false)
          setFolderName('')
        }}
        onConfirm={folderName.trim() ? () => void createFolder() : undefined}
      >
        <label className="grid gap-2 text-sm font-bold">
          フォルダ名
          <input
            autoFocus
            className="rounded-control border-hairline bg-canvas border px-3 py-2 font-normal"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            maxLength={50}
          />
        </label>
      </ConfirmDialog>
    </div>
  )
}
