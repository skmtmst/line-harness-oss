'use client'

/*
 * ★V8 シナリオ配信の一覧（Pencil「★V8 画面の地図」のシナリオ配信の行：
 * 一覧 `axFrW`・狭い板 `wjfLe`、状態の板は `BxGhV`、複製の窓は `Al4Ek`）。
 *
 * 完全切り替え（2026-10-04 オーナー決定）：V8 だけで出す。v7 は捨てた。
 * 「シナリオを作る」は左のフォルダの列の上、行の右端は「…」
 * （複製・配信結果・削除）、行の左の □ を選ぶと表の下にまとめての帯
 * （止める・再開・フォルダへ移す）。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Copy,
  Eye,
  Folder as FolderIcon,
  ListVideo,
  MoreHorizontal,
  Play,
  Search as SearchIcon,
  Send,
  Square,
  UserCheck,
  Users,
} from 'lucide-react'
import type { Scenario, DeliveryMode, Folder } from '@line-crm/shared'
import { api, type ListStats } from '@/lib/api'
import { useOffsetServerList } from '@/lib/use-server-list'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { TextField } from '@/components/shared/text-field'
import { useRowLeaving } from '@/components/shared/row-leaving'
import { MoveReferrersNotice } from '@/components/scenarios/scenario-dialogs'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { duplicateScenario, DuplicateAborted } from '@/components/scenarios/duplicate-scenario'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/ui/page-size-select'
import styles from './list-v8.module.css'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'
const PER_PAGE_OPTIONS = [20, 50, 100]

type ScenarioRow = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}

/**
 * 配信方式。一覧は名前の下の補足行に短く出す（列としては持たない）。
 * relative は 028 以前の作り方で、いまは新しく作れない。
 */
/* 板 `axFrW` の行の補足に出る送り方の言い方。 */
const deliveryModeLabels: Record<DeliveryMode, string> = {
  relative: 'Legacy',
  elapsed: '経過時間で指定',
  absolute_time: '時刻で指定',
}

/** 読み終えた人の補足行（板 `axFrW`：「登録した 1,756人 の 41%」）。 */
function scenarioCompletionDetail(active: number, completed: number): string {
  const enrolled = active + completed
  if (enrolled === 0) return '—'
  const rate = Math.round((completed / enrolled) * 100)
  return `登録した ${formatNumber(enrolled)} 人の ${rate}%`
}

/** 運用画面の基準である日本時間の今月初日（v7 page.tsx と同じ）。 */
function currentMonthStart(now = new Date()): string {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  })
  return `${month.format(now)}-01T00:00:00+09:00`
}

