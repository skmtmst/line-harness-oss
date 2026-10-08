'use client'

/*
 * ★V8 友だち追加時の配信の一覧（Pencil：一覧 `MRhef`・閲覧のみ `LEwkJ`・1152 `P20kYU`・
 * 受け皿の「…」`C0lfUP`・受け皿は止められない `cFo2p`・状態 `kFz4b`）。
 *
 * 型（ListPage）に、閲覧のみの帯＋区分のタブ・数の帯・左のフォルダの列（上に「初回案内を作る」）・
 * 案内の帯・道具の段・表（順・設定・最初に送るもの・状態・直近7日・…）を渡す。
 * 受け皿（経路が分からなかった人）はいちばん下に固定で鍵の印・薄い地。
 *
 * データの口・保存の口・権限・失敗の扱いは app/friend-add-settings/list-v8.tsx と同じ
 * （BEHAVIOR.md）。違うのは見せ方だけ。
 */
import { useSamePageUrl } from '@/lib/use-same-page-url'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  AlertCircle,
  CircleCheck,
  CircleHelp,
  Eye,
  FilePen,
  Link2,
  Lock,
  MessageSquareMore,
  Pause,
  Pencil,
  Plus,
  Route,
  Send,
  UserPlus,
  Users,
} from 'lucide-react'
import type { FriendAddRule, FriendAddRuleKind, FriendAddRuleListData, FriendAddRuleStatus } from '@/lib/api'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage, ListPagePagination } from '@/components/templates'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import FolderPanel from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { Tabs } from '@/components/shared/tabs'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import PageSizeSelect from '@/components/ui/page-size-select'
import ReorderHandle from '@/components/shared/reorder-handle'
import { useFlipRows, useLiveReorder } from '@/lib/use-live-reorder'
import { describeFriendAddFailure } from './failure'
import { useCursorStack } from './use-cursor-stack'
import styles from './list.module.css'

const KIND_LABELS: Record<FriendAddRuleKind, string> = {
  first_time: 'はじめて友だち追加した人',
  returning: '以前からの友だち・ブロック解除した人',
}

/** 未分類の印。サーバでは '__uncategorized' を使う。 */
const UNFILED = '__uncategorized'
const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'
const SINK_NOTE = '基本の追加URL・素のQR・検索など｜いちばん最後に動く・消せない'
const ORDER_NOTE = '順番は上から見て、最初に当てはまった1つだけが動きます。行の左のつまみで入れ替えます。'
const ROUTE_NOTICE = '経路が分かるのは「流入リンク」から来た人だけです。素のQR・検索から来た人には、いちばん下の「経路が分からなかった人」が動きます。'

/* 状態の札には印を付ける（選んでいないときも意味が読める）。 */
const STATUS_CHIPS: Array<{ key: FriendAddRuleStatus; label: string; icon: typeof CircleCheck }> = [
  { key: 'published', label: '有効', icon: CircleCheck },
  { key: 'draft', label: '下書き', icon: FilePen },
  { key: 'stopped', label: '停止中', icon: Pause },
]

function countText(value: number | null | undefined, unit: string) {
  return value === null || value === undefined ? '—' : `${formatNumber(value)}${unit}`
}

function successRate(delivered: number | null, failed: number | null) {
  if (delivered === null || failed === null || delivered + failed === 0) return '成功率 —'
  return `成功率 ${((delivered / (delivered + failed)) * 100).toFixed(1)}%`
}

/** 「最初に送るもの」の主行（テキスト／テンプレート／回答フォーム／シナリオ）。 */
export function firstSendLabel(rule: FriendAddRule) {
  if (rule.friendKind === 'returning' && rule.definition.returningMode === 'none') {
    return '配信なし（あわせて行うことだけ）'
  }
  switch (rule.definition.messageType) {
    case 'template': return 'テンプレート'
    case 'form': return '回答フォーム'
    case 'scenario': return 'シナリオ'
    default: return rule.definition.messageText ? 'テキスト' : '未取得'
  }
}

/** 操作の名前（「タグ「新規友だち」を付ける」→「タグ「新規友だち」」）。 */
function actionName(label: string) {
  const match = label.match(/^(.*?「[^」]*」)/)
  return match ? match[1] : label
}

