'use client'

/*
 * ★V8 友だち追加時の配信の一覧（Pencil「★V8 画面の地図」の行：
 * 一覧 `MRhef`、受け皿の「…」は `C0lfUP`、受け皿を止められない確かめは
 * `cFo2p`、状態ごとの見え方は `kFz4b`）。
 *
 * v7 の一覧（app/friend-add-settings/page.tsx 内の FriendAddSettingsList）
 * とは別の部品として持つ。データの口（取得・絞り込み・ページ送り）は同じ。
 * 違いは置き場と見せ方——「初回案内を作る」は左のフォルダの列の上、表は
 * 「順（つまみ）・設定（対象の流入リンク）・最初に送るもの・状態・直近7日・…」、
 * 受け皿はいちばん下に固定で鍵の印・薄い地。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  Eye,
  History,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Route,
  Send,
  UserPlus,
  Users,
} from 'lucide-react'
import type { FriendAddRule, FriendAddRuleKind, FriendAddRuleListData, FriendAddRuleStatus } from '@/lib/api'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton, useDelayedSkeleton } from '@/components/shared/skeleton'
import { notifyToast } from '@/components/shared/toast'
import FolderPanel from '@/components/shared/folder-panel'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import { Tabs } from '@/components/shared/tabs'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import PageSizeSelect from '@/components/ui/page-size-select'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { describeFriendAddFailure } from './friend-add-failure'
import { useCursorStack } from './use-cursor-stack'
import styles from './list-v8.module.css'

const KIND_LABELS: Record<FriendAddRuleKind, string> = {
  first_time: 'はじめて友だち追加した人',
  returning: '以前からの友だち・ブロック解除した人',
}

/** 未分類の印。V7 の一覧と同じく、サーバでは '__uncategorized' を使う。 */
const UNFILED = '__uncategorized'
const STATUS_CHIPS: Array<{ key: FriendAddRuleStatus; label: string }> = [
  { key: 'published', label: '有効' },
  { key: 'draft', label: '下書き' },
  { key: 'stopped', label: '停止中' },
]

function countText(value: number | null, unit: string) {
  return value === null ? '—' : `${formatNumber(value)}${unit}`
}

function successRate(delivered: number | null, failed: number | null) {
  if (delivered === null || failed === null || delivered + failed === 0) return '成功率 —'
  return `成功率 ${((delivered / (delivered + failed)) * 100).toFixed(1)}%`
}

/** 「最初に送るもの」の主行（板 MRhef：テキスト／テンプレート／回答フォーム）。 */
function firstSendLabel(rule: FriendAddRule) {
  if (rule.friendKind === 'returning' && rule.definition.returningMode === 'none') {
    return '配信なし（あわせて行うことだけ）'
  }
  return rule.definition.messageType === 'template'
    ? 'テンプレート'
    : rule.definition.messageType === 'form'
      ? '回答フォーム'
      : rule.definition.messageType === 'scenario'
        ? 'シナリオ'
        : rule.definition.messageText
          ? 'テキスト'
          : '未取得'
}

/**
 * 「最初に送るもの」の副行（板：＋シナリオ「◯◯」／＋タグ「◯◯」を1行ずつ）。
 * シナリオ開始の操作はシナリオ名の行で出すので actions 側からは外す。
 */
function actionLines(rule: FriendAddRule) {
  const lines: string[] = []
  if (rule.definition.messageType !== 'scenario' && rule.scenarioName) {
    lines.push(`＋シナリオ「${rule.scenarioName}」`)
  }
  for (const action of rule.definition.actions) {
    if (action.type === 'start_scenario' && rule.scenarioName) continue
    if (action.label) lines.push(`＋${action.label}`)
  }
  return lines
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
  if (rule.isFallback) return styles.statePillAlways
  return rule.status === 'published' ? styles.statePillActive : styles.statePillDraft
}

/*
 * 初回案内の一覧の骨組み（サクサク感 A）。見出しは本物、行は5行・
 * 高さと列幅は本物の表と同じ。光は共通 `Skeleton`。
 */
