'use client'

/*
 * ★V8-B マイル「たまる決めごと」（板 `OC0gy`、状態 `zaqP9`、
 * 1152 `ZJIyl`、閲覧のみ `E2Any`）。
 *
 * データの口は v7（page.tsx の earning-rules 節）と同じ口へ取りに行く。
 * 違いは置き場と見せ方——数の帯は4マス一体、作るボタンはフォルダの列の上、
 * 表は「何をしてくれたら・対象の行動・たまるマイル・有効期間・この30日・
 * 状態・操作（↑↓…）」。操作は1つも落とさない（編集・テスト・停止／再開・
 * 公開・削除・並び順の保存・CSV）。
 *
 * フォルダの列に割り当てる API は無いので、きっかけの種類で分けた
 * 見え方の切り替えとして Djb で持つ（保存はしない。LANE-F の
 * アフィリエイターと違い、ここは絞り込みだけなので描ける）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  Coins,
  Download,
  Gift,
  Info,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Wallet,
} from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { adminSessionHeaders } from '@/lib/admin-session'
import Button from '@/components/shared/button'
import FolderPanel from '@/components/shared/folder-panel'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import ActionMenu from '@/components/shared/action-menu'
import {
  api,
  type MileageAdminHistory,
  type MileageEarningRuleTestResult,
  type MileageEarningRuleV6,
  type MileageEarningRulesV6Overview,
} from '@/lib/api'
import { isMileageFriendsV6Overview } from './friends-overview-guard'
import { ruleEventLabel } from './earning-rule-view'
import { formatMileageDate, formatMileageMonthDay, formatMileageNumber } from './mileage-display'
import type { MileageV8TabKey } from './mileage-v8'
import { describeMileageCsvExportFailure } from './mileage-response-state'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { V8CreateButton } from './mileage-v8'
import styles from './mileage-v8.module.css'

const EVENT_LABELS: Record<string, string> = {
  friend_added: '友だち追加',
  message_received: 'メッセージ',
  link_clicked: 'リンククリック',
  broadcast_link_clicked: '配信リンククリック',
  form_submitted: 'フォーム',
  booking_created: '予約',
  affiliate_conversion_approved: '紹介成果',
  webinar_watch_5m: 'ウェビナー',
  webinar_watch_15m: 'ウェビナー',
  webinar_completed: 'ウェビナー完了',
  webinar_cta_clicked: 'ウェビナーCTA',
  instagram_dm_received: 'Instagram DM',
  instagram_comment_created: 'Instagramコメント',
  instagram_story_mentioned: 'ストーリーズ',
  instagram_line_returned: 'LINE帰還',
  inflow_return: 'LINE帰還',
  friend_registered: '友だち登録',
  friend_following_7d: '継続7日',
  friend_following_30d: '継続30日',
  friend_following_90d: '継続90日',
  friend_following_180d: '継続180日',
  friend_following_365d: '継続1年',
  purchase_completed: '購入完了',
}

/* フォルダの列の分け方（きっかけの種類。Djb の切り替えで保存はしない）。 */
const FOLDER_PURCHASE = new Set(['purchase_completed'])
const FOLDER_REACTION = new Set([
  'link_clicked', 'broadcast_link_clicked', 'message_received', 'form_submitted',
  'webinar_watch_5m', 'webinar_watch_15m', 'webinar_completed', 'webinar_cta_clicked',
  'instagram_dm_received', 'instagram_comment_created', 'instagram_story_mentioned',
])
const FOLDER_REFERRAL = new Set([
  'friend_added', 'friend_registered', 'affiliate_conversion_approved',
  'inflow_return', 'instagram_line_returned',
])

type FolderKey = 'all' | 'purchase' | 'reaction' | 'referral' | 'other'

function folderOf(rule: MileageEarningRuleV6): Exclude<FolderKey, 'all'> {
  const event = rule.draft.eventType
  if (FOLDER_PURCHASE.has(event)) return 'purchase'
  if (FOLDER_REACTION.has(event)) return 'reaction'
  if (FOLDER_REFERRAL.has(event)) return 'referral'
  return 'other'
}