export default function ScenariosListV8() {
  usePageTitle('シナリオ配信')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()

  /*
   * 閲覧のみ（staff）：作る・複製・削除・止める/再開・並べ替え・フォルダ追加は
   * 押せない形で出す。役割が取れるまで null なので、そのあいだは今までどおり
   * 押せる見た目にしておく（最後の守りはサーバの 403）。
   */
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const readonlyReason = '閲覧のみのため、この操作はできません'

  // 名前の絞り込み。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  const [serverQuery, setServerQuery] = useState('')
  /** よく使う絞り込み。いま数えられるのは「停止中のみ」「今月作成」。 */
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [createdThisMonthOnly, setCreatedThisMonthOnly] = useState(false)
  const [actionError, setActionError] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  /** 「未分類」の件数。`null` は数えていない（#631、#730）。 */
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  /**
   * 絞り込みを掛けない「すべて」の件数（NEXT-26）。
   * `null` は「まだ数えられていない」。
   */
  const [overallTotal, setOverallTotal] = useState<number | null>(null)

  /* KPI 帯の数。/api/list-stats から取る。 */
  const [stats, setStats] = useState<ListStats | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)

  /* 複数選択（まとめての帯）。 */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())

  /* まとめて「止める／再開」の確認窓。 */

  /* まとめて/1件のフォルダ移動の窓。 */
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [moveDraft, setMoveDraft] = useState('')

  /* 削除の確認窓。 */
  const [deleteTarget, setDeleteTarget] = useState<ScenarioRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  /* 複製の窓（★V8 `Al4Ek`）。 */
  const [duplicateTarget, setDuplicateTarget] = useState<ScenarioRow | null>(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')

  /* 行の「…」。開いている行のID。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 行の詳細パネル（V8「サクサク感」C①）。開いている行のID。 */
  const [panelId, setPanelId] = useState<string | null>(null)
  /** いま掴んでいるシナリオ。落とした先と入れ替える。 */
  const [dragId, setDragId] = useState<string | null>(null)
  /** キーボードで動かした結果を読み上げる（live 領域）。 */
  const [moveNotice, setMoveNotice] = useState('')

  /*
   * 直近で選んでいるアカウント。切替後に前のアカウント宛の遅い応答が
   * 返ってきても採用しないための印（N-147 と同じ）。
   */
  const activeAccountRef = useRef<string | null>(selectedAccountId)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    setFolders([])
    setUnfiledCount(null)
    setFolderFilter('')
    setOverallTotal(null)
    setStats(null)
    setStatsFailed(false)
    setSelectedIds(new Set())
  }, [selectedAccountId])

  const loadFolders = useCallback(async () => {
    try {
      const accountId = selectedAccountId
      const res = await api.folders.list('scenario', accountId ?? undefined)
      if (activeAccountRef.current !== accountId) return
      if (res.success) setFolders(res.data)
      setUnfiledCount(res.success ? res.unfiledCount ?? null : null)
    } catch {
      // 置き場が取れなくても一覧は出す。
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const loadOverallTotal = useCallback(async () => {
    const accountId = selectedAccountId
    try {
      const res = await api.scenarios.listPage({
        accountId: accountId || undefined,
        page: 1,
        limit: 1,
      })
      if (activeAccountRef.current !== accountId) return
      setOverallTotal(res.success ? res.data.total : null)
    } catch {
      if (activeAccountRef.current === accountId) setOverallTotal(null)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadOverallTotal()
  }, [loadOverallTotal])

  const loadStats = useCallback(async () => {
    const accountId = selectedAccountId
    try {
      const res = await api.listStats.get(accountId ?? undefined)
      if (activeAccountRef.current !== accountId) return
      if (res.success) {
        setStats(res.data)
        setStatsFailed(false)
      } else {
        setStatsFailed(true)
      }
    } catch {
      if (activeAccountRef.current === accountId) setStatsFailed(true)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    const timer = setTimeout(() => setServerQuery(clampSearchQuery(nameQuery.trim())), 300)
    return () => clearTimeout(timer)
  }, [nameQuery])

  const loadScenarioPage = useCallback(async (
    request: { page: number; limit: number },
    signal: AbortSignal,
  ) => {
    if (accountLoading) return { items: [], total: 0, limit: request.limit, sort: [] }
    const res = await api.scenarios.listPage({
      accountId: selectedAccountId || undefined,
      page: request.page,
      limit: request.limit,
      query: serverQuery || undefined,
      active: stoppedOnly ? 0 : undefined,
      createdFrom: createdThisMonthOnly ? currentMonthStart() : undefined,
      folderId: folderFilter || undefined,
    }, signal)
    if (!res.success) throw new Error(res.error)
    return res.data
  }, [accountLoading, createdThisMonthOnly, folderFilter, selectedAccountId, serverQuery, stoppedOnly])

  /* 板 `axFrW`：右端は「20件表示」。 */
  const [perPage, setPerPage] = useState(20)
  const scenarioList = useOffsetServerList<ScenarioRow>({
    requestKey: JSON.stringify({
      ready: !accountLoading,
      accountId: selectedAccountId ?? '',
      query: serverQuery,
      stoppedOnly,
      createdThisMonthOnly,
      folderFilter,
      perPage,
    }),
    load: loadScenarioPage,
    initialLimit: perPage,
  })
  /*
   * 押した瞬間の見せ方（★V8 サクサク感 B）。軽い操作は先にこの重ねで
   * 描き換え、裏で保存する。確定・失敗・取り消しで重ねを外し、読み直す。
   * ページ・絞り込みが変わったら重ねは捨てる（違う一覧に貼らない）。
   */
  const [optimisticRows, setOptimisticRows] = useState<{ key: string; rows: ScenarioRow[] } | null>(null)
  const listContextKey = JSON.stringify({
    account: selectedAccountId ?? '',
    query: serverQuery,
    stopped: stoppedOnly,
    month: createdThisMonthOnly,
    folder: folderFilter,
    page: scenarioList.page,
  })
  const scenarios = optimisticRows && optimisticRows.key === listContextKey ? optimisticRows.rows : scenarioList.items
  const loadScenarios = scenarioList.retry

  /*
   * 選択状態はIDで持ち、一覧が読み直されたときに居なくなった行はそのまま
   * 外す（アカウント切替・削除・検索で外れた行を数え続けない）。
   */
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current
      const listed = new Set(scenarios.map((s) => s.id))
      const next = new Set([...current].filter((id) => listed.has(id)))
      return next.size === current.size ? current : next
    })
  }, [scenarios])

  /**
   * 配信方式の選択へ送るだけ。ここでは作らない（#949 N-055）。
   * 作るのは方式を選んで確定したとき。
   */
  const handleCreate = () => {
    router.push('/scenarios/mode')
  }

  /** 絞り込み0件の1枚から条件を外す。 */
  const clearScenarioFilters = () => {
    setNameQuery('')
    setServerQuery('')
    setStoppedOnly(false)
    setCreatedThisMonthOnly(false)
    setFolderFilter('')
  }
  const scenarioFilterActive = Boolean(serverQuery || stoppedOnly || createdThisMonthOnly || folderFilter)

  /*
   * 掴んで入れ替えた並びを先に描き換え、裏で保存する（★V8 サクサク感 B）。
   * 5秒のあいだは知らせの「元に戻す」で送らずに戻せる。
   */
  const handleReorder = (ids: string[]) => {
    setActionError('')
    const key = listContextKey
    const byId = new Map(scenarios.map((s) => [s.id, s]))
    const nextRows = ids.map((id) => byId.get(id)).filter((s): s is ScenarioRow => s !== undefined)
    if (nextRows.length !== scenarios.length) {
      void loadScenarios()
      return
    }
    setOptimisticRows({ key, rows: nextRows })
    runUndoable({
      message: '並び順を変えました',
      commit: async () => {
        const res = await api.scenarios.reorder(ids)
        if (!res.success) throw new Error(res.error)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: '並び順を保存できませんでした。',
      onCommitted: () => {
        setOptimisticRows(null)
        void loadScenarios()
      },
    })
  }

  /**
   * フォルダを付け替える（まとめての帯と移動の窓、どちらもここへ来る）。
   * 1件でも失敗があれば例外を投げ、呼び出し元の窓に残す。
   */
  const handleMoveFolders = async (ids: string[], folderId: string) => {
    setActionError('')
    const results = await Promise.all(
      ids.map((id) => api.scenarios.update(id, { folderId: folderId || null }).catch(() => null)),
    )
    const failed = results.filter((res) => !res || !res.success).length
    void loadScenarios()
    void loadFolders()
    if (failed > 0) {
      throw new Error(`${failed}件のフォルダ移動に失敗しました`)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await api.scenarios.delete(id)
      if (!res.success) throw new Error(res.error)
      // 消えた行は 150ms 薄くしてから読み直す（V8 の動き §8）。
      await fadeOut([id], async () => {
        loadScenarios()
        await Promise.all([loadFolders(), loadOverallTotal(), loadStats()])
      })
    } catch {
      throw new Error('シナリオを削除できませんでした')
    }
  }

  /* ===== まとめて「止める／再開」 ===== */

  const allOnPageSelected = scenarios.length > 0 && scenarios.every((s) => selectedIds.has(s.id))
  const selectedCount = selectedIds.size
  const selectedRows = scenarios.filter((s) => selectedIds.has(s.id))
  const stoppableIds = selectedRows.filter((s) => s.isActive).map((s) => s.id)
  const resumableIds = selectedRows.filter((s) => !s.isActive).map((s) => s.id)

  const toggleAllOnPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allOnPageSelected) scenarios.forEach((s) => next.delete(s.id))
      else scenarios.forEach((s) => next.add(s.id))
      return next
    })
  }
  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /*
   * まとめて「止める／再開」は押した瞬間に描き換え、裏で保存する
   * （★V8 サクサク感 B）。確認の窓は出さず、5秒のあいだ知らせの
   * 「元に戻す」で送らずに戻せる。1本ずつの開始前チェックは詳細画面で行う。
   */
  const runBulkToggle = (next: boolean, ids: string[]) => {
    if (ids.length === 0) return
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: scenarios.map((s) => (ids.includes(s.id) ? { ...s, isActive: next } : s)),
    })
    runUndoable({
      message: next ? `${ids.length}件の配信を始めました` : `${ids.length}件を停止しました`,
      commit: async () => {
        const results = await Promise.all(
          ids.map((id) => api.scenarios.update(id, { isActive: next }).catch(() => null)),
        )
        const failed = results.filter((res) => !res || !res.success).length
        if (failed > 0) throw new Error(`${failed}件の保存に失敗しました`)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: next
        ? '配信を始められませんでした。'
        : '停止できませんでした。',
      onCommitted: () => {
        setOptimisticRows(null)
        setSelectedIds(new Set())
        void loadScenarios()
        void loadStats()
      },
    })
  }

  /* ===== フォルダ移動の窓 ===== */

  const openMove = (ids: string[]) => {
    if (ids.length === 0) return
    setMoveDraft('')
    setMoveIds(ids)
  }

  /*
   * フォルダ移動は窓で行き先だけ選び、押した瞬間に描き換えて裏で保存する
   * （★V8 サクサク感 B）。5秒のあいだ知らせの「元に戻す」で送らずに戻せる。
   */
  const runMove = () => {
    if (!moveIds || moveIds.length === 0) return
    const ids = moveIds
    const folderId = moveDraft || null
    const key = listContextKey
    setOptimisticRows({
      key,
      rows: scenarios.map((s) => (ids.includes(s.id) ? { ...s, folderId } : s)),
    })
    setMoveIds(null)
    runUndoable({
      message: folderId ? 'フォルダへ移しました' : 'フォルダから外しました',
      commit: async () => {
        const results = await Promise.all(
          ids.map((id) => api.scenarios.update(id, { folderId }).catch(() => null)),
        )
        const failed = results.filter((res) => !res || !res.success).length
        if (failed > 0) throw new Error(`${failed}件のフォルダ移動に失敗しました`)
      },
      undo: () => setOptimisticRows(null),
      failureMessage: 'フォルダを移動できませんでした。',
      onCommitted: () => {
        setOptimisticRows(null)
        const moved = new Set(ids)
        setSelectedIds((current) => new Set([...current].filter((id) => !moved.has(id))))
        void loadScenarios()
        void loadFolders()
      },
    })
  }

  /* ===== 削除 ===== */

  /*
   * 押した時点のシナリオを窓に固定する。一覧が引き直されて対象が
   * 居なくなったら消さずに選び直してもらう（v7 と同じ判断）。
   */
  const targetStillListed =
    deleteTarget !== null && scenarios.some((s) => s.id === deleteTarget.id)

  const runDelete = async () => {
    if (!deleteTarget || deleting || !targetStillListed) return
    setDeleting(true)
    setDeleteError('')
    try {
      await handleDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setDeleteError('このシナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* ===== 複製（★V8 `Al4Ek`） ===== */

  const openDuplicate = (s: ScenarioRow) => {
    setDuplicateName(`${s.name} のコピー`)
    setDuplicateError('')
    setDuplicateTarget(s)
  }

  const runDuplicate = async () => {
    if (!duplicateTarget || duplicating) return
    const name = duplicateName.trim() || `${duplicateTarget.name} のコピー`
    setDuplicating(true)
    setDuplicateError('')
    try {
      const copyId = await duplicateScenario(duplicateTarget.id, name)
      setDuplicateTarget(null)
      void loadScenarios()
      void loadOverallTotal()
      void loadStats()
      router.push(`/scenarios/detail?id=${copyId}`)
    } catch (e) {
      if (e instanceof DuplicateAborted) {
        setDuplicateError(`複製が「${e.stage}」で止まりました。途中まで作成されたコピーが一覧に残っています。`)
      } else {
        setDuplicateError(e instanceof Error && e.message ? e.message : '複製に失敗しました。通信を確かめて、もう一度お試しください。')
      }
      void loadScenarios()
    } finally {
      setDuplicating(false)
    }
  }

  /* ===== 並び替え ===== */

  const dropOn = (targetId: string) => {
    const from = dragId
    setDragId(null)
    if (!from || from === targetId || !canEdit) return
    const order = scenarios.map((s) => s.id)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    void handleReorder(order)
  }

  const keyboardMove = (id: string, direction: -1 | 1) => {
    const order = scenarios.map((s) => s.id)
    const fromIdx = order.indexOf(id)
    const toIdx = fromIdx + direction
    const name = scenarios.find((s) => s.id === id)?.name ?? 'このシナリオ'
    if (fromIdx < 0 || !canEdit) return
    if (toIdx < 0 || toIdx >= order.length) {
      setMoveNotice(`「${name}」は${direction < 0 ? '先頭' : '末尾'}にあるため、これ以上動かせません`)
      return
    }
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1))
    setMoveNotice(`「${name}」を${direction < 0 ? '上' : '下'}へ移動しました。${toIdx + 1}番目です`)
    void handleReorder(order)
  }

  /* ===== フォルダの列 ===== */

  /*
   * 「すべて」とフォルダ内訳の母集団の差（#981 A05-02 と同じ）。
   * 全アカウント共通のシナリオは一覧（＝「すべて」）には出るが、
   * フォルダAPIの件数には入らない。差があるときだけ理由を書く。
   */
  const folderedTotal = folders.every((f) => f.itemCount !== undefined)
    ? folders.reduce((sum, f) => sum + (f.itemCount ?? 0), 0)
    : null
  const sharedScenarioCount =
    overallTotal !== null && unfiledCount !== null && folderedTotal !== null
      ? Math.max(0, overallTotal - folderedTotal - unfiledCount)
      : 0

  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: overallTotal, color: 'var(--color-accent)' },
    ...folders.map((f) => ({
      id: f.id,
      label: f.name,
      count: f.itemCount ?? null,
      color: f.color,
    })),
    { id: UNFILED, label: '未分類', count: unfiledCount, color: 'var(--color-ink-disabled)' },
  ]

  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: `フォルダ：${f.name}` })),
    { value: UNFILED, label: 'フォルダ：未分類' },
  ]

  const folderPanel = (
    <FolderPanel
      total={overallTotal === null ? '—' : `${overallTotal} 件`}
      activeId={folderFilter}
      onSelect={setFolderFilter}
      onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
      addFolderDisabled={!canEdit}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      <p className={styles.folderNote}>
        フォルダを消しても、入っていたシナリオは未分類として残ります。
      </p>
      {sharedScenarioCount > 0 ? (
        <p className={styles.folderNote}>
          全アカウントに共通で適用されるシナリオが{sharedScenarioCount}件あります。「すべて」の件数には含まれますが、フォルダ別の件数と「未分類」には含まれません。
        </p>
      ) : null}
    </FolderPanel>
  )

  /* ===== KPI の帯（4枚） ===== */

  /* 板 `axFrW`：1つ目の補足は「稼働中 3・停止中 2」。止めた数は合計から出す。 */
  const scenarioStopped = stats ? Math.max(0, stats.scenarios.total - stats.scenarios.active) : null
  const kpis = [
    {
      title: 'シナリオ',
      icon: ListVideo,
      value: overallTotal,
      unit: '件',
      detail: `稼働中 ${stats ? stats.scenarios.active : '—'}・停止中 ${scenarioStopped ?? '—'}`,
    },
    {
      title: '購読中',
      icon: Users,
      value: statsFailed ? null : stats?.scenarios.subscribers ?? null,
      unit: '人',
      detail: 'いま途中にいる人（重複を含む）',
    },
    {
      title: '読み終えた人',
      icon: UserCheck,
      value: statsFailed ? null : stats?.scenarios.completed ?? null,
      unit: '人',
      detail: stats ? scenarioCompletionDetail(stats.scenarios.subscribers, stats.scenarios.completed) : '—',
    },
    {
      title: '今週送った数',
      icon: Send,
      value: statsFailed ? null : stats?.scenarios.sentThisWeek ?? null,
      unit: '通',
      detail: '過去7日',
    },
  ]

  /* ===== 行の「…」の中身（★V8：複製・配信結果・削除） ===== */

  const rowMenuItems = (s: ScenarioRow): ActionMenuItem[] => [
    {
      id: 'duplicate',
      label: '複製する',
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : readonlyReason,
      onSelect: () => openDuplicate(s),
    },
    {
      id: 'results',
      label: '配信結果を見る',
      onSelect: () =>
        withViewTransition(() => {
          router.push(`/scenarios/results?id=${encodeURIComponent(s.id)}`)
        }),
    },
    {
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: true,
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : readonlyReason,
      onSelect: () => {
        setDeleteError('')
        setDeleteTarget(s)
      },
    },
  ]

  /* ===== 行の詳細パネル（V8「サクサク感」C①②・D・E） ===== */

  /** 一覧の行→詳細はつながる移り変わりで開く。 */
  const goDetail = (id: string) => {
    withViewTransition(() => {
      router.push(`/scenarios/detail?id=${id}`)
    })
  }

  /** 右クリックは「…」と同じ項目をマウスの位置に出す。 */
  const rowContextItems = (s: ScenarioRow): ContextMenuItem[] =>
    rowMenuItems(s).map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      onSelect: () => item.onSelect(),
    }))

  const panelIndex = panelId === null ? -1 : scenarios.findIndex((s) => s.id === panelId)
  const panelRow = panelIndex >= 0 ? scenarios[panelIndex] : null

  /** パネル内の名前のその場の書き換え。失敗したら InlineEdit が戻す。 */
  const renameScenario = async (id: string, next: string): Promise<unknown> => {
    const res = await api.scenarios.update(id, { name: next })
    if (!res.success) throw new Error(res.error)
    await loadScenarios()
    return res
  }

  /* ===== 表 ===== */

  /*
   * 読み込み中の骨組み（★V8 サクサク感 A）。出来上がりの表と同じ
   * 列幅・行の高さで5行出し、入れ替わってもガタつかない（CLS 0）。
   * 0.3秒以内に来たら出さず、出したら最低0.4秒残すのは共通部品に任せる。
   */
  /*
   * 見出しの5列は実表と共有する。骨組み用に書き写すと直書きの見出し
   * （`direct-th`）が二重に数えられるため、同じ要素を使い回す。
   * 選択の列だけは実表が箱（Checkbox）付き・骨組みが共通 `Th` の空見出し。
   */
  const tableHeadCells = (
    <>
      <th aria-label="並び替え" />
      <th>シナリオ名</th>
      <th>購読 / 読了</th>
      <th>状態</th>
      <th aria-label="操作" />
    </>
  )

  const loadingSkeleton = (
    <table className={styles.table}>
      <colgroup>
        {canEdit && <col style={{ width: 40 }} />}
        <col style={{ width: 44 }} />
        <col />
        <col style={{ width: 112 }} />
        <col style={{ width: 96 }} />
        <col style={{ width: 44 }} />
      </colgroup>
      <thead>
        <tr>
          {canEdit && <Th aria-label="選択" />}
          {tableHeadCells}
        </tr>
      </thead>
      <tbody>
        {[0, 1, 2, 3, 4].map((n) => (
          <tr key={n}>
            {canEdit && <td className={styles.selectCell} />}
            <td className={styles.gripCell} />
            <td>
              <Skeleton width={200} height={16} />
              <span style={{ display: 'block', height: 4 }} aria-hidden="true" />
              <Skeleton width={280} height={12} />
            </td>
            <td>
              <Skeleton width={56} height={16} />
            </td>
            <td>
              <Skeleton width={72} height={24} className="rounded-pill" />
            </td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  )

  const table =
    scenarioList.loading && scenarios.length === 0 ? (
      <div className={styles.tableWrap} aria-busy="true" aria-label="読み込んでいます">
        <DelayedSkeleton loading skeleton={loadingSkeleton} />
      </div>
    ) : scenarioList.error ? (
      /* 板 `BxGhV`「読み込めなかった」：表の場所に出る細い帯。数の帯は「—」のまま。 */
      <p className={styles.errorBand} role="alert" data-design-node="BxGhV">
        <AlertCircle size={14} aria-hidden="true" />
        シナリオを読み込めませんでした
        <button type="button" onClick={() => void loadScenarios()}>もう一度試す</button>
      </p>
    ) : scenarios.length === 0 ? (
      scenarioFilterActive ? (
        /* 板 `BxGhV`「絞り込みで0件」。 */
        <div className={styles.stateCard} data-design-node="BxGhV">
          <span className={styles.stateIcon}>
            <SearchIcon size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>条件に合うシナリオはありません</p>
          <p className={styles.stateDesc}>「停止中のみ」「今月作った」や検索を外すと、すべて出ます</p>
          <Button type="button" variant="secondary" onClick={clearScenarioFilters}>条件を外す</Button>
        </div>
      ) : (
        /* 板 `BxGhV`「まだシナリオが無い」。 */
        <div className={styles.stateCard} data-design-node="BxGhV">
          <span className={styles.stateIcon}>
            <ListVideo size={18} aria-hidden="true" />
          </span>
          <p className={styles.stateTitle}>まだシナリオはありません</p>
          <p className={styles.stateDesc}>友だち追加のあと7日間の案内などを、自動で順に送れます</p>
          {canEdit ? (
            <Button type="button" variant="primary" onClick={handleCreate}>＋ シナリオを作る</Button>
          ) : null}
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
              {canEdit && <col style={{ width: 40 }} />}
              <col style={{ width: 44 }} />
              <col />
              <col style={{ width: 112 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                {canEdit && (
                  <th className={styles.selectCell} aria-label="選択">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && selectedCount > 0}
                      onCheckedChange={() => toggleAllOnPage()}
                      aria-label="このページのシナリオをすべて選択"
                    />
                  </th>
                )}
                <th aria-label="並び替え" />
                <th>シナリオ</th>
                <th>購読中・読み終えた</th>
                <th>状態</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const folderName = s.folderId
                  ? folders.find((f) => f.id === s.folderId)?.name ?? 'フォルダ'
                  : '未分類'
                const showFolder = folders.length > 0 || s.folderId
                const meta = [
                  deliveryModeLabels[s.deliveryMode ?? 'relative'],
                  s.stepCount === undefined ? '—通' : `${s.stepCount}通`,
                  ...(showFolder ? [folderName] : []),
                ].join('・')
                return (
                  <tr
                    key={s.id}
                    className={styles.rowClick}
                    data-leaving={isLeaving(s.id) || undefined}
                    tabIndex={0}
                    onClick={() => setPanelId(s.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        setPanelId(s.id)
                      }
                    }}
                  >
                    {canEdit && (
                      <td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(s.id)}
                          onCheckedChange={() => toggleOne(s.id)}
                          aria-label={`${s.name}を選択`}
                        />
                      </td>
                    )}
                    <td
                      className={styles.gripCell}
                      onClick={(event) => event.stopPropagation()}
                      draggable={canEdit}
                      onDragStart={() => setDragId(s.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => dropOn(s.id)}
                      title="上下に動かして並び替え"
                    >
                      <ReorderGrip
                        label={s.name}
                        disabled={!canEdit}
                        disabledReason={readonlyReason}
                        onMove={(direction) => keyboardMove(s.id, direction)}
                      >
                        <span aria-hidden>⠿</span>
                      </ReorderGrip>
                    </td>
                    <td>
                      <div className={styles.nameRow}>
                        <Link
                          href={`/scenarios/detail?id=${s.id}`}
                          title={s.name}
                          className={styles.cellTitle}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                            event.preventDefault()
                            goDetail(s.id)
                          }}
                        >
                          {s.name}
                        </Link>
                        {s.lineAccountId === null && (
                          <span
                            className={`${styles.miniBadge} ${styles.miniBadgeWarn}`}
                            title="全アカウントに適用されるシナリオです"
                          >
                            全アカウント共通
                          </span>
                        )}
                      </div>
                      <p className={styles.cellSub} title={meta}>{meta}</p>
                    </td>
                    <td
                      className={styles.countCell}
                      title={`購読中 ${s.subscriberCount === undefined ? '—' : formatNumber(s.subscriberCount)}人 ／ 読み終えた ${formatNumber(s.completedCount ?? 0)}人`}
                    >
                      <div className={styles.countMain}>
                        {s.subscriberCount === undefined ? '—' : formatNumber(s.subscriberCount)}
                        <span className={styles.countSub} style={{ display: 'inline', marginTop: 0, marginLeft: 2 }}>人</span>
                      </div>
                      <div className={styles.countSub}>読み終えた {formatNumber(s.completedCount ?? 0)}人</div>
                    </td>
                    <td>
                      <span className={`${styles.statePill} ${s.isActive ? styles.statePillActive : styles.statePillStopped}`}>
                        <span className={styles.stateDot} aria-hidden="true" />
                        {s.isActive ? '稼働中' : '停止中'}
                      </span>
                    </td>
                    <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                      <ContextMenu
                        label={`シナリオ「${s.name}」の操作`}
                        items={rowContextItems(s)}
                      >
                        <button
                          type="button"
                          className={styles.menuButton}
                          title={`シナリオ「${s.name}」の操作`}
                          onClick={() => setOpenMenuId((current) => (current === s.id ? null : s.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </button>
                      </ContextMenu>
                      <ActionMenu
                        open={openMenuId === s.id}
                        onClose={() => setOpenMenuId(null)}
                        ariaLabel={`シナリオ「${s.name}」の操作`}
                        items={rowMenuItems(s)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* まとめての帯（選ぶと表の下に出る）：止める・再開・フォルダへ移す。 */}
        {canEdit && selectedCount > 0 ? (
          <div className={styles.bulkRow} role="region" aria-label="選択中のまとめ操作">
            <span className={styles.bulkCount}>{selectedCount}件を選択中</span>
            <Button
              type="button"
              variant="secondary"
              disabled={stoppableIds.length === 0}
              title={stoppableIds.length === 0 ? '稼働中のシナリオが選ばれていません' : undefined}
              onClick={() => runBulkToggle(false, stoppableIds)}
            >
              <Square size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
              止める
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={resumableIds.length === 0}
              title={resumableIds.length === 0 ? '停止中のシナリオが選ばれていません' : undefined}
              onClick={() => runBulkToggle(true, resumableIds)}
            >
              <Play size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
              再開
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openMove([...selectedIds])}
            >
              <FolderIcon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
              フォルダへ移す
            </Button>
          </div>
        ) : null}

        {/* 板 `axFrW` の表の下の使い方の文。 */}
        <p className={styles.folderNote}>
          左の□で選ぶと、下に「まとめて止める・再開・フォルダへ移す」の帯が出ます。行を押すと編集、「…」に複製・配信結果・削除
        </p>

        {scenarioList.pageCount > 1 ? (
          <div className={styles.pagerRow}>
            <span className={styles.pagerCount}>
              {(scenarioList.page - 1) * scenarioList.limit + 1}〜{Math.min(scenarioList.page * scenarioList.limit, scenarioList.total)} / {formatNumber(scenarioList.total)}件
            </span>
            <Pagination page={scenarioList.page} pageCount={scenarioList.pageCount} onPageChange={scenarioList.setPage} />
          </div>
        ) : null}
      </>
    )

  return (
    <div className={styles.board} data-design-node={canEdit ? 'axFrW' : 'X0QrW0'}>
      <div data-design="Head">
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.headTitle}>シナリオ配信</h2>
            <p className={styles.headDescription}>
              きっかけ（友だち追加・タグ・予約など）から、決めた順と日時でメッセージを送り続けます。
            </p>
          </div>
        </div>
      </div>

      {/* 板 `X0QrW0`：閲覧のみの帯。変えられないときだけ頭のすぐ下に出す。 */}
      {canEdit ? null : (
        <div className={styles.roBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      )}

      {/* 一覧の上の案内の帯（板 `axFrW`：作っただけでは送れない＋始め方への口）。 */}
      <p className={styles.noteBand}>
        <span aria-hidden="true">💡</span>
        作っただけでは送れません。「開始のきっかけ」を決めて、テストを送ってから配信を始めます（配信を始める方法・3手順）。
      </p>

      {/* 数の帯 4つ。 */}
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.title} className={styles.kpi}>
            <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
            <p className={styles.kpiValue}>{kpi.value === null ? '—' : formatNumber(kpi.value)}<span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span></p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="scenario"
          note="シナリオを分けてしまう箱です。消しても、入っていたシナリオは未分類として残ります。"
          placeholder="例: 01_新規フォロー"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {/* 行の詳細パネル（V8「サクサク感」C①②・E）。一覧は左に見えたまま。 */}
      {panelRow && (
        <DetailPanel
          open
          title={panelRow.name}
          description={[
            deliveryModeLabels[panelRow.deliveryMode ?? 'relative'],
            panelRow.stepCount === undefined ? '—通' : `${panelRow.stepCount}通`,
          ].join('・')}
          onClose={() => setPanelId(null)}
          onPrev={panelIndex > 0 ? () => setPanelId(scenarios[panelIndex - 1].id) : undefined}
          onNext={
            panelIndex < scenarios.length - 1 ? () => setPanelId(scenarios[panelIndex + 1].id) : undefined
          }
          hasPrev={panelIndex > 0}
          hasNext={panelIndex < scenarios.length - 1}
          footer={
            <>
              <Button variant="primary" onClick={() => goDetail(panelRow.id)}>
                開く
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  withViewTransition(() => {
                    router.push(`/scenarios/results?id=${encodeURIComponent(panelRow.id)}`)
                  })
                }
              >
                配信結果を見る
              </Button>
              <Button variant="secondary" disabled={!canEdit} onClick={() => openDuplicate(panelRow)}>
                複製する
              </Button>
              <Button
                variant="secondary"
                disabled={!canEdit}
                onClick={() => {
                  setDeleteError('')
                  setDeleteTarget(panelRow)
                  setPanelId(null)
                }}
              >
                削除する
              </Button>
            </>
          }
        >
          <p>
            {panelRow.isActive ? '稼働中' : '停止中'} ／ 購読{' '}
            {panelRow.subscriberCount === undefined ? '—' : formatNumber(panelRow.subscriberCount)}人 ／
            読了 {formatNumber(panelRow.completedCount ?? 0)}人
          </p>
          {panelRow.description && <p>{panelRow.description}</p>}
          {canEdit && (
            <InlineEdit
              value={panelRow.name}
              label="シナリオ名"
              onSave={(next) => renameScenario(panelRow.id, next)}
              maxLength={80}
            />
          )}
        </DetailPanel>
      )}

      {/* まとめて「止める／再開」は押した瞬間に変わり、知らせの「元に戻す」で戻す（V8「サクサク感」B）。確認の窓は出さない。 */}
      {/* フォルダ移動の窓。1件でも複数件でも同じ形。 */}
      <ConfirmDialog
        open={moveIds !== null}
        title={
          moveIds && moveIds.length === 1
            ? `「${scenarios.find((s) => s.id === moveIds[0])?.name ?? 'シナリオ'}」のフォルダを移動`
            : `${moveIds?.length ?? 0}件のシナリオのフォルダを移動`
        }
        description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
        confirmLabel="移動する"
        onConfirm={() => runMove()}
        onCancel={() => {
          setMoveIds(null)
        }}
      >
        <label className="block">
          <span className="text-ink-secondary mb-1 block text-xs font-medium">移動先のフォルダ</span>
          <Select
            aria-label="移動先のフォルダ"
            size="full"
            value={moveDraft}
            onChange={(value) => setMoveDraft(value)}
            options={[
              { value: '', label: '未分類' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
          />
        </label>
      </ConfirmDialog>

      {/* 削除の確認窓（v7 と同じ本文・同じ判断）。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `「${deleteTarget.name}」を削除しますか？` : ''}
        description="各通の中身と、購読中の人の進み具合が一緒に消えます。すでに送ったメッセージは友だちの手元に残り、取り消せません。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={targetStillListed ? () => void runDelete() : undefined}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      >
        {deleteTarget && (
          <div className="text-ink-secondary space-y-2 text-sm">
            <MoveReferrersNotice scenarioId={deleteTarget.id} />
            <p>
              購読中 {formatNumber(deleteTarget.subscriberCount ?? 0)}人 ／ 通数{' '}
              {deleteTarget.stepCount === undefined
                ? '— 読み込めませんでした'
                : `${deleteTarget.stepCount}通`}
            </p>
            {deleteTarget.lineAccountId === null && (
              <p className="text-warning font-medium">
                全アカウント共通のシナリオです。すべてのアカウントから消えます。
              </p>
            )}
            <p className="text-ink-faint text-xs">
              回答フォーム・流入経路・計測リンクからの参照は数えられていません。消したあとに参照が外れることがあります。
            </p>
            {!targetStillListed && (
              <p className="text-warning font-medium">
                このシナリオが一覧から外れました（LINEアカウントの切り替えなど）。この窓を閉じて、いまの一覧から選び直してください。
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>

      {/* 複製の窓（★V8 `Al4Ek`：名前・引き継ぐもの・引き継がないもの・停止中で作られる）。 */}
      <ConfirmDialog
        open={duplicateTarget !== null}
        title={duplicateTarget ? `「${duplicateTarget.name}」を複製しますか？` : ''}
        description="似た流れをもう1本作ります。コピーは停止中で作られるので、内容を確認してから開始してください。"
        confirmLabel={duplicating ? '複製中…' : '複製する'}
        busy={duplicating}
        error={duplicateError}
        onConfirm={() => void runDuplicate()}
        onCancel={() => {
          if (duplicating) return
          setDuplicateTarget(null)
          setDuplicateError('')
        }}
      >
        <div className="space-y-3 text-left">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">新しい名前</span>
            <TextField
              value={duplicateName}
              onChange={(event) => setDuplicateName(event.target.value)}
              disabled={duplicating}
              aria-label="新しい名前"
            />
          </label>
          <div className="text-ink-secondary text-xs leading-relaxed">
            <p className="font-medium">引き継ぐもの</p>
            <p className="text-ink-faint mt-0.5">メッセージの内容・配信する時刻・配信対象・開始のきっかけ・アクション・終了後の処理・フォルダ</p>
            <p className="font-medium mt-2">引き継がないもの</p>
            <p className="text-ink-faint mt-0.5">購読中の人・配信の記録</p>
            <p className="mt-2 flex items-center gap-1.5">
              <Copy size={12} aria-hidden="true" />
              コピーは「停止中」で作られます。確認してから開始してください。
            </p>
          </div>
        </div>
      </ConfirmDialog>

      <div data-design="Body" className={styles.split}>
        {/* 左のフォルダの列。いちばん上は「シナリオを作る」。 */}
        <div className={styles.folderCol}>
          {canEdit ? (
            <Button type="button" variant="primary" className="v8-folder-create w-full" onClick={handleCreate}>
              ＋ シナリオを作る
            </Button>
          ) : (
            <Button type="button" variant="primary" className="v8-folder-create w-full" disabled>
              ＋ シナリオを作る
            </Button>
          )}
          {folderPanel}
        </div>

        <div className={styles.listCol}>
          {/* 道具の段：検索・よく使う絞り込み（札 2 つ）。狭い板では「作る」とフォルダ選びがここへ畳まれる。 */}
          <div className={styles.toolbar}>
            <Button type="button" variant="primary" className={styles.toolbarCreate} disabled={!canEdit} onClick={handleCreate}>
              ＋ シナリオを作る
            </Button>
            <div className={styles.folderSelectWrap}>
              <Select
                aria-label="フォルダ"
                value={folderFilter}
                onChange={setFolderFilter}
                options={folderSelectOptions}
              />
            </div>
            <div className={styles.searchWrap}>
              <SearchField
                aria-label="シナリオ名で検索"
                placeholder="シナリオ名で検索"
                value={nameQuery}
                onChange={(value) => setNameQuery(clampSearchQuery(value))}
                onClear={() => setNameQuery('')}
              />
            </div>
            <FilterChip selected={stoppedOnly} onChange={(next) => setStoppedOnly(next)}>
              停止中のみ
            </FilterChip>
            <FilterChip selected={createdThisMonthOnly} onChange={() => setCreatedThisMonthOnly((current) => !current)}>
              今月作成
            </FilterChip>
            <span className={styles.toolbarSpacer} />
            <PageSizeSelect value={perPage} onChange={setPerPage} options={PER_PAGE_OPTIONS} label={null} />
          </div>

          {(serverQuery || stoppedOnly || createdThisMonthOnly || folderFilter) && scenarioList.loaded && (
            <p className={styles.folderNote} style={{ fontVariantNumeric: 'tabular-nums' }}>
              条件に一致したシナリオ：{formatNumber(scenarioList.total)}件
            </p>
          )}

          {actionError && (
            <p className={styles.errorBand} role="alert">
              <AlertCircle size={14} aria-hidden="true" />
              {actionError}
              <button type="button" onClick={() => setActionError('')}>閉じる</button>
            </p>
          )}

          {table}
        </div>
      </div>
    </div>
  )
}
