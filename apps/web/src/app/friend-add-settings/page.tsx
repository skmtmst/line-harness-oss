'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import type { FriendAddRule, FriendAddRuleKind, FriendAddRuleListData } from '@/lib/api'
import { api } from '@/lib/api'
import FriendAddRuleEditor from './friend-add-rule-editor'
import styles from './friend-add-settings.module.css'

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
    <div data-design-node="uLQQc" className={styles.page}>
      <div className={styles.topActions}><Button href="/friend-add-settings?view=new" variant="primary"><Plus size={16} />初回案内を作成</Button></div>

      <div className={styles.guide}>
        経路を確定できるのは「流入と計測」で発行したリンクから来た人だけです。素のQR・検索から来た人は「経路が分からなかった人」の設定が動きます。
      </div>

      <section className={styles.metrics} aria-label="この7日の状況">
        <Metric label="初回案内" value={countText(data?.summary.rules ?? 0, '件')} note={`有効 ${data?.summary.active ?? 0}件`} />
        <Metric label="直近7日の友だち追加" value={countText(data?.summary.recentAdds ?? null, '人')} note={`経路が取れた ${countText(data?.summary.captured ?? null, '人')}`} />
        <Metric label="送信成功" value={countText(data?.summary.delivered ?? null, '通')} note={successRate(data?.summary.delivered ?? null, data?.summary.failed ?? null)} />
        <Metric label="経路が分からなかった人" value={countText(data?.summary.unknownRoute ?? null, '人')} note="共通の案内が動いた" danger={(data?.summary.unknownRoute ?? 0) > 0} />
      </section>

      <div className={styles.tabs} role="tablist" aria-label="判定する人">
        {(Object.keys(KIND_LABELS) as FriendAddRuleKind[]).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={kind === tab} className={kind === tab ? styles.tabActive : styles.tab} onClick={() => router.replace(`/friend-add-settings?kind=${tab}`)}>
            {KIND_LABELS[tab]}
          </button>
        ))}
      </div>
      <p className={styles.tabNote}>この2つを分けないと、以前からのお客さまに「はじめまして」が届きます。</p>

      <div className={styles.content}>
        <aside className={styles.folders}>
          <div className={styles.folderTitle}><span>流入の束</span><span>{data?.items.length ?? 0}件</span></div>
          <div className={styles.folderSelected}><span>すべて</span><span>{data?.items.length ?? 0}</span></div>
          {folders.map(([name, count]) => <div key={name} className={styles.folder}><span>{name}</span><span>{count}</span></div>)}
        </aside>

        <section className={styles.list} aria-label={`${KIND_LABELS[kind]}の設定`}>
          <div className={styles.toolbar}>
            <label className={styles.search}><span className="sr-only">設定名・流入リンクで検索</span><input type="search" placeholder="設定名・流入リンクで検索" /></label>
            <Button variant="secondary" disabled>フォルダを追加</Button>
            <span className={styles.pageSize}>20件表示</span>
          </div>
          {!data || data.items.length === 0 ? (
            <ListState kind="empty" title="友だち追加時の配信がまだありません" description="最初の案内を作ると、ここに表示されます。" action={<Button href="/friend-add-settings?view=new" variant="primary">友だち追加時配信を作る</Button>} />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>設定名</th><th>状態</th><th>対象の流入リンク</th><th>最初に送るもの</th><th>直近7日</th><th>操作</th></tr></thead>
                <tbody>
                  {data.items.map((rule) => (
                    <tr key={rule.id}>
                      <td><a href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`} className={styles.ruleName}>{rule.name}</a><span className={styles.priority}>{rule.isFallback ? 'いちばん最後に動く・消せない' : `優先順位 ${rule.priority}`}</span></td>
                      <td><StatusBadge status={rule.status} fallback={rule.isFallback} /></td>
                      <td>{rule.isFallback ? '経路が取れなかったとき' : rule.routeNames.join('、') || 'すべての流入経路'}</td>
                      <td>{rule.definition.messageText ? 'テキストメッセージ' : rule.scenarioName || '未取得'}</td>
                      <td>{countText(rule.matchedLast7Days, '人')}</td>
                      <td>
                        <div className={styles.actions}>
                          <Button href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`} variant="secondary">編集</Button>
                          {!rule.isFallback && <button type="button" className={styles.iconButton} aria-label={`${rule.name}を削除`} onClick={() => setDeleting(rule)}><Trash2 size={16} /></button>}
                          <button type="button" className={styles.iconButton} aria-label={`${rule.name}のその他操作`}><MoreHorizontal size={18} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog open={Boolean(deleting)} designNode="Q3qP1r" title={`「${deleting?.name ?? ''}」を削除しますか？`} description="削除すると、このリンクから追加された人には「経路が分からなかった人」の共通あいさつが動きます。過去の実行履歴は監査記録として残り、この操作は取り消せません。" confirmLabel="削除する" destructive busy={deleteBusy} error={deleteError} titleIcon={<Trash2 size={20} />} onCancel={closeDelete} onConfirm={() => void archiveRule()} />
    </div>
  )
}

function Metric({ label, value, note, danger = false }: { label: string; value: string; note: string; danger?: boolean }) {
  return <div className={styles.metric}><span>{label}</span><strong className={danger ? styles.metricDanger : undefined}>{value}</strong><small>{note}</small></div>
}

function StatusBadge({ status, fallback }: { status: FriendAddRule['status']; fallback: boolean }) {
  const label = fallback ? '常に有効' : status === 'published' ? '有効' : status === 'draft' ? '下書き' : status === 'stopped' ? '停止中' : 'アーカイブ'
  return <span className={status === 'published' || fallback ? styles.statusActive : styles.statusMuted}>{label}</span>
}