const FOLDERS: Array<{ key: FolderKey; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'purchase', label: '購入' },
  { key: 'reaction', label: '配信の反応' },
  { key: 'referral', label: '紹介' },
  { key: 'other', label: '未分類' },
]

function isOverview(value: unknown): value is MileageEarningRulesV6Overview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageEarningRulesV6Overview>
  return Array.isArray(candidate.items)
    && !!candidate.pagination
    && typeof candidate.pagination.total === 'number'
    && typeof candidate.unassignedLegacyCount === 'number'
}

function dateOnlyDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function grantedMiles30d(rule: MileageEarningRuleV6) {
  return rule.metrics30d.grantedMiles
}

/* 有効期間・失効の1行（板：1年・12/31）。 */
function validityText(rule: MileageEarningRuleV6): string {
  const days = rule.draft.expiresAfterDays
  const span = days == null ? '失効なし' : days >= 365 && days % 365 === 0
    ? `${days / 365}年`
    : `${formatMileageNumber(days)}日`
  const until = rule.draft.validUntil
    ? formatMileageMonthDay(rule.draft.validUntil)
    : '期限なし'
  return `${span}・${until}`
}

type SortKey = 'order' | 'granted' | 'name' | 'amount'

const PRESETS: Array<{ value: string; label: string; active: boolean; pending: boolean; sort: SortKey }> = [
  { value: 'default', label: 'よく使う絞り込み', active: false, pending: false, sort: 'order' },
  { value: 'active-granted', label: '動いている・付いたマイルが多い順', active: true, pending: false, sort: 'granted' },
  { value: 'active-name', label: '動いている・名前順', active: true, pending: false, sort: 'name' },
  { value: 'stopped', label: '止めているのみ', active: false, pending: false, sort: 'order' },
  { value: 'pending', label: '確定待ちありのみ', active: false, pending: true, sort: 'order' },
]