/**
 * 「最初に送るもの」の副行。シナリオ・タグなどを1行にまとめる（行の高さを絵の 62 に保つ）。
 * シナリオ開始の操作はシナリオ名で出すので actions 側からは外す。
 */
export function actionLine(rule: FriendAddRule) {
  const parts: string[] = []
  if (rule.definition.messageType !== 'scenario' && rule.scenarioName) {
    parts.push(`＋シナリオ「${rule.scenarioName}」`)
  }
  for (const action of rule.definition.actions) {
    if (action.type === 'start_scenario' && rule.scenarioName) continue
    if (action.label) parts.push(`＋${actionName(action.label)}`)
  }
  return parts.join(' ')
}

function statusLabel(rule: FriendAddRule) {
  if (rule.isFallback) return '常に有効'
  switch (rule.status) {
    case 'published': return '有効'
    case 'draft': return '下書き'
    case 'stopped': return '停止中'
    default: return 'アーカイブ'
  }
}

function statusTone(rule: FriendAddRule) {
  if (rule.isFallback) return 'always'
  return rule.status === 'published' ? 'active' : 'neutral'
}

function StatusPill({ rule }: { rule: FriendAddRule }) {
  return (
    <span className={styles.pill} data-tone={statusTone(rule)}>
      <span className={styles.pillDot} aria-hidden="true" />
      {statusLabel(rule)}
    </span>
  )
}

function TableHead() {
  return (
    <thead>
      <TableHeadRow className={styles.headRow} data-table-layout="columns">
        <Th className={styles.colOrder}>順</Th>
        <Th className={styles.colName}>設定（対象の流入リンク）</Th>
        <Th className={styles.colSend}>最初に送るもの</Th>
        <Th className={styles.colStatus}>状態</Th>
        <Th className={styles.colRecent}>直近7日</Th>
        <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
      </TableHeadRow>
    </thead>
  )
}

export default function FriendAddListV8() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FriendAddList />
    </Suspense>
  )
}