function FriendAddListSkeleton() {
  return (
    <div className={styles.tableWrap} aria-hidden="true">
      <table className={styles.table}>
        <colgroup>
          <col style={{ width: 72 }} />
          <col />
          <col style={{ width: 200 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 80 }} className={styles.recentCol} />
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr>
            <th>順</th>
            <th>設定（対象の流入リンク）</th>
            <th>最初に送るもの</th>
            <th>状態</th>
            <th className={styles.recentCol}>直近7日</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((n) => (
            <tr key={n}>
              <td><Skeleton width={20} height={14} /></td>
              <td>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Skeleton width="45%" height={14} />
                  <Skeleton width="60%" height={12} />
                </span>
              </td>
              <td><Skeleton width="70%" height={13} /></td>
              <td><Skeleton width="80%" height={13} /></td>
              <td><Skeleton width="70%" height={13} /></td>
              <td><Skeleton width={20} height={14} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function FriendAddListV8() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<FriendAddListSkeleton />}>
      <FriendAddListV8Inner />
    </Suspense>
  )
}

function FriendAddListV8Inner() {
  usePageTitle('友だち追加時の配信')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  // kFz4b「閲覧のみ」：押せない形にする（隠さない）。
  const canEdit = canManageRole(role)
  const readonlyReason = 'この操作にはオーナーか管理者の権限が要ります'
  const searchParams = useSearchParams()
  const kind: FriendAddRuleKind = searchParams.get('kind') === 'returning' ? 'returning' : 'first_time'

  const [data, setData] = useState<FriendAddRuleListData | null>(null)
  const [loading, setLoading] = useState(true)
  /* 数の帯の骨組み判定（0.3秒以内なら出さない・出したら最低0.4秒）。 */
  const showKpiSkel = useDelayedSkeleton(loading)
  /* 並べ替えの楽観表示（サーバの順に追いつくまでこっちを出す）。 */
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
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
      // M006: 権限・対象なし・重複を「通信を確認して」にまとめない。
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
  const regularItems = useMemo(() => {
    const list = items.filter((rule) => !rule.isFallback)
    if (!orderOverride) return list
    const rank = new Map(orderOverride.map((id, index) => [id, index]))
    return [...list].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
  }, [items, orderOverride])
  const sinkRule = useMemo(() => items.find((rule) => rule.isFallback) ?? null, [items])
  const filterActive = Boolean(appliedSearch.trim() || folder || statusFilter)

  /*
   * 並べ替えが書けるのは「その区分の受け皿以外を全部見せている」ときだけ。
   * 絞り込み中や2ページ目以降では一部の順だけを書けないため、サーバは
   * 全件一致しか受け付けない（PATCH /api/friend-add-rules/reorder）。
   */
  const listComplete = Boolean(data) && !filterActive && !data?.nextCursor && !canPrev
  const reorderReason = !canEdit
    ? readonlyReason
    : filterActive
      ? '条件を外すと並び替えられます'
      : !listComplete
        ? '一覧を全部読み込んでから並び替えられます'
        : undefined
  const canReorder = canEdit && listComplete

  /*
   * 並べ替えは先に画面を変えて裏で保存する（サクサク感 B）。
   * 成功したら Toast の「元に戻す」（前の順で同じ口を叩く）で戻せる。
   * 失敗したら順を戻して Toast で理由と「もう一度」。
   */
  const runReorder = async (order: string[], previous: string[]) => {
    if (!selectedAccountId) return
    setOrderOverride(order)
    setActionError('')
    try {
      const res = await api.friendAddRules.reorder(selectedAccountId, kind, order)
      if (!res.success) throw new Error(res.error)
      await load().catch(() => {})
      /* 保存した順と違えば上書きしない（連打の取りこぼし防止）。 */
      setOrderOverride((current) => (current === order ? null : current))
      notifyToast('並び替えました', {
        actionLabel: '元に戻す',
        onAction: () => void runReorder(previous, order),
      })
    } catch (caught) {
      setOrderOverride(null)
      await load().catch(() => {})
      notifyToast(
        caught instanceof Error && caught.message
          ? `並び替えを保存できませんでした。${caught.message}`
          : '並び替えを保存できませんでした。',
        { tone: 'error', actionLabel: 'もう一度試す', onAction: () => void runReorder(order, previous) },
      )
    }
  }

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId || !canReorder) return
    const order = regularItems.map((rule) => rule.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const previous = [...order]
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    void runReorder(order, previous)
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
    const previous = [...order]
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    setMoveNotice(`「${name}」を${direction < 0 ? '上' : '下'}へ移動しました。${toIdx + 1}番目です`)
    void runReorder(order, previous)
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

  const rowMenuItems = (rule: FriendAddRule): ActionMenuItem[] => [
    {
      id: 'edit',
      label: '編集する',
      icon: <Pencil size={15} />,
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : readonlyReason,
      onSelect: () => router.push(editHref(rule.id)),
    },
    {
      id: 'runs',
      label: '実行結果を見る',
      icon: <History size={15} />,
      onSelect: () => router.push(runsHref(rule.id)),
    },
    {
      id: 'test',
      label: 'テストを送る',
      icon: <Send size={15} />,
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : readonlyReason,
      onSelect: () => router.push(testHref(rule.id)),
    },
    ...(rule.isFallback
      ? [{
          id: 'stop-fallback',
          label: '一時停止する',
          disabled: !canEdit,
          disabledReason: canEdit ? undefined : readonlyReason,
          onSelect: () => setFallbackStop(true),
        }]
      : [
          ...(rule.status === 'published'
            ? [{
                id: 'stop',
                label: '一時停止する',
                disabled: !canEdit,
                disabledReason: canEdit ? undefined : readonlyReason,
                onSelect: () => {
                  setStopError('')
                  setStopTarget(rule)
                },
              }]
            : rule.status === 'draft'
              ? [{
                  id: 'publish',
                  label: '最終確認・有効化へ進む',
                  disabled: !canEdit,
                  disabledReason: canEdit ? undefined : readonlyReason,
                  onSelect: () => router.push(`/friend-add-settings/publish?id=${encodeURIComponent(rule.id)}`),
                }]
              : []),
          {
            id: 'delete',
            label: '削除する',
            tone: 'danger' as const,
            dividerBefore: true,
            disabled: !canEdit,
            disabledReason: canEdit ? undefined : readonlyReason,
            onSelect: () => {
              setDeleteError('')
              setDeleteTarget(rule)
            },
          },
        ]),
  ]

  /* ===== 数の帯（板 MRhef の4つ） ===== */

  const summary = data?.summary
  const kpis = [
    {
      key: 'rules',
      icon: UserPlus,
      title: '初回案内',
      value: error ? null : summary?.rules ?? null,
      unit: '件',
      detail: summary ? `有効 ${summary.active}件` : '—',
      href: null as string | null,
    },
    {
      key: 'adds',
      icon: Users,
      title: '直近7日の友だち追加',
      value: error ? null : summary?.recentAdds ?? null,
      unit: '人',
      detail: `経路が取れた ${countText(summary?.captured ?? null, '人')}`,
      href: null,
    },
    {
      key: 'sent',
      icon: Send,
      title: '直近7日の送信',
      value: error ? null : summary?.delivered ?? null,
      unit: '通',
      detail: successRate(summary?.delivered ?? null, summary?.failed ?? null),
      href: null,
    },
    {
      key: 'unknown',
      icon: Route,
      title: '経路が分からなかった人',
      value: error ? null : summary?.unknownRoute ?? null,
      unit: '人',
      detail: '共通の案内が動いた',
      href: '/inflow-links',
    },
  ]

  /* ===== 表の中身（kFz4b の状態ごとの見え方） ===== */

  const tableBody = (
    <div aria-busy={loading}>
      <DelayedSkeleton loading={loading && items.length === 0} skeleton={<FriendAddListSkeleton />}>
        {error ? (
    <div className={styles.stateCard}>
      <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
        <AlertCircle size={18} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>設定を読み込めませんでした</p>
      <p className={styles.stateDesc}>
        {errorStatus === 403 ? error : '数の帯は「—」、道具はそのまま使えます。条件を変えてから試し直せます。'}
      </p>
      <Button type="button" onClick={() => void load()}>もう一度試す</Button>
    </div>
  ) : items.length === 0 ? (
    filterActive ? (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <UserPlus size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>条件に合う設定はありません</p>
        <p className={styles.stateDesc}>
          「有効」「下書き」「停止中」や検索を外すと、すべて出ます。
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSearch('')
            setAppliedSearch('')
            setStatusFilter('')
            setFolder(null)
            resetCursor()
          }}
        >
          条件を外す
        </Button>
      </div>
    ) : (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <UserPlus size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>まだ経路ごとの初回案内はありません</p>
        <p className={styles.stateDesc}>
          いまは全員に「経路が分からなかった人」の案内が届きます。流入リンクごとに案内を分けられます。
        </p>
        {canEdit ? (
          <Button type="button" variant="primary" href="/friend-add-settings?view=new">
            ＋ 初回案内を作る
          </Button>
        ) : (
          /* 閲覧のみは隠さず押せない形にする（kFz4b）。リンクボタンは
             disabled を取れないためボタン型で出す。 */
          <Button type="button" variant="primary" disabled title={readonlyReason}>
            ＋ 初回案内を作る
          </Button>
        )}
      </div>
    )
  ) : (
    <>
      {/* キーボードで動かした結果を読み上げる。画面には出さない。 */}
      <span className="sr-only" role="status" aria-live="polite">
        {moveNotice}
      </span>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 72 }} />
            <col />
            <col style={{ width: 200 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 80 }} className={styles.recentCol} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              <th>順</th>
              <th>設定（対象の流入リンク）</th>
              <th>最初に送るもの</th>
              <th>状態</th>
              <th className={styles.recentCol}>直近7日</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {regularItems.map((rule, index) => (
              <tr key={rule.id}>
                <td
                  className={styles.orderCell}
                  draggable={canReorder}
                  onDragStart={() => setDragId(rule.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropOn(rule.id)}
                  title={canReorder ? '上下に動かして並び替え' : reorderReason}
                >
                  <span className={styles.orderCellInner}>
                    <ReorderGrip
                      label={rule.name}
                      disabled={!canReorder}
                      disabledReason={reorderReason}
                      onMove={(direction) => keyboardMove(rule.id, direction)}
                    >
                      <span aria-hidden>⠿</span>
                    </ReorderGrip>
                    <span className={styles.orderNum}>{index + 1}</span>
                  </span>
                </td>
                <td>
                  <Link href={editHref(rule.id)} title={rule.name} className={styles.cellTitle}>
                    {rule.name}
                  </Link>
                  <p className={styles.cellSub} title={rule.routeNames.join('、') || '未選択'}>
                    <Link2 size={11} aria-hidden="true" className={styles.cellSubIcon} />
                    {rule.routeNames.join('、') || '未選択'}
                  </p>
                </td>
                <td>
                  <span className={styles.countMain}>{firstSendLabel(rule)}</span>
                  {actionLines(rule).map((line) => (
                    <p key={line} className={styles.cellSub}>{line}</p>
                  ))}
                </td>
                <td>
                  <span className={`${styles.statePill} ${statusTone(rule)}`}>
                    <span className={styles.stateDot} aria-hidden="true" />
                    {statusLabel(rule)}
                  </span>
                </td>
                <td className={`${styles.countCell} ${styles.recentCol}`}>
                  <span className={styles.countMain}>
                    {rule.status === 'draft' ? '—' : countText(rule.matchedLast7Days, '人')}
                  </span>
                </td>
                <td className={styles.menuCell}>
                  <button
                    type="button"
                    className={styles.menuButton}
                    title={`設定「${rule.name}」の操作`}
                    aria-label={`設定「${rule.name}」の操作`}
                    aria-haspopup="menu"
                    onClick={() =>
                      setOpenMenuId((current) => (current === rule.id ? null : rule.id))
                    }
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  <ActionMenu
                    open={openMenuId === rule.id}
                    onClose={() => setOpenMenuId(null)}
                    ariaLabel={`設定「${rule.name}」の操作`}
                    items={rowMenuItems(rule)}
                  />
                </td>
              </tr>
            ))}
            {sinkRule ? (
              <tr key={sinkRule.id} className={styles.sinkRow}>
                <td className={styles.orderCell}>
                  <span className={styles.sinkLock} title="いちばん最後に動く・動かせない">
                    <Lock size={14} aria-hidden="true" />
                  </span>
                </td>
                <td>
                  <Link href={editHref(sinkRule.id)} title={sinkRule.name} className={styles.cellTitle}>
                    {sinkRule.name}
                  </Link>
                  <p className={styles.cellSub}>
                    <Route size={11} aria-hidden="true" className={styles.cellSubIcon} />
                    基本の追加URL・素のQR・検索など｜いちばん最後に動く・消せない
                  </p>
                </td>
                <td>
                  <span className={styles.countMain}>{firstSendLabel(sinkRule)}</span>
                  {actionLines(sinkRule).map((line) => (
                    <p key={line} className={styles.cellSub}>{line}</p>
                  ))}
                </td>
                <td>
                  <span className={`${styles.statePill} ${styles.statePillAlways}`}>
                    <span className={styles.stateDot} aria-hidden="true" />
                    常に有効
                  </span>
                </td>
                <td className={`${styles.countCell} ${styles.recentCol}`}>
                  <span className={styles.countMain}>{countText(sinkRule.matchedLast7Days, '人')}</span>
                </td>
                <td className={styles.menuCell}>
                  <button
                    type="button"
                    className={styles.menuButton}
                    title={`設定「${sinkRule.name}」の操作`}
                    aria-label={`設定「${sinkRule.name}」の操作`}
                    aria-haspopup="menu"
                    onClick={() =>
                      setOpenMenuId((current) => (current === sinkRule.id ? null : sinkRule.id))
                    }
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  <ActionMenu
                    open={openMenuId === sinkRule.id}
                    onClose={() => setOpenMenuId(null)}
                    ariaLabel={`設定「${sinkRule.name}」の操作`}
                    items={rowMenuItems(sinkRule)}
                    note="この設定は消せません（いちばん最後の受け皿）"
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className={styles.tableNote}>
        順番は上から見て、最初に当てはまった1つだけが動きます。行の左のつまみで入れ替えます。
      </p>
      {(canPrev || data?.nextCursor) ? (
        <div className={styles.pagerRow}>
          <span className={styles.pagerCount}>{formatNumber(data?.total ?? items.length)}件</span>
          <div className="flex items-center gap-2" aria-label="ページ送り">
            <Button disabled={!canPrev || loading} onClick={() => goPrev()}>前へ</Button>
            <Button disabled={!data?.nextCursor || loading} onClick={() => data?.nextCursor && goNext(data.nextCursor)}>次へ</Button>
          </div>
        </div>
      ) : null}
        </>
      )}
      </DelayedSkeleton>
    </div>
  )

  return (
    <div className={styles.board} data-design-node="MRhef">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>友だち追加時の配信</h2>
          <p className={styles.headDescription}>
            友だち追加されたときに、来た経路（流入リンク）ごとに初回の案内を送り、タグ付けやシナリオを始めます。
          </p>
        </div>
        <Button href="/friend-add-settings/runs" variant="secondary">
          <History size={14} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />
          実行結果を見る
        </Button>
      </div>

      {/* 板 `LEwkJ`：閲覧のみの帯。操作は隠さず押せない形のまま。 */}
      {!canEdit ? (
        <p className={styles.readonlyBand} role="note">
          <Eye size={14} aria-hidden="true" />
          閲覧のみで見ています。変える操作は管理者に頼んでください。
        </p>
      ) : null}

      <div data-design="KindTabs">
        <Tabs
          label="配信の種類"
          items={(Object.keys(KIND_LABELS) as FriendAddRuleKind[]).map((tab) => ({
            label: KIND_LABELS[tab],
            current: kind === tab,
            onClick: () => {
              resetCursor()
              router.replace(`/friend-add-settings?kind=${tab}`)
            },
          }))}
        />
      </div>

      {/* 数の帯 4つ。 */}
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.key} className={styles.kpi}>
            <span className={styles.kpiLabel}>
              <kpi.icon size={13} aria-hidden="true" />
              {kpi.title}
            </span>
            <p className={styles.kpiValue}>
              {showKpiSkel && kpi.value === null ? <Skeleton width="6ch" height={22} /> : kpi.value === null ? '—' : (<>{formatNumber(kpi.value)}<span className={styles.kpiUnit}>{kpi.unit}</span></>)}
            </p>
            <p className={styles.kpiDetail}>{showKpiSkel && kpi.detail === '—' ? <Skeleton width="10ch" height={11} /> : kpi.detail}</p>
            {kpi.href ? (
              <a href={kpi.href} className={styles.kpiLink}>
                流入リンクを見る →
              </a>
            ) : null}
          </div>
        ))}
      </div>

      <div className={styles.split}>
        <div className={styles.folderCol}>
          {canEdit ? (
            <Button variant="primary" href="/friend-add-settings?view=new">
              ＋ 初回案内を作る
            </Button>
          ) : (
            <Button type="button" variant="primary" disabled title={readonlyReason}>
              ＋ 初回案内を作る
            </Button>
          )}
          <FolderPanel
            activeId={folder ?? ''}
            onSelect={(id) => selectFolder(id || null)}
            onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
            addFolderDisabled={folderBusy || !canEdit}
            rows={[
              { id: '', label: 'すべて', count: data?.total ?? items.length },
              ...folders.map((entry) => ({
                id: entry.key === UNFILED ? UNFILED : entry.key,
                label: entry.name,
                count: entry.count,
              })),
            ]}
          />
          <p className={styles.folderNote}>フォルダを消しても、中の設定は未分類に残ります</p>
        </div>

        <div className={styles.listCol}>
          <Notice
            tone="info"
            message="経路が分かるのは「流入リンク」から来た人だけです。素のQR・検索から来た人には、いちばん下の「経路が分からなかった人」が動きます。"
          />
          {actionError ? (
            <p className={styles.errorBand} role="alert">
              {actionError}
              <button type="button" onClick={() => void load()}>読み直す</button>
            </p>
          ) : null}
          <div className={styles.toolbar}>
            {canEdit ? (
              <Button variant="primary" href="/friend-add-settings?view=new" className={styles.toolbarCreate}>
                ＋ 初回案内を作る
              </Button>
            ) : (
              <Button type="button" variant="primary" disabled title={readonlyReason} className={styles.toolbarCreate}>
                ＋ 初回案内を作る
              </Button>
            )}
            <span className={styles.folderSelectWrap}>
              <Select
                size="standard"
                aria-label="フォルダで絞り込む"
                value={folder ?? ''}
                onChange={(next) => selectFolder(next || null)}
                options={[
                  { value: '', label: 'フォルダ：すべて' },
                  ...folders.map((entry) => ({
                    value: entry.key,
                    label: `フォルダ：${entry.name}`,
                  })),
                ]}
              />
            </span>
            <span className={styles.searchWrap}>
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="設定名・流入リンクで探す"
                aria-label="設定名・流入リンクで探す"
              />
            </span>
            {STATUS_CHIPS.map((chip) => (
              <FilterChip
                key={chip.key}
                selected={statusFilter === chip.key}
                onChange={(on) => selectStatus(on ? chip.key : '')}
              >
                {chip.label}
              </FilterChip>
            ))}
            <span className={styles.toolbarSpacer} />
            <PageSizeSelect value={perPage} onChange={changePerPage} />
          </div>
          {tableBody}
        </div>
      </div>

      {/* 受け皿を止められない確かめ（板 `cFo2p`）。 */}
      <ConfirmDialog
        open={fallbackStop}
        designNode="cFo2p"
        title="「経路が分からなかった人」は止められません"
        description="いちばん最後の受け皿なので、止めると誰にも案内が届かなくなります。届く中身を変えたいときは、この設定を編集してください。止めたいときは、先に別の受け皿を有効にしてください。"
        confirmLabel="受け皿の中身を直す"
        onConfirm={() => {
          if (sinkRule) router.push(editHref(sinkRule.id))
        }}
        onCancel={() => setFallbackStop(false)}
      >
        <p className={styles.warnNote}>
          <AlertCircle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          直近7日では {formatNumber(sinkRule?.matchedLast7Days ?? 0)}人 がこの設定で案内を受け取っています。
        </p>
      </ConfirmDialog>

      {/* 通常の設定の一時停止の確かめ。 */}
      <ConfirmDialog
        open={stopTarget !== null}
        title={stopTarget ? `「${stopTarget.name}」を一時停止する` : ''}
        description="止めると、この流入リンクから来た人にはいちばん下の「経路が分からなかった人」の案内が動きます。"
        confirmLabel="一時停止する"
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
        title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : ''}
        description="削除すると、このリンクから追加された人には「経路が分からなかった人」の共通あいさつが動きます。過去の実行履歴は監査記録として残り、この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void runDelete()}
        onCancel={() => {
          if (deleteBusy) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
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
    </div>
  )
}