export default function V8EarningRulesTab({
  readonly,
  registerHeaderActions,
  registerTabCount,
}: {
  readonly: boolean
  registerHeaderActions: (node: ReactNode) => void
  registerTabCount: (key: MileageV8TabKey, text: string | null) => void
}) {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    latestAccountRef.current = selectedAccountId
  }, [selectedAccountId])
  const generationRef = useRef(0)
  const [rules, setRules] = useState<MileageEarningRuleV6[]>([])
  const [grantedMiles, setGrantedMiles] = useState<number | null>(null)
  const [grantedCount, setGrantedCount] = useState<number | null>(null)
  const [spentMiles, setSpentMiles] = useState<number | null>(null)
  const [spentCount, setSpentCount] = useState<number | null>(null)
  const [balanceTotal, setBalanceTotal] = useState<number | null>(null)
  const [friendTotal, setFriendTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState<FolderKey>('all')
  const [activeOnly, setActiveOnly] = useState(false)
  const [pendingOnly, setPendingOnly] = useState(false)
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('order')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [menuNotice, setMenuNotice] = useState('')
  const [publishTarget, setPublishTarget] = useState<MileageEarningRuleV6 | null>(null)
  const [publishError, setPublishError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<MileageEarningRuleV6 | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [testTarget, setTestTarget] = useState<MileageEarningRuleV6 | null>(null)
  const [testResult, setTestResult] = useState<MileageEarningRuleTestResult | null>(null)
  const [testBusy, setTestBusy] = useState(false)
  const [testError, setTestError] = useState('')
  const [ruleOrder, setRuleOrder] = useState<string[]>([])
  const [orderDirty, setOrderDirty] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: orderDirty, busy: savingOrder })

  const load = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    const generation = ++generationRef.current
    const isStale = () =>
      generation !== generationRef.current || accountAtRequest !== latestAccountRef.current
    if (!accountAtRequest) {
      setRules([])
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    try {
      const [res, historyRes, friendsRes] = await Promise.all([
        api.mileage.earningRulesV6({ accountId: accountAtRequest, limit: 100, offset: 0 }),
        api.mileage.history({
          accountId: accountAtRequest,
          from: dateOnlyDaysAgo(29),
          to: dateOnlyDaysAgo(0),
          limit: 1,
          offset: 0,
        }),
        api.mileage.friendsV6({ accountId: accountAtRequest, limit: 1, offset: 0 }),
      ])
      if (isStale()) return
      if (!res.success || !isOverview(res.data)) throw new Error('invalid_mileage_rules')
      if (!historyRes.success || !friendsRes.success || !isMileageFriendsV6Overview(friendsRes.data)) {
        throw new Error('invalid_mileage_rule_summary')
      }
      const items = [...res.data.items]
      const total = res.data.pagination.total
      while (items.length < total) {
        const next = await api.mileage.earningRulesV6({
          accountId: accountAtRequest, limit: 100, offset: items.length,
        })
        if (isStale()) return
        if (!next.success || !isOverview(next.data)) throw new Error('invalid_mileage_rules')
        if (next.data.items.length === 0) break
        items.push(...next.data.items)
      }
      if (isStale()) return
      const byType = (historyRes.data as MileageAdminHistory).summary.byType
      const grant = byType.find((item) => item.entryType === 'grant')
      const spend = byType.find((item) => item.entryType === 'spend')
      setRules(items)
      setGrantedMiles(grant?.amount ?? 0)
      setGrantedCount(grant?.count ?? 0)
      setSpentMiles(spend?.amount ?? 0)
      setSpentCount(spend?.count ?? 0)
      setBalanceTotal(friendsRes.data.summary.available)
      setFriendTotal(friendsRes.data.summary.totalMembers)
      setRuleOrder(items.map((rule) => rule.id))
      setOrderDirty(false)
      setPage(1)
    } catch {
      if (isStale()) return
      setRules([])
      setLoadError(true)
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const resetPage = (change: () => void) => {
    setPage(1)
    change()
  }

  const exportCsv = useCallback(async () => {
    if (!selectedAccountId || exporting) return
    setExporting(true)
    setActionError('')
    let exportStatus: number | null = null
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/mileage/rules/export?accountId=${encodeURIComponent(selectedAccountId)}`,
        { credentials: 'include', headers: adminSessionHeaders() },
      )
      if (!res.ok) {
        exportStatus = res.status
        throw new Error('export_failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mileage-earning-rules-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionError(describeMileageCsvExportFailure(exportStatus))
    } finally {
      setExporting(false)
    }
  }, [exporting, selectedAccountId])

  useEffect(() => {
    registerHeaderActions(
      <Button onClick={() => void exportCsv()} disabled={exporting || rules.length === 0}>
        <Download size={14} aria-hidden="true" /> CSV で書き出す
      </Button>,
    )
    return () => registerHeaderActions(null)
  }, [exportCsv, exporting, registerHeaderActions, rules.length])

  /* タブの名の横の件数。読み直し中・失敗時は消す。 */
  useEffect(() => {
    registerTabCount('earning-rules', loading || loadError ? null : formatMileageNumber(rules.length))
  }, [loading, loadError, registerTabCount, rules.length])

  const activeRules = useMemo(() => rules.filter((rule) => rule.published.status === 'published'), [rules])
  const pendingRules = useMemo(() => rules.filter((rule) => rule.draft.initialStatus === 'pending'), [rules])
  const folderCounts = useMemo(() => {
    const counts = new Map<FolderKey, number>()
    counts.set('all', rules.length)
    for (const item of FOLDERS) {
      if (item.key === 'all') continue
      counts.set(item.key, rules.filter((rule) => folderOf(rule) === item.key).length)
    }
    return counts
  }, [rules])

  const shown = useMemo(() => {
    const keyword = search.trim()
    const filtered = rules.filter((rule) => {
      if (folder !== 'all' && folderOf(rule) !== folder) return false
      if (activeOnly && rule.published.status !== 'published') return false
      if (stoppedOnly && rule.published.status === 'published') return false
      if (pendingOnly && rule.draft.initialStatus !== 'pending') return false
      if (keyword && !rule.draft.name.includes(keyword)) return false
      return true
    })
    const order = new Map(ruleOrder.map((id, index) => [id, index]))
    return [...filtered].sort((a, b) => {
      if (sort === 'granted') return grantedMiles30d(b) - grantedMiles30d(a)
      if (sort === 'name') return a.draft.name.localeCompare(b.draft.name, 'ja')
      if (sort === 'amount') return b.draft.amount - a.draft.amount
      return (order.get(a.id) ?? a.draft.sortOrder) - (order.get(b.id) ?? b.draft.sortOrder)
    })
  }, [activeOnly, folder, pendingOnly, stoppedOnly, ruleOrder, rules, search, sort])

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const visible = shown.slice((page - 1) * pageSize, page * pageSize)
  const presetValue = PRESETS.find((p) =>
    p.active === activeOnly && p.pending === pendingOnly && p.stopped === stoppedOnly && p.sort === sort)?.value ?? 'custom'

  const moveRule = (id: string, direction: -1 | 1) => {
    if (readonly || folder !== 'all' || activeOnly || pendingOnly || stoppedOnly || search.trim() || sort !== 'order') return
    setRuleOrder((current) => {
      const index = current.indexOf(id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
    setOrderDirty(true)
  }

  const saveOrder = async () => {
    if (!selectedAccountId || savingOrder || !orderDirty) return
    setSavingOrder(true)
    try {
      const response = await api.mileage.saveEarningRulesOrder({ accountId: selectedAccountId, ids: ruleOrder })
      if (!response.success) throw new Error(response.error)
      await load()
    } catch {
      setActionError('並び順を保存できませんでした。最新の状態を読み直してから、もう一度お試しください。')
      await load().catch(() => {})
    } finally {
      setSavingOrder(false)
    }
  }

  const toggleRule = async (rule: MileageEarningRuleV6) => {
    if (readonly) return
    setSavingId(rule.id)
    setActionError('')
    try {
      const res = await api.mileage.updateRule(rule.id, { isActive: rule.published.status !== 'published' })
      if (!res.success) throw new Error(res.error)
      await load()
    } catch {
      setActionError('たまる決めごとを更新できませんでした。もう一度お試しください。')
    } finally {
      setSavingId(null)
    }
  }

  const deleteRule = async (rule: MileageEarningRuleV6) => {
    if (readonly || savingId !== null) return
    setSavingId(rule.id)
    setDeleteError('')
    try {
      const res = await api.mileage.deleteRule(rule.id)
      if (!res.success) throw new Error(res.error)
      setDeleteTarget(null)
      await load()
    } catch (caught) {
      setDeleteError(caught instanceof Error && caught.message && !/^API error/.test(caught.message)
        ? caught.message
        : '削除できませんでした。もう一度お試しください。')
    } finally {
      setSavingId(null)
    }
  }

  const publishRule = async (rule: MileageEarningRuleV6) => {
    if (readonly || !selectedAccountId || savingId !== null) return
    setSavingId(rule.id)
    setPublishError('')
    try {
      const res = await api.mileage.publishEarningRule(rule.id, {
        accountId: selectedAccountId,
        expectedVersion: rule.draftVersion,
        idempotencyKey: crypto.randomUUID(),
      })
      if (!res.success) throw new Error(res.error)
      setPublishTarget(null)
      await load()
    } catch {
      setPublishError('公開できませんでした。下書きを読み直して内容を確かめてから、もう一度お試しください。')
    } finally {
      setSavingId(null)
    }
  }

  /*
   * 行の「…」の「複製」。今の決めごとの写しを止めた状態で1つ作る
   * （作りかけの口と写しの口を続けて叩く。公開はしない）。
   */
  const duplicateRule = async (rule: MileageEarningRuleV6) => {
    if (readonly || !selectedAccountId || savingId !== null) return
    setSavingId(rule.id)
    setActionError('')
    setMenuNotice('')
    try {
      const name = `${rule.draft.name} のコピー`
      const created = await api.mileage.createRule({
        name,
        eventType: rule.draft.eventType,
        source: rule.draft.source,
        amount: rule.draft.amount,
        initialStatus: rule.draft.initialStatus,
        lineAccountId: selectedAccountId,
        conditions: {},
        validFrom: rule.draft.validFrom,
        validUntil: rule.draft.validUntil,
        isActive: false,
      })
      if (!created.success) throw new Error(created.error)
      const drafted = await api.mileage.saveEarningRuleDraft(created.data.id, {
        accountId: selectedAccountId,
        expectedVersion: 0,
        draft: { ...rule.draft, name },
      })
      if (!drafted.success) throw new Error(drafted.error)
      setMenuNotice(`「${name}」を止めた状態で作りました。`)
      await load()
    } catch {
      setActionError('複製できませんでした。もう一度お試しください。')
    } finally {
      setSavingId(null)
    }
  }

  const runTest = async (rule: MileageEarningRuleV6) => {
    if (readonly || !selectedAccountId || testBusy) return
    setTestTarget(rule)
    setTestResult(null)
    setTestError('')
    setTestBusy(true)
    try {
      const response = await api.mileage.testEarningRule(selectedAccountId, rule.draft)
      if (!response.success) throw new Error(response.error)
      setTestResult(response.data)
    } catch (caught) {
      setTestError(caught instanceof Error ? caught.message : 'テストできませんでした。もう一度お試しください。')
    } finally {
      setTestBusy(false)
    }
  }

  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setFolder('all')
    setActiveOnly(false)
    setPendingOnly(false)
    setStoppedOnly(false)
    setSort('order')
    setPage(1)
  }

  return (
    <>
      <div className={styles.kpis} role="group" aria-label="今の数">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><ListOrdered size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>たまる決めごと</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || loadError ? '—' : formatMileageNumber(rules.length)}
            <span className={styles.kpiUnit}> 件</span>
          </p>
          <p className={styles.kpiSub}>
            {loading || loadError ? '—' : `動いている ${formatMileageNumber(activeRules.length)}・止めている ${formatMileageNumber(rules.length - activeRules.length)}`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Coins size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>今月 付けたマイル</span>
          </div>
          <p className={styles.kpiValue}>{loading || loadError ? '—' : formatMileageNumber(grantedMiles ?? 0)}</p>
          <p className={styles.kpiSub}>
            {loading || loadError ? '—' : `${formatMileageNumber(grantedCount ?? 0)}人に`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Gift size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>今月 使われたマイル</span>
          </div>
          <p className={styles.kpiValue}>{loading || loadError ? '—' : formatMileageNumber(spentMiles ?? 0)}</p>
          <p className={styles.kpiSub}>
            {loading || loadError ? '—' : `交換 ${formatMileageNumber(spentCount ?? 0)}件`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Wallet size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>残高の合計</span>
          </div>
          <p className={styles.kpiValue}>{loading || loadError ? '—' : formatMileageNumber(balanceTotal ?? 0)}</p>
          <p className={styles.kpiSub}>
            {loading || loadError ? '—' : `友だち ${formatMileageNumber(friendTotal ?? 0)}人`}
          </p>
        </div>
      </div>

      {actionError ? <Notice tone="danger" message={actionError} /> : null}
      {menuNotice ? <Notice tone="success" message={menuNotice} /> : null}
      {orderDirty && !readonly ? (
        <Notice tone="warn" message={`並び順を変えています。保存するまでこの画面の並びは仮のままです。${savingOrder ? '保存しています…' : ''}`} />
      ) : null}

      <div className={styles.columns}>
        <div className={styles.rail}>
          <V8CreateButton href="/mileage/earning-rules/new" readonly={readonly}>
            <Plus size={14} aria-hidden="true" /> 決めごとを作る
          </V8CreateButton>
          <FolderPanel
            heading="フォルダ"
            rows={FOLDERS.map((item) => ({
              id: item.key,
              label: item.label,
              count: folderCounts.get(item.key) ?? 0,
            }))}
            activeId={folder}
            onSelect={(id) => resetPage(() => setFolder(id as FolderKey))}
            addFolderNote="フォルダを消しても、中の経路は未分類に残ります"
          />
        </div>

        <div className={styles.main}>
          <p className={styles.band} role="note">
            <Info size={16} aria-hidden="true" />
            決めごとを変えると、変えたあとの行動から新しい数で付きます。前に付いたマイルは変わりません。
          </p>

          <div className={styles.railCollapsedBar}>
            <V8CreateButton href="/mileage/earning-rules/new" readonly={readonly}>
              <Plus size={14} aria-hidden="true" /> 決めごとを作る
            </V8CreateButton>
            <Select
              aria-label="フォルダ"
              value={folder}
              options={FOLDERS.map((item) => ({
                value: item.key,
                label: `フォルダ：${item.label}`,
              }))}
              onChange={(value) => resetPage(() => setFolder(value as FolderKey))}
            />
          </div>

          <div className={styles.toolbar}>
            <SearchField
              aria-label="決めごとの名前で探す"
              value={searchInput}
              onChange={setSearchInput}
              onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1)
                  setSearch(searchInput.trim())
                }
              }}
              placeholder="決めごとの名前で探す"
            />
            <FilterChip
              selected={activeOnly}
              onChange={(selected) => resetPage(() => {
                setActiveOnly(selected)
                if (selected) setStoppedOnly(false)
              })}
            >
              動いている {formatMileageNumber(activeRules.length)}
            </FilterChip>
            <FilterChip
              selected={pendingOnly}
              onChange={(selected) => resetPage(() => setPendingOnly(selected))}
            >
              確定待ちあり {formatMileageNumber(pendingRules.length)}
            </FilterChip>
            {orderDirty && !readonly ? (
              <Button onClick={() => void saveOrder()} disabled={savingOrder} busy={savingOrder} busyLabel="保存しています">
                並び順を保存する
              </Button>
            ) : null}
            <span className={styles.toolbarRight}>
              <Select
                aria-label="よく使う絞り込み"
                value={presetValue}
                options={[
                  ...PRESETS.map((p) => ({ value: p.value, label: p.label })),
                  ...(presetValue === 'custom' ? [{ value: 'custom' as const, label: 'いまの絞り込み' }] : []),
                ]}
                onChange={(value) => {
                  const preset = PRESETS.find((p) => p.value === value)
                  if (!preset) return
                  setPage(1)
                  setActiveOnly(preset.active)
                  setPendingOnly(preset.pending)
                  setStoppedOnly(preset.stopped)
                  setSort(preset.sort)
                }}
              />
              <PageSizeSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} options={[10, 20, 50]} />
            </span>
          </div>

          {loading ? (
            <div className={styles.stateWrap} role="status" aria-label="読み込み中">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={styles.skelRow} aria-hidden="true">
                  <span className={styles.skelDot} />
                  <span className={styles.skelBar} style={{ width: '22%' }} />
                  <span className={styles.skelBar} style={{ width: '14%' }} />
                  <span className={styles.skelBar} style={{ width: '18%' }} />
                  <span className={styles.skelBar} style={{ width: '10%', marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className={styles.stateWrap}>
              <div className={styles.errorBand} role="alert">
                <Info size={16} aria-hidden="true" />
                たまる決めごとを読み込めませんでした
                <span className={styles.errorRetry}>
                  <Button type="button" onClick={() => void load()}>もう一度試す</Button>
                </span>
              </div>
              <p className={styles.errorNote}>数の帯は「—」にしています。道具はそのまま使えます。</p>
            </div>
          ) : rules.length === 0 ? (
            <div className={styles.stateWrap}>
              <div className={styles.stateCard}>
                <p className={styles.stateTitle}>まだ、たまる決めごとはありません</p>
                <p className={styles.stateDesc}>どの行動で何マイル付けるかを決めると、友だちにマイルがたまりはじめます</p>
                {!readonly ? (
                  <div className={styles.stateActions}>
                    <Button variant="primary" href="/mileage/earning-rules/new">
                      <Plus size={14} aria-hidden="true" /> たまる決めごとを作る
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.stateWrap}>
              <div className={styles.stateCard}>
                <p className={styles.stateTitle}>条件に合う決めごとはありません</p>
                <p className={styles.stateDesc}>名前の検索や絞り込みを外すと、すべて出ます</p>
                <div className={styles.stateActions}>
                  <Button type="button" onClick={resetAll}>条件を外す</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.tableFit}`}>
                {/*
                  列幅は先頭だけ伸び縮み、残りは中身（見出し1行・札・3つの操作）が
                  必ず入る幅を割合で渡す。合計 100 を超えると器からはみ出す。
                */}
                <colgroup>
                  <col />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '18%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">何をしてくれたら</th>
                    <th scope="col">対象の行動</th>
                    <th scope="col">たまるマイル</th>
                    <th scope="col">有効期間・失効</th>
                    <th scope="col">この30日</th>
                    <th scope="col">状態</th>
                    <th scope="col"><span className={styles.num}>操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((rule) => {
                    const active = rule.published.status === 'published'
                    const orderIndex = ruleOrder.indexOf(rule.id)
                    const canMove = !readonly && folder === 'all' && !activeOnly && !pendingOnly && !search.trim() && sort === 'order'
                    return (
                      <tr key={rule.id}>
                        <td>
                          <p className={styles.cellMain} title={rule.draft.name}>{rule.draft.name}</p>
                          <p className={styles.cellSub}>
                            {rule.draft.targetConditions ? '条件あり' : '全員'}・
                            {rule.publishedVersion == null ? `下書き v${rule.draftVersion}` : `公開版 v${rule.publishedVersion}`}
                          </p>
                        </td>
                        <td>
                          <p className={styles.cellSubDark}>{ruleEventLabel(rule.draft.eventType, EVENT_LABELS)}</p>
                          <p className={styles.cellSub}>{rule.draft.initialStatus === 'pending' ? '確定待ち' : 'すぐ使える'}</p>
                        </td>
                        <td><span className={styles.num}>{formatMileageNumber(rule.draft.amount)}</span></td>
                        <td><span className={styles.cellSubDark}>{validityText(rule)}</span></td>
                        <td>
                          <span className={styles.num}>{formatMileageNumber(grantedMiles30d(rule))}</span>
                          <p className={styles.cellSub}>対象外 {formatMileageNumber(rule.metrics30d.excluded)}回</p>
                        </td>
                        <td>
                          {active
                            ? <span className={`${styles.pill} ${styles.pillActive}`}>動いています</span>
                            : <span className={`${styles.pill} ${styles.pillStopped}`}>止めています</span>}
                        </td>
                        <td>
                          <span className={styles.rowActions}>
                            <IconButton
                              aria-label={`${rule.draft.name}を上へ`}
                              title="上へ"
                              disabled={!canMove || orderIndex <= 0}
                              onClick={() => moveRule(rule.id, -1)}
                            >
                              <ArrowUp size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              aria-label={`${rule.draft.name}を下へ`}
                              title="下へ"
                              disabled={!canMove || orderIndex < 0 || orderIndex >= ruleOrder.length - 1}
                              onClick={() => moveRule(rule.id, 1)}
                            >
                              <ArrowDown size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              aria-label={`${rule.draft.name}のその他操作`}
                              title="その他操作"
                              disabled={readonly}
                              onClick={() => setMenuId((current) => (current === rule.id ? null : rule.id))}
                            >
                              <MoreHorizontal size={14} aria-hidden="true" />
                            </IconButton>
                            <ActionMenu
                              open={menuId === rule.id}
                              ariaLabel={`${rule.draft.name}の操作`}
                              onClose={() => setMenuId(null)}
                              items={[
                                {
                                  id: 'edit',
                                  label: '編集',
                                  external: true,
                                  onSelect: () => router.push(`/mileage/earning-rules/edit?id=${encodeURIComponent(rule.id)}`),
                                },
                                {
                                  id: 'test',
                                  label: 'この内容をテスト',
                                  disabled: testBusy,
                                  disabledReason: 'テストを実行しています',
                                  onSelect: () => void runTest(rule),
                                },
                                {
                                  id: 'toggle',
                                  label: active ? '止める' : '再開する',
                                  disabled: savingId === rule.id,
                                  disabledReason: '反映しています',
                                  onSelect: () => void toggleRule(rule),
                                },
                                {
                                  id: 'publish',
                                  label: '公開して反映',
                                  disabled: savingId !== null,
                                  disabledReason: '別の決めごとを反映しています',
                                  onSelect: () => { setPublishError(''); setPublishTarget(rule) },
                                },
                                {
                                  id: 'duplicate',
                                  label: '複製',
                                  disabled: savingId !== null,
                                  disabledReason: 'ほかの操作を反映しています',
                                  onSelect: () => void duplicateRule(rule),
                                },
                                ...(rule.publishedVersion == null ? [{
                                  id: 'delete',
                                  label: 'この決めごとを削除する',
                                  tone: 'danger' as const,
                                  dividerBefore: true,
                                  disabled: savingId !== null,
                                  disabledReason: 'ほかの操作を反映しています',
                                  onSelect: () => { setDeleteError(''); setDeleteTarget(rule) },
                                }] : []),
                              ]}
                            />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !loadError && visible.length > 0 ? (
            <div className={styles.footer}>
              <span className={styles.footerCount}>
                {shown.length}件中 {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, shown.length)}件
              </span>
              {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
            </div>
          ) : null}

          {!loading && !loadError && rules.length > 0 ? (
            <p className={styles.footnote}>行の「…」から 編集・テスト・止める・公開・複製・削除ができます。</p>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={publishTarget !== null}
        title={publishTarget ? `「${publishTarget.draft.name}」の下書きを公開して反映しますか？` : '下書きを公開して反映しますか？'}
        description="公開後に受け付けたイベントから新しい内容になります。公開前に受け付けた分と、すでについたマイルは変わりません。取り消せません。"
        confirmLabel="公開して反映"
        destructive
        busy={publishTarget !== null && savingId === publishTarget.id}
        error={publishError || undefined}
        onCancel={() => { if (savingId === null) setPublishTarget(null) }}
        onConfirm={() => { if (publishTarget) void publishRule(publishTarget) }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `「${deleteTarget.draft.name}」を削除しますか？` : '決めごとを削除しますか？'}
        description="まだ公開していない決めごとの下書きごと消えます。取り消せません。すでに動いている決めごとは、削除ではなく停止を選んでください。"
        confirmLabel="削除する"
        destructive
        busy={deleteTarget !== null && savingId === deleteTarget.id}
        error={deleteError || undefined}
        onCancel={() => { if (savingId === null) setDeleteTarget(null) }}
        onConfirm={() => { if (deleteTarget) void deleteRule(deleteTarget) }}
      />

      <Dialog
        open={testTarget !== null}
        title={testTarget ? `「${testTarget.draft.name}」をテスト` : '決めごとをテスト'}
        description="この30日の記録に当てはめて、何人に・合計いくら付きそうかを見ます。実際には付与されず、履歴も増えません。"
        confirmLabel="閉じる"
        onConfirm={() => setTestTarget(null)}
        onCancel={() => setTestTarget(null)}
        busy={testBusy}
      >
        {testError ? (
          <Notice tone="danger" message={testError} />
        ) : testResult ? (
          <dl className={styles.stateCard}>
            <div><dt>条件に合う行動</dt><dd>{formatMileageNumber(testResult.matchedEvents)}回</dd></div>
            <div><dt>対象になる友だち</dt><dd>{formatMileageNumber(testResult.matchedFriends)}人</dd></div>
            <div><dt>付与見込みの合計</dt><dd>{formatMileageNumber(testResult.estimatedTotalMiles)} マイル</dd></div>
            <div><dt>1人あたり最大</dt><dd>{formatMileageNumber(testResult.maxPerFriend)} マイル</dd></div>
            <div><dt>付いた直後の状態</dt><dd>{testResult.initialStatus === 'pending' ? '確定待ち' : 'すぐ使える'}</dd></div>
            <div><dt>失効の例</dt><dd>{testResult.expirationExampleAt ? formatMileageDate(testResult.expirationExampleAt) : '失効なし'}</dd></div>
            {testResult.overlappingRuleNames.length > 0 ? (
              <div><dt>同じきっかけの決めごと</dt><dd>{testResult.overlappingRuleNames.join('、')}</dd></div>
            ) : null}
          </dl>
        ) : (
          <ListState kind="loading" title="テストしています" description="実際の付与は行いません。" />
        )}
      </Dialog>

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="たまる決めごとの並び順への変更"
        busy={savingOrder}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </>
  )
}