function FriendAddList() {
  usePageTitle('友だち追加時の配信')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const samePageUrl = useSamePageUrl()
  const narrow = useNarrowViewport()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  // 閲覧のみ：押せない形にする（隠さない）。
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const searchParams = useSearchParams()
  const kind: FriendAddRuleKind = searchParams.get('kind') === 'returning' ? 'returning' : 'first_time'
  const requestedDeleteId = searchParams.get('delete')

  const [data, setData] = useState<FriendAddRuleListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<FriendAddRuleStatus | ''>('')
  const [folder, setFolder] = useState<string | null>(null)
  const [perPage, setPerPage] = useState(20)
  const { cursor, canPrev, reset: resetCursor, goPrev, goNext } = useCursorStack()
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const folderKey = useRef(crypto.randomUUID())
  const requestSequence = useRef(0)

  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [moveNotice, setMoveNotice] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  /* 窓の状態。 */
  const [stopTarget, setStopTarget] = useState<FriendAddRule | null>(null)
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState('')
  const [fallbackStop, setFallbackStop] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FriendAddRule | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!selectedAccountId) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setErrorStatus(null)
    try {
      const response = await api.friendAddRules.list(selectedAccountId, kind, {
        cursor: cursor ?? undefined,
        limit: perPage,
        q: appliedSearch.trim() || undefined,
        folder: folder ?? undefined,
        status: statusFilter || undefined,
      })
      if (requestId !== requestSequence.current) return
      if (!response.success) {
        setError(response.error)
        setErrorStatus(null)
        setData(null)
        return
      }
      setData(response.data)
    } catch (caught) {
      if (requestId !== requestSequence.current) return
      // 権限・対象なし・重複を「通信を確認して」にまとめない。
      const failure = describeFriendAddFailure(caught, '友だち追加時の配信', 'load')
      setError(failure.message)
      setErrorStatus(failure.status)
      setData(null)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [appliedSearch, cursor, folder, kind, perPage, selectedAccountId, statusFilter])

  useEffect(() => { void load() }, [load])

  useEffect(() => { resetCursor() }, [selectedAccountId, kind, resetCursor])

  // 検索の入力は少し待ってから、巻き戻しと一緒に1回だけサーバへ送る。
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search)
      resetCursor()
    }, 300)
    return () => clearTimeout(timer)
  }, [search, resetCursor])

  // `?delete=<id>` で開いたときは、その設定の削除の確かめを出す（v7 と同じ口）。
  useEffect(() => {
    if (!requestedDeleteId || !data) return
    const found = data.items.find((item) => item.id === requestedDeleteId && !item.isFallback)
    if (found) setDeleteTarget(found)
  }, [data, requestedDeleteId])

  const selectFolder = (next: string | null) => {
    setFolder(next)
    resetCursor()
  }
  const selectStatus = (next: FriendAddRuleStatus | '') => {
    setStatusFilter(next)
    resetCursor()
  }
  const changePerPage = (next: number) => {
    setPerPage(next)
    resetCursor()
  }

  /*
   * 行の名前の前の丸は、左のフォルダの列と同じフォルダを名前で引く（設定はフォルダを名前で持つ）。
   * この口はフォルダの色を返さないので、丸は色の無いフォルダの灰になる。無ければ未分類の輪。
   */
  const folderDotOf = (name: string | null | undefined) => (name ? { name } : null)

  /* フォルダ欄の件数はサーバの全ページ合計 (folderCounts)。 */
  const folders = useMemo(() => {
    const counts = new Map<string | null, number>()
    for (const entry of data?.folderCounts ?? []) counts.set(entry.name, entry.count)
    const rows: Array<{ key: string; name: string; count: number }> = []
    for (const option of data?.options.folders ?? []) {
      rows.push({ key: option.name, name: option.name, count: counts.get(option.name) ?? 0 })
    }
    const uncategorized = counts.get(null) ?? 0
    if (uncategorized > 0 || !rows.some((row) => row.name === '未分類')) {
      rows.push({ key: UNFILED, name: '未分類', count: uncategorized })
    }
    return rows
  }, [data])

  const createFolder = async () => {
    if (!selectedAccountId || folderBusy) return
    const name = folderName.trim()
    if (!name) return
    setFolderBusy(true)
    setActionError('')
    try {
      const response = await api.friendAddRules.createFolder(selectedAccountId, name, folderKey.current)
      if (!response.success) {
        setActionError(response.error)
        setFolderDialogOpen(false)
        return
      }
      folderKey.current = crypto.randomUUID()
      setFolderName('')
      setFolderDialogOpen(false)
      await load()
    } catch (caught) {
      setActionError(describeFriendAddFailure(caught, 'フォルダ', 'create').message)
      setFolderDialogOpen(false)
    } finally {
      setFolderBusy(false)
    }
  }

  const items = useMemo(() => data?.items ?? [], [data])
  const regularItems = useMemo(() => items.filter((rule) => !rule.isFallback), [items])
  const sinkRule = useMemo(() => items.find((rule) => rule.isFallback) ?? null, [items])
  const filterActive = Boolean(appliedSearch.trim() || folder || statusFilter)

  /*
   * 並べ替えが書けるのは「その区分の受け皿以外を全部見せている」ときだけ。
   * 絞り込み中や2ページ目以降では一部の順だけを書けないため、サーバは
   * 全件一致しか受け付けない（PATCH /api/friend-add-rules/reorder）。
   */
  const listComplete = Boolean(data) && !filterActive && !data?.nextCursor && !canPrev
  const reorderReason = !canEdit
    ? READONLY_REASON
    : filterActive
      ? '条件を外すと並び替えられます'
      : !listComplete
        ? '一覧を全部読み込んでから並び替えられます'
        : undefined
  const canReorder = canEdit && listComplete

  const runReorder = async (order: string[]) => {
    if (!selectedAccountId) return
    setActionError('')
    try {
      const res = await api.friendAddRules.reorder(selectedAccountId, kind, order)
      if (!res.success) throw new Error(res.error)
    } catch (caught) {
      setActionError(
        caught instanceof Error && caught.message
          ? `並び替えを保存できませんでした。${caught.message}`
          : '並び替えを保存できませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      void load()
    }
  }

  /* 動かしている間、置き場所を入れ替えて見せ、ほかの行は滑らかに場所を空ける（自動応答と同じ動き）。 */
  const liveOrder = useLiveReorder(regularItems, (rule) => rule.id, dragId)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  useFlipRows(bodyRef, liveOrder.shown.map((rule) => rule.id).join(','))

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId || !canReorder) return
    const order = regularItems.map((rule) => rule.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    void runReorder(order)
  }

  const keyboardMove = (id: string, direction: -1 | 1) => {
    if (!canReorder) return
    const order = regularItems.map((rule) => rule.id)
    const fromIdx = order.indexOf(id)
    const toIdx = fromIdx + direction
    const name = regularItems.find((rule) => rule.id === id)?.name ?? 'この設定'
    if (fromIdx < 0) return
    if (toIdx < 0 || toIdx >= order.length) {
      setMoveNotice(`「${name}」は${direction < 0 ? '先頭' : '末尾'}にあるため、これ以上動かせません`)
      return
    }
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    setMoveNotice(`「${name}」を${direction < 0 ? '上' : '下'}へ移動しました。${toIdx + 1}番目です`)
    void runReorder(order)
  }

  /* ===== 一時停止 ===== */
  const runStop = async () => {
    if (!selectedAccountId || !stopTarget || stopBusy) return
    setStopBusy(true)
    setStopError('')
    try {
      const response = await api.friendAddRules.stop(selectedAccountId, stopTarget.id, stopTarget.version)
      if (!response.success) {
        setStopError('止められませんでした。状態を読み直してから、もう一度お試しください。')
        void load()
        return
      }
      setStopTarget(null)
      await load()
    } catch {
      setStopError('止められませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setStopBusy(false)
    }
  }

  /* ===== 削除 ===== */
  const closeDelete = () => {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteError('')
    if (requestedDeleteId) samePageUrl.replace(`/friend-add-settings?kind=${kind}`)
  }
  const runDelete = async () => {
    if (!selectedAccountId || !deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      const response = await api.friendAddRules.archive(selectedAccountId, deleteTarget.id)
      if (!response.success) {
        setDeleteError('削除できませんでした。設定を確認してください。')
        return
      }
      setDeleteTarget(null)
      if (requestedDeleteId) samePageUrl.replace(`/friend-add-settings?kind=${kind}`)
      await load()
    } catch (caught) {
      setDeleteError(describeFriendAddFailure(caught, '設定', 'delete').message)
    } finally {
      setDeleteBusy(false)
    }
  }

  /* ===== 行の「…」 ===== */
  const editHref = (id: string) => `/friend-add-settings?view=edit&id=${encodeURIComponent(id)}`
  const runsHref = (id: string) => `/friend-add-settings/runs?rule_id=${encodeURIComponent(id)}`
  const testHref = (id: string) => `/friend-add-settings?view=edit&id=${encodeURIComponent(id)}&step=preview`
  /* 閲覧のみの人には変える操作を出さない（見るだけの「実行結果を見る」は残す）。 */
  const locked = (item: ActionMenuItem): ActionMenuItem[] => (canEdit ? [item] : [])

  const rowMenuItems = (rule: FriendAddRule): ActionMenuItem[] => [
    ...locked({ id: 'edit', label: '編集する', icon: <Pencil size={15} />, onSelect: () => router.push(editHref(rule.id)) }),
    { id: 'runs', label: '実行結果を見る', icon: <Activity size={15} />, onSelect: () => router.push(runsHref(rule.id)) },
    ...locked({ id: 'test', label: 'テストを送る', icon: <Send size={15} />, onSelect: () => router.push(testHref(rule.id)) }),
    ...(rule.isFallback
      ? locked({ id: 'stop-fallback', label: '止める', icon: <Pause size={15} />, onSelect: () => setFallbackStop(true) })
      : [
          ...(rule.status === 'published'
            ? locked({
                id: 'stop',
                label: '止める',
                icon: <Pause size={15} />,
                onSelect: () => {
                  setStopError('')
                  setStopTarget(rule)
                },
              })
            : rule.status === 'draft'
              ? locked({
                  id: 'publish',
                  label: '最終確認・有効化へ進む',
                  icon: <CircleCheck size={15} />,
                  onSelect: () => router.push(`/friend-add-settings/publish?id=${encodeURIComponent(rule.id)}`),
                })
              : []),
          ...locked({
            id: 'delete',
            label: '削除する',
            tone: 'danger' as const,
            dividerBefore: true,
            onSelect: () => {
              setDeleteError('')
              setDeleteTarget(rule)
            },
          }),
        ]),
  ]

  /* ===== 数の帯の4つ ===== */
  const summary = data?.summary
  const kpis = [
    {
      key: 'rules', icon: MessageSquareMore, title: '初回案内', value: error ? null : summary?.rules ?? null, unit: '件',
      detail: summary ? `有効 ${formatNumber(summary.active)}件` : '—',
      help: 'いまある初回案内の設定数です。右の3つ（直近7日）とは期間がちがいます。',
    },
    {
      key: 'adds', icon: UserPlus, title: '直近7日の友だち追加', value: error ? null : summary?.recentAdds ?? null, unit: '人',
      detail: `経路が取れた ${countText(summary?.captured ?? null, '人')}`,
      help: '直近7日に友だち追加された人数と、そのうち流入リンクが分かった人数です。',
    },
    {
      key: 'sent', icon: Send, title: '直近7日の送信', value: error ? null : summary?.delivered ?? null, unit: '通',
      detail: successRate(summary?.delivered ?? null, summary?.failed ?? null),
      help: '直近7日に実際に送った通数です。送信履歴の累計配信と同じ数え方です。',
    },
    {
      key: 'unknown', icon: CircleHelp, title: narrow ? '経路が不明' : '経路が分からなかった人', value: error ? null : summary?.unknownRoute ?? null, unit: '人',
      /* 1152 では2行に折れる。行の高さを絵の18にそろえる（帯の高さを134に保つ）。 */
      detail: <span className={styles.kpiDetail}>共通の案内が動いた</span>,
      help: '直近7日に追加され、流入リンクが分からなかった人数です。経路が分からなかった人へ共通の案内が動きます。',
      action: { label: '流入リンクを見る', href: '/inflow-links' },
    },
  ]

  /* ===== 道具 ===== */
  /* 閲覧のみの人には、作る・追加・編集・削除の操作を置かない（押せない形でも出さない。オーナー 2026-10-06）。 */
  const folderRows = [
    { id: '', label: 'すべて', count: data?.total ?? items.length },
    ...folders.map((entry) => ({ id: entry.key, label: entry.name, count: entry.count })),
  ]
  const createButton = canEdit ? (
    <Button variant="primary" href="/friend-add-settings?view=new" className={styles.createButton}>
      <Plus size={15} aria-hidden="true" />初回案内を作る
    </Button>
  ) : null
  const folderSelect = (
    <div className={styles.folderSelect}>
      <Select
        size="standard"
        aria-label="フォルダで絞り込む"
        value={folder ?? ''}
        onChange={(next) => selectFolder(next || null)}
        options={[
          { value: '', label: 'フォルダ：すべて' },
          ...folders.map((entry) => ({ value: entry.key, label: `フォルダ：${entry.name}` })),
        ]}
      />
    </div>
  )
  const searchBox = (
    <div className={styles.searchBox}>
      <SearchField
        value={search}
        onChange={setSearch}
        onClear={() => setSearch('')}
        placeholder={narrow ? '設定名で探す' : '設定名・流入リンクで探す'}
        aria-label="設定名・流入リンクで探す"
      />
    </div>
  )
  const statusChips = (
    <div className={styles.chips} role="group" aria-label="状態で絞り込む">
      {STATUS_CHIPS.map((chip) => (
        <FilterChip
          key={chip.key}
          selected={statusFilter === chip.key}
          onChange={(on) => selectStatus(on ? chip.key : '')}
          icon={<chip.icon size={13} aria-hidden="true" />}
        >
          {chip.label}
        </FilterChip>
      ))}
    </div>
  )
  const perPageBox = <PageSizeSelect value={perPage} onChange={changePerPage} options={[10, 20, 50]} label={null} />
  const notice = (
    <div className={styles.noticeRow}>
      <Notice tone="info" icon={<Route size={16} aria-hidden="true" />} message={ROUTE_NOTICE} />
    </div>
  )
  const errorBand = actionError ? (
    <p className={styles.errorBand} role="alert">
      {actionError}
      <Button onClick={() => void load()}>読み直す</Button>
    </p>
  ) : null
  /* 1152 の板（P20kYU）：案内の帯 → 1段目「作る・フォルダ・探す … 件数」→ 2段目「状態の札」。 */
  const toolbar = narrow ? (
    <div className={styles.narrowTools}>
      {notice}
      {errorBand}
      <div className={styles.narrowRow}>
        {createButton}
        {folderSelect}
        {searchBox}
        <span className={styles.spacer} aria-hidden="true" />
        {perPageBox}
      </div>
      <div className={styles.narrowRow}>{statusChips}</div>
    </div>
  ) : (
    <>
      {notice}
      {errorBand}
      {searchBox}
      {statusChips}
      <span className={styles.spacer} aria-hidden="true" />
      {perPageBox}
    </>
  )

  /* ===== 表の行 ===== */
  const menuCell = (rule: FriendAddRule) => {
    const label = `設定「${rule.name}」の操作`
    return (
      <Td className={styles.colMenu}>
        <div className={styles.menuBox} data-design-node={rule.isFallback && openMenuId === rule.id ? 'C0lfUP' : undefined}>
          <RowMenu
            label={label}
            className={styles.menuButton}
            note={rule.isFallback && canEdit ? 'この設定は消せません（いちばん最後の受け皿）' : undefined}
            items={rowMenuItems(rule).map((item) => ({ ...item, onSelect: () => { setOpenMenuId(null); item.onSelect() } }))}
            open={openMenuId === rule.id}
            onOpenChange={(next) => setOpenMenuId(next ? rule.id : null)}
          />
        </div>
      </Td>
    )
  }

  const sendCell = (rule: FriendAddRule) => {
    const line = actionLine(rule)
    return (
      <Td className={styles.colSend}>
        <span className={styles.sendMain}>{firstSendLabel(rule)}</span>
        {line ? <span className={styles.sendSub} title={line}>{line}</span> : null}
      </Td>
    )
  }

  let listBody: ReactNode
  if (accountLoading || (loading && items.length === 0 && !error)) {
    /*
     * 初回の読み込みにも骨組みを出す（動きの点検 15 番）。0.3 秒以内に届けば出さない。
     * 読み上げには「読み込んでいます」を残す。
     */
    listBody = (
      <div role="status" aria-busy="true" className={styles.loadingRows}>
        <span className="sr-only">友だち追加時の配信を読み込んでいます</span>
        <DelayedSkeleton
          loading
          skeleton={
            <div aria-hidden="true">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className={styles.loadingRow}>
                  <Skeleton height={12} width="36%" />
                  <Skeleton height={10} width="22%" />
                </div>
              ))}
            </div>
          }
        />
      </div>
    )
  } else if (!selectedAccountId) {
    listBody = <ListState kind="empty" title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  } else if (error) {
    /* 状態の板（kFz4b）：読めないときも道具はそのまま。数の帯は「—」。 */
    listBody = (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon} data-tone="error"><AlertCircle size={18} aria-hidden="true" /></span>
        <p className={styles.stateTitle}>設定を読み込めませんでした</p>
        <p className={styles.stateDesc}>
          {errorStatus === 403 ? error : '数の帯は「—」、道具はそのまま使えます。条件を変えてから試し直せます。'}
        </p>
        <Button onClick={() => void load()}>もう一度試す</Button>
      </div>
    )
  } else if (items.length === 0) {
    /* 修正案 D-2：空の一覧。 */
    listBody = (
      <EmptyList
        icon={<UserPlus aria-hidden="true" />}
        title="まだ友だち追加時の配信がありません"
        description="友だちになった直後のあいさつを、流入経路ごとに分けて送ります。"
        create={{ label: '最初の配信を作る', href: '/friend-add-settings?view=new' }}
        canCreate={canEdit}
        filtered={filterActive}
        onClearFilters={() => {
          setSearch('')
          setAppliedSearch('')
          setStatusFilter('')
          setFolder(null)
          resetCursor()
        }}
        filteredDescription="「有効」「下書き」「停止中」や検索を外すと、すべて出ます"
      />
    )
  } else {
    listBody = (
      <>
        {/* キーボードで動かした結果を読み上げる。画面には出さない。 */}
        <span className="sr-only" role="status" aria-live="polite">{moveNotice}</span>
        <div className={styles.tableWrap}>
          <DataTable className={styles.table}>
            <TableHead />
            <tbody ref={bodyRef}>
              {liveOrder.shown.map((rule, index) => (
                <Tr
                  key={rule.id}
                  className={styles.row}
                  data-table-layout="columns"
                  data-row-id={rule.id}
                  data-reorder-id={rule.id}
                  onDragEnter={() => liveOrder.enter(rule.id)}
                  onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                  onDrop={dragId ? () => dropOn(liveOrder.dropTarget(rule.id)) : undefined}
                >
                  <Td
                    className={styles.colOrder}
                    draggable={canReorder}
                    onDragStart={() => setDragId(rule.id)}
                    onDragEnd={() => setDragId(null)}
                    title={canReorder ? '上下に動かして並び替え' : reorderReason}
                  >
                    <span className={styles.orderBox}>
                      {canEdit ? <ReorderHandle
                        label={rule.name}
                        disabledReason={canReorder ? null : reorderReason ?? READONLY_REASON}
                        onMove={(direction) => keyboardMove(rule.id, direction)}
                      >
                        <span aria-hidden="true" className={styles.grip}>⠿</span>
                      </ReorderHandle> : <span aria-hidden="true" className={`${styles.grip} ${styles.gripSpace}`}>⠿</span>}
                      <span className={styles.orderNum}>{index + 1}</span>
                    </span>
                  </Td>
                  <Td className={styles.colName}>
                    <FolderDotName folder={folderDotOf(rule.folderName)}>
                      <Link href={editHref(rule.id)} title={rule.name} className={styles.name}>{rule.name}</Link>
                    </FolderDotName>
                    <span className={`${styles.sub} ${styles.nameSub}`} title={rule.routeNames.join('、') || '未選択'}>
                      <Link2 size={12} aria-hidden="true" />
                      <span className={styles.subText}>{rule.routeNames.join('、') || '未選択'}</span>
                    </span>
                  </Td>
                  {sendCell(rule)}
                  <Td className={styles.colStatus}><StatusPill rule={rule} /></Td>
                  <Td className={styles.colRecent}>
                    <span className={styles.num}>{rule.status === 'draft' ? '—' : countText(rule.matchedLast7Days, '人')}</span>
                  </Td>
                  {menuCell(rule)}
                </Tr>
              ))}
              {sinkRule ? (
                <Tr key={sinkRule.id} className={`${styles.row} ${styles.sinkRow}`} data-table-layout="columns" data-row-id={sinkRule.id}>
                  <Td className={styles.colOrder}>
                    <span className={styles.orderBox} title="いちばん最後に動く・動かせない">
                      <Lock size={14} aria-hidden="true" className={styles.lock} />
                    </span>
                  </Td>
                  <Td className={styles.colName}>
                    <FolderDotName folder={folderDotOf(sinkRule.folderName)}>
                      <Link href={editHref(sinkRule.id)} title={sinkRule.name} className={styles.name}>{sinkRule.name}</Link>
                    </FolderDotName>
                    <span className={`${styles.sub} ${styles.nameSub}`} title={SINK_NOTE}>
                      <CircleHelp size={12} aria-hidden="true" />
                      <span className={styles.subText}>{SINK_NOTE}</span>
                    </span>
                  </Td>
                  {sendCell(sinkRule)}
                  <Td className={styles.colStatus}><StatusPill rule={sinkRule} /></Td>
                  <Td className={styles.colRecent}><span className={styles.num}>{countText(sinkRule.matchedLast7Days, '人')}</span></Td>
                  {menuCell(sinkRule)}
                </Tr>
              ) : null}
            </tbody>
          </DataTable>
        </div>
        <p className={styles.footNote}>{ORDER_NOTE}</p>
      </>
    )
  }

  const pager = data && (canPrev || data.nextCursor) ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>{formatNumber(data.total ?? items.length)}件</span>
      <span className={styles.pagerButtons} aria-label="ページ送り">
        <Button disabled={!canPrev || loading} onClick={() => goPrev()}>前へ</Button>
        <Button disabled={!data.nextCursor || loading} onClick={() => data.nextCursor && goNext(data.nextCursor)}>次へ</Button>
      </span>
    </ListPagePagination>
  ) : null

  return (
    <ListPage
      boardId={canEdit ? 'MRhef' : 'LEwkJ'}
      headingSize="regular"
      title="友だち追加時の配信"
      description="友だち追加されたときに、来た経路（流入リンク）ごとに初回の案内を送り、タグ付けやシナリオを始めます。"
      actions={
        <Button href="/friend-add-settings/runs">
          <Activity size={15} aria-hidden="true" />実行結果を見る
        </Button>
      }
      tabs={<>
        {/* 役割が取れるまで（null）は閲覧のみの帯を出さない。出してから消すと一覧が 48px 跳ねていた（動きの点検 8 番）。 */}
        {role !== null && !canEdit ? (
          <div className={styles.viewerBand} role="status">
            <Eye size={16} aria-hidden="true" />
            <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
          </div>
        ) : null}
        <div className={styles.kindTabs} data-design="KindTabs">
          <Tabs
            className={styles.kindList}
            label="配信の種類"
            items={(Object.keys(KIND_LABELS) as FriendAddRuleKind[]).map((tab) => ({
              label: KIND_LABELS[tab],
              current: kind === tab,
              onClick: () => {
                resetCursor()
                samePageUrl.replace(`/friend-add-settings?kind=${tab}`)
              },
            }))}
          />
        </div>
      </>}
      stats={
        <KpiBand data-design="KPIs">
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="band"
              title={kpi.title}
              icon={<kpi.icon size={13} aria-hidden="true" />}
              help={kpi.help}
              value={kpi.value}
              unit={kpi.value === null ? '' : kpi.unit}
              detail={kpi.detail}
              action={kpi.action}
            />
          ))}
        </KpiBand>
      }
      folders={<>
        {/* 閲覧のみ：作るボタンは隠し、場所だけ空ける（並びを絵どおりに保つ） */}
        {createButton ?? <span className={styles.viewerCreateSpace} aria-hidden="true" />}
        <FolderPanel
          activeId={folder ?? ''}
          onSelect={(id) => selectFolder(id || null)}
          onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
          addFolderLabel="フォルダを追加"
          addFolderDisabled={folderBusy}
          rows={folderRows}
        >
          <p className={styles.folderNote}>フォルダを消しても、中の設定は未分類に残ります</p>
        </FolderPanel>
      </>}
      folderNav={narrow ? undefined : { rows: folderRows, activeId: folder ?? '', onSelect: (id) => selectFolder(id || null), createAction: createButton ?? undefined }}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
        {/* 受け皿を止められない案内（cFo2p）。 */}
        <ConfirmDialog
          open={fallbackStop}
          designNode="cFo2p"
          titleIcon={false}
          title="「経路が分からなかった人」は止められません"
          description="いちばん最後の受け皿なので、止めると誰にも案内が届かなくなります。届く中身を変えたいときは、この設定を編集してください。止めたいときは、先に別の受け皿を有効にしてください。"
          confirmLabel="受け皿の中身を直す"
          onConfirm={() => {
            setFallbackStop(false)
            if (sinkRule) router.push(editHref(sinkRule.id))
          }}
          onCancel={() => setFallbackStop(false)}
        >
          <p className={styles.warnNote}>
            <AlertCircle size={14} aria-hidden="true" />
            <span>直近7日では {formatNumber(sinkRule?.matchedLast7Days ?? 0)}人 がこの設定で案内を受け取っています。</span>
          </p>
        </ConfirmDialog>
        {/* 通常の設定の一時停止の確かめ。 */}
        <ConfirmDialog
          open={stopTarget !== null}
          title={stopTarget ? `「${stopTarget.name}」を止める` : ''}
          description="止めると、この流入リンクから来た人にはいちばん下の「経路が分からなかった人」の案内が動きます。"
          confirmLabel="止める"
          busy={stopBusy}
          error={stopError}
          onConfirm={() => void runStop()}
          onCancel={() => {
            if (stopBusy) return
            setStopTarget(null)
            setStopError('')
          }}
        />
        {/* 削除の確かめ（v7 と同じ文）。受け皿には削除を出さない。 */}
        <ConfirmDialog
          open={deleteTarget !== null}
          designNode="Q3qP1r"
          title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : ''}
          description="削除すると、このリンクから追加された人には「経路が分からなかった人」の共通あいさつが動きます。過去の実行履歴は監査記録として残り、この操作は取り消せません。"
          confirmLabel="削除する"
          destructive
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void runDelete()}
          onCancel={closeDelete}
        />
        {/* フォルダを追加する窓（v7 と同じ文）。 */}
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
          <label className={styles.folderDialogBody}>
            <span className={styles.folderDialogLabel}>フォルダ名</span>
            <input
              autoFocus
              className={styles.folderDialogInput}
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              maxLength={50}
            />
          </label>
        </ConfirmDialog>
      </>}
    >
      {listBody}
    </ListPage>
  )
}
