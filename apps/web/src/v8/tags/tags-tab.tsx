'use client'

/*
 * ★V8 友だち属性「タグ」タブ（Pencil `I1E7Bt`・1152 `aPeD8`・閲覧のみ `fkGUR`、
 * フォルダ窓 `IjVpM`、状態の板 `U0aKD`）。
 *
 * 動き（読み込み・数の帯・絞り込み・並べ替え・★・フォルダへ移す・フォルダの
 * 追加/直す/並べ替え/削除・保管・CSV・行の詳細パネル・右クリック）は
 * 今の V8 タブ（app/tags/tags-tab-v8.tsx）から写した。数え方・判定は v7 と同じ関数
 * （components/friend-fields/tags-page-v4）を使う。見た目だけを型と絵に合わせた。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useListScrollMemory, useListUrlState, useOnAccountSwitch } from '@/components/shared/list-url-state'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Bookmark,
  Check,
  CircleDashed,
  Folder,
  FolderOpen,
  GripVertical,
  Inbox,
  Plus,
  Sparkles,
  Star,
  Tag as TagIcon,
  Users,
} from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError, type ListStats } from '@/lib/api'
import { useRowLeaving } from '@/lib/use-row-leaving'
import { useDeferredDelete } from '@/lib/use-deferred-delete'
import { RovingTbody } from '@/components/shared/row-roving'
import { ListPageBody } from '@/components/templates'
import { FOLDER_COLORS } from '@/components/shared/folder-add-dialog'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DetailPanel, { useDetailPanelUrl } from '@/components/shared/detail-panel'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import { notifyToast } from '@/components/shared/toast'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { FolderDotName } from '@/components/shared/folder-dot'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import PageSizeSelect from '@/components/ui/page-size-select'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { useLiveReorder } from '@/lib/use-live-reorder'
import { mergeVisibleOrder } from '@/components/friend-fields/reorder-utils'
import TagCsvImportDialog from '@/components/friend-fields/tag-csv-import-dialog'
import { isCurrentTagListRequest, type TagListRequestKey } from '@/components/friend-fields/tag-list-state'
import {
  FOLDER_FALLBACK_COLOR,
  DeleteTagDialog,
  QUICK_FILTERS,
  SOURCE_LABELS,
  UNGROUPED,
  cleanupKnown,
  formatDate,
  hasLinkedActions,
  isThisMonth,
  isUnused,
  sourceLabel,
  usageLabel,
} from '@/components/friend-fields/tags-page-v4'
import styles from './list.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

const PAGE_SIZES = [10, 20, 50]

/** 連動の文（絵の「本人+10・1.2倍 他1」）。マイル以外の連動は「他N」。0件は「—」。 */
/**
 * 窓なしの保管で、5秒たって送る直前に呼ぶ。影響を読み直し、その間に友だちに付いた・
 * どこかで使われ始めたなら保管せずに失敗を返す（呼び出し側が行を戻して知らせる）。
 * 保管そのものが断られたときも失敗を返す。
 */
export async function archiveIfStillUnused(
  tagId: string,
  accountId: string,
  tagsApi: Pick<typeof api.tags, 'dependencies' | 'archive'> = api.tags,
): Promise<{ success: boolean; error?: string }> {
  const res = await tagsApi.dependencies(tagId, accountId)
  if (!res.success) return { success: false, error: res.error }
  const impact = res.data
  const inUse = impact.friendCount > 0 || impact.references.length > 0 || impact.linkedActions.length > 0
    || impact.pendingRunCount > 0 || impact.blockingReferenceCount > 0 || !impact.canArchive
  if (inUse) return { success: false, error: 'in_use' }
  const archived = await tagsApi.archive(tagId, accountId, { expectedVersion: impact.tag.version, impactRevision: impact.revision }, crypto.randomUUID())
  if (!archived.success) return { success: false, error: archived.error }
  return { success: true }
}

export function tagLinkText(tag: Tag): string {
  const main: string[] = []
  if (tag.mileageReward) main.push(`本人+${tag.mileageReward}`)
  if (tag.referralMileageReward) main.push(`紹介+${tag.referralMileageReward}`)
  if (tag.mileageMultiplierBps) main.push(`${tag.mileageMultiplierBps / 10000}倍`)
  const parts = main.length ? [main.join('・')] : []
  if (tag.otherActionCount) parts.push(`他${tag.otherActionCount}`)
  return parts.length ? parts.join(' ') : '—'
}

/**
 * タグのフォルダ追加・編集（Pencil `IjVpM`）。タグの分類は `tag_groups` 表なので
 * 共通の FolderAddDialog（folders 表）ではなく、この画面の形を持つ。右のパネルで出す。
 */
function TagFolderDialog({
  group,
  accountId,
  onClose,
  onSaved,
}: {
  group?: TagGroup
  accountId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [color, setColor] = useState(group?.color ?? FOLDER_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      const res = group
        ? await api.tagGroups.update(group.id, { name: trimmed, color, accountId: group.accountId })
        : await api.tagGroups.create({ name: trimmed, color, accountId })
      if (!res.success) {
        setError(res.error)
        return
      }
      onSaved()
      onClose()
    } catch {
      setError(group ? 'フォルダを直せませんでした' : 'フォルダを追加できませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DetailPanel
      open
      title={group ? 'フォルダを直す' : 'フォルダを追加'}
      description="タグを分けてしまう箱です。消しても、入っていたタグは未分類として残ります。"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button variant="primary" type="button" onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? (group ? '保存中…' : '追加中…') : (group ? '保存する' : 'フォルダを作る')}
          </Button>
        </>
      }
    >
      <label className={styles.formField}>
        <span className={styles.formLabel}>
          フォルダ名 <span className={styles.required}>*</span>
        </span>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) void save()
          }}
          placeholder="例: VIP"
          className={styles.formInput}
        />
      </label>
      <div className={styles.formField}>
        <span className={styles.formLabel}>色</span>
        <div className={styles.colorRow}>
          {FOLDER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`色 ${c}`}
              aria-pressed={color === c}
              className={styles.colorDot}
            >
              <svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="14" fill={c} /></svg>
            </button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    </DetailPanel>
  )
}

export default function TagsTab({
  accountId,
  fixture,
  canEdit,
  narrow,
  csvOpen,
  onCsvClose,
}: {
  accountId: string | null
  fixture?: { items: Tag[]; groups: TagGroup[] }
  canEdit: boolean
  narrow: boolean
  csvOpen: boolean
  onCsvClose: () => void
}) {
  const router = useRouter()
  const [items, setItems] = useState<Tag[]>(fixture?.items ?? [])
  const [groups, setGroups] = useState<TagGroup[]>(fixture?.groups ?? [])
  const [status, setStatus] = useState<LoadStatus>(fixture ? 'ready' : 'loading')
  // 操作の失敗（並び替え・★・フォルダ移動）。読み込みの失敗とは別物。
  const [actionError, setActionError] = useState('')
  const [stats, setStats] = useState<ListStats | null>(null)
  const [statsFailed, setStatsFailed] = useState(false)
  /*
   * 検索語・フォルダ・絞り込み・件数・ページは URL に置く（動きの点検 5 番）。
   * タグを開いて「戻る」と同じ一覧に戻る。絞り込みを変えたらページは 1 へ
   * （同じ書き込みの中で戻す。効果で戻すと、来た瞬間に URL から戻したページまで消える）。
   */
  const [view, setView] = useListUrlState({ q: '', folder: '', usage: 'all', source: 'all', quick: '', size: '20', page: '1' })
  const query = view.q
  const folder = view.folder
  const usageFilter = view.usage
  const sourceFilter = view.source
  const quick = useMemo(() => (view.quick ? view.quick.split(',') : []), [view.quick])
  const pageSize = PAGE_SIZES.includes(Number(view.size)) ? Number(view.size) : 20
  const page = Math.max(1, Number.parseInt(view.page, 10) || 1)
  const setQuery = useCallback((next: string) => setView({ q: next, page: '1' }), [setView])
  const setFolder = useCallback((next: string) => setView({ folder: next, page: '1' }), [setView])
  const setUsageFilter = useCallback((next: string) => setView({ usage: next, page: '1' }), [setView])
  const setSourceFilter = useCallback((next: string) => setView({ source: next, page: '1' }), [setView])
  const setQuick = useCallback((update: string[] | ((current: string[]) => string[])) => {
    const next = typeof update === 'function' ? update(quick) : update
    setView({ quick: next.join(','), page: '1' })
  }, [quick, setView])
  const setPageSize = useCallback((next: number) => setView({ size: String(next), page: '1' }), [setView])
  const setPage = useCallback((next: number) => setView({ page: String(next) }), [setView])
  const [quickOpen, setQuickOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const { leavingId, leave } = useRowLeaving()
  // 使っている所が0のタグは窓なしで保管し、5秒は「元に戻す」で取り消せる（動きの点検 17 番・旧い一覧と同じ）。
  const deferredDelete = useDeferredDelete()
  const [folderDialog, setFolderDialog] = useState<'new' | TagGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<TagGroup | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  /* 行の「…」メニュー。「フォルダへ移す」はメニューの2段目。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuMoveFor, setMenuMoveFor] = useState<string | null>(null)
  /* 行の詳細パネル。URL に ?tag=<id> を残す。 */
  const [activeTagId, setActiveTagId] = useDetailPanelUrl('tag')
  const openTagDetail = (id: string) => withViewTransition(() => setActiveTagId(id))
  const loadRequestRef = useRef<TagListRequestKey>({ accountId, generation: 0 })

  const load = useCallback(async () => {
    if (fixture) return
    const request = { accountId, generation: loadRequestRef.current.generation + 1 }
    loadRequestRef.current = request
    setStatus('loading')
    try {
      const [tags, folders] = await Promise.all([
        api.tags.list({ withCounts: true, accountId }),
        api.tagGroups.list(accountId),
      ])
      if (!isCurrentTagListRequest(loadRequestRef.current, request)) return
      // `success: false` を黙って捨てない。捨てると空の表を「0件」として見せる。
      if (!tags.success) throw new Error(tags.error)
      setItems(tags.data)
      if (folders.success) setGroups(folders.data)
      setStatus('ready')
    } catch (reason) {
      if (!isCurrentTagListRequest(loadRequestRef.current, request)) return
      setStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [fixture, accountId])
  useEffect(() => { void load() }, [load])

  /* 数の帯のサーバー側の数。一覧とは別の要求なので、失敗しても一覧は止めない（「—」）。 */
  useEffect(() => {
    if (fixture || !accountId) return
    let cancelled = false
    setStats(null)
    setStatsFailed(false)
    void api.listStats.get(accountId).then((res) => {
      if (cancelled) return
      if (res.success) setStats(res.data)
      else setStatsFailed(true)
    }, () => {
      if (!cancelled) setStatsFailed(true)
    })
    return () => { cancelled = true }
  }, [fixture, accountId])

  /* アカウントを切り替えたら、前のアカウントのフォルダ選択と件数を残さない。 */
  useEffect(() => {
    if (fixture) return
    setItems([])
    setGroups([])
    setOpenMenuId(null)
    setMenuMoveFor(null)
  }, [fixture, accountId])

  // アカウントを替えたら、前のアカウントのフォルダとページを残さない（来た瞬間は URL のまま）。
  useOnAccountSwitch(accountId, () => setView({ folder: '', page: '1' }))
  useListScrollMemory(status === 'ready')

  const filtered = useMemo(() => items.filter((tag) => {
    // 保管して「元に戻す」を待っている行は出さない。
    if (deferredDelete.isHidden(tag.id)) return false
    if (query && !tag.name.toLowerCase().includes(query.toLowerCase())) return false
    if (folder === UNGROUPED && tag.groupId) return false
    if (folder && folder !== UNGROUPED && tag.groupId !== folder) return false
    const linked = hasLinkedActions(tag)
    const unused = isUnused(tag)
    if (usageFilter === 'linked' && !linked) return false
    if (usageFilter === 'unused' && !unused) return false
    if (sourceFilter !== 'all' && tag.assignSource !== sourceFilter) return false
    for (const key of quick) {
      if (key === 'unused' && !unused) return false
      if (key === 'recent' && !isThisMonth(tag.createdAt)) return false
      if (key === 'auto' && (!tag.assignSource || tag.assignSource === 'manual')) return false
      if (key === 'linked' && !linked) return false
      if (key === 'starred' && !tag.isStarred) return false
    }
    return true
  }), [items, query, folder, usageFilter, sourceFilter, quick, deferredDelete])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  /* 動かしている間、置き場所を入れ替えて見せ、ほかの行は滑らかに場所を空ける（自動応答と同じ動き）。 */
  const liveOrder = useLiveReorder(visible, (tag) => tag.id, dragId)
  const activeTag = items.find((tag) => tag.id === activeTagId) ?? null
  const activeTagIndex = visible.findIndex((tag) => tag.id === activeTagId)
  const activeGroup = activeTag ? groups.find((item) => item.id === activeTag.groupId) : undefined

  /** アカウント切替直後の1フレームは「未取得」として扱う（v7 と同じ）。 */
  const staleAccount = !fixture && loadRequestRef.current.accountId !== accountId
  const ready = status === 'ready' && !staleAccount

  /* 整理候補の数。未取得は null（「—」）、取得できて0件は 0。 */
  const cleanupCount = cleanupKnown(items, ready)
    ? items.filter((tag) => (tag.cleanupReasons?.length ?? 0) > 0).length
    : null
  const unusedCount = cleanupKnown(items, ready)
    ? items.filter((tag) => tag.cleanupReasons?.includes('unused')).length
    : null

  /* 並び替え。絞り込み中は見えている行だけを入れ替え、隠れた行の位置を保つ。失敗は元に戻す。 */
  const applyTagOrder = async (order: string[]) => {
    const previous = items
    const result = await api.tags.reorder(order)
    if (!result.success) {
      setItems(previous)
      const message = `並び順を保存できませんでした（${result.error}）`
      setActionError(message)
      notifyToast(message, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void applyTagOrder(order) },
      })
    }
  }

  const move = async (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const order = filtered.map((tag) => tag.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((id) => items.find((tag) => tag.id === id)).filter(Boolean) as Tag[]
    setItems(mergeVisibleOrder(items, visibleNext))
    await applyTagOrder(order)
  }

  /** つまみにフォーカスして ↑/↓。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = filtered.map((tag) => tag.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((tid) => items.find((tag) => tag.id === tid)).filter(Boolean) as Tag[]
    setItems(mergeVisibleOrder(items, visibleNext))
    await applyTagOrder(order)
  }

  /* 「一覧に出す」の星。押した瞬間に切り替え、裏で保存。失敗は戻して「もう一度」、成功は「元に戻す」。 */
  const toggleStar = async (tag: Tag) => {
    if (!canEdit) return
    const next = !tag.isStarred
    setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: next } : item))
    try {
      const res = await api.tags.update(tag.id, {
        lineAccountId: tag.lineAccountId ?? null,
        expectedVersion: tag.version ?? 1,
        isStarred: next,
      })
      if (!res.success) throw new Error(res.error)
      const version = res.data?.version
      if (typeof version === 'number') {
        setItems((current) => current.map((item) => item.id === tag.id ? { ...item, version } : item))
      }
      notifyToast(next ? `「${tag.name}」を一覧に出します` : `「${tag.name}」を一覧から外します`, {
        actionLabel: '元に戻す',
        onAction: () => { void toggleStar({ ...tag, isStarred: next }) },
      })
    } catch (reason) {
      setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: tag.isStarred } : item))
      const message = reason instanceof ApiError ? reason.message : '表示の切り替えに失敗しました。通信を確かめて、もう一度お試しください。'
      setActionError(message)
      notifyToast(message, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void toggleStar(tag) },
      })
      void load()
    }
  }

  /* 「フォルダへ移す」。押した瞬間に移して裏で保存。 */
  const moveTagToGroup = async (tag: Tag, groupId: string | null) => {
    setOpenMenuId(null)
    setMenuMoveFor(null)
    setActionError('')
    const previous = tag.groupId ?? null
    if (previous === groupId) return
    setItems((current) => current.map((item) => item.id === tag.id ? { ...item, groupId } : item))
    try {
      const res = await api.tags.setGroup(tag.id, groupId)
      if (!res.success) throw new Error(res.error)
      const groupName = groupId === null ? '未分類' : groups.find((group) => group.id === groupId)?.name ?? 'フォルダ'
      notifyToast(`「${tag.name}」を${groupName}へ移しました`, {
        actionLabel: '元に戻す',
        onAction: () => { void moveTagToGroup({ ...tag, groupId }, previous) },
      })
    } catch (reason) {
      setItems((current) => current.map((item) => item.id === tag.id ? { ...item, groupId: previous } : item))
      const message = reason instanceof ApiError ? reason.message : 'フォルダへ移せませんでした。'
      setActionError(message)
      notifyToast(message, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void moveTagToGroup(tag, groupId) },
      })
      void load()
    }
  }

  /* フォルダの並び順。押した瞬間に並び替え、裏で保存。失敗は戻して「もう一度」。 */
  const moveGroupOrder = async (group: TagGroup, direction: -1 | 1) => {
    const index = groups.findIndex((item) => item.id === group.id)
    const other = groups[index + direction]
    if (!other || folderBusy) return
    const previous = groups
    const next = [...groups]
    next[index] = other
    next[index + direction] = group
    setGroups(next)
    setFolderBusy(true)
    setFolderError('')
    try {
      const [currentResult, otherResult] = await Promise.all([
        api.tagGroups.update(group.id, { sortOrder: index + direction, accountId: group.accountId }),
        api.tagGroups.update(other.id, { sortOrder: index, accountId: other.accountId }),
      ])
      if (!currentResult.success) throw new Error(currentResult.error)
      if (!otherResult.success) throw new Error(otherResult.error)
      void load()
    } catch (reason) {
      setGroups(previous)
      const message = reason instanceof Error ? reason.message : '並び順を変更できませんでした'
      setFolderError(message)
      notifyToast(message, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void moveGroupOrder(group, direction) },
      })
    } finally {
      setFolderBusy(false)
    }
  }

  const removeGroup = async () => {
    if (!deletingGroup || folderBusy) return
    const group = deletingGroup
    setFolderBusy(true)
    setFolderError('')
    try {
      const result = await api.tagGroups.delete(group.id, group.accountId)
      if (!result.success) throw new Error(result.error)
      if (folder === group.id) setFolder('')
      setDeletingGroup(null)
      void load()
    } catch (reason) {
      setFolderError(reason instanceof Error ? reason.message : 'フォルダを削除できませんでした')
    } finally {
      setFolderBusy(false)
    }
  }

  /** 行の「…」。編集・複製・フォルダへ移す・保管する。 */
  const rowMenuItems = (tag: Tag): ActionMenuItem[] => {
    // 閲覧のみには押せない項目を置かない（2026-10-06 オーナー決定）。この「…」は変える項目だけなので空になる。
    if (!canEdit) return []
    if (menuMoveFor === tag.id) {
      return [
        { id: 'move-back', label: '← 操作にもどる', onSelect: () => setMenuMoveFor(null) },
        { id: 'move-ungrouped', label: '未分類', onSelect: () => void moveTagToGroup(tag, null) },
        ...groups.map((group) => ({
          id: `move-${group.id}`,
          label: group.name,
          onSelect: () => void moveTagToGroup(tag, group.id),
        })),
      ]
    }
    const list: ActionMenuItem[] = [
      { id: 'edit', label: '編集', external: true, onSelect: () => router.push(`/tags/edit?id=${tag.id}`) },
      { id: 'copy', label: '複製して作る', external: true, onSelect: () => router.push(`/tags/new?copy=${tag.id}`) },
      { id: 'move', label: 'フォルダへ移す', onSelect: () => setMenuMoveFor(tag.id) },
    ]
    /* 保管済みに戻す口は無いため、同じ確認を繰り返さない（v7 R190）。 */
    if (tag.status !== 'archived') {
      list.push({
        id: 'archive',
        label: '保管する',
        tone: 'danger',
        dividerBefore: true,
        onSelect: () => requestArchive(tag),
      })
    }
    return list
  }

  /*
   * 保管の入口。使っている所が0（友だち0人・どこからも使われていない）と分かっているタグは、
   * 確かめの窓を出さずに一覧から外し、5秒は「元に戻す」で取り消せる。送る直前に影響を読み直し、
   * その間に使われ始めていたら保管せずに行を戻す。それ以外は今までどおり確かめの窓。
   */
  const requestArchive = (tag: Tag) => {
    if (!isUnused(tag) || !accountId) {
      setDeleteTarget(tag)
      return
    }
    if (activeTagId === tag.id) setActiveTagId(null)
    deferredDelete.schedule({
      ids: [tag.id],
      message: `タグ「${tag.name}」を保管しました`,
      commit: () => archiveIfStillUnused(tag.id, accountId),
      onCommitted: () => load(),
      failureMessage: 'タグを保管できませんでした。使われ始めていないか確かめて、もう一度お試しください。',
    })
  }

  /* 右クリックのメニュー。行の「…」と同じ操作。移し先はそのまま並べる。 */
  const tagContextItems = (tag: Tag): ContextMenuItem[] => {
    const list: ContextMenuItem[] = []
    for (const item of rowMenuItems(tag)) {
      if (item.id === 'move-back') continue
      if (item.id === 'move') {
        list.push({ id: 'move-ungrouped', label: '未分類へ移す', onSelect: () => void moveTagToGroup(tag, null) })
        for (const group of groups) {
          list.push({ id: `move-${group.id}`, label: `「${group.name}」へ移す`, onSelect: () => void moveTagToGroup(tag, group.id) })
        }
        continue
      }
      list.push({ id: item.id, label: item.label, danger: item.tone === 'danger', disabled: item.disabled, onSelect: () => item.onSelect() })
    }
    return list
  }

  /* フォルダの列。数は一覧と同じものを数える。 */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: ready ? items.length : null, color: 'var(--color-accent)', icon: <Inbox size={14} aria-hidden="true" /> },
    ...groups.map((group, index) => ({
      id: group.id,
      label: group.name,
      count: ready ? items.filter((tag) => tag.groupId === group.id).length : null,
      color: group.color ?? FOLDER_FALLBACK_COLOR,
      onEdit: canEdit ? () => setFolderDialog(group) : undefined,
      onMoveUp: canEdit && index > 0 ? () => void moveGroupOrder(group, -1) : undefined,
      onMoveDown: canEdit && index < groups.length - 1 ? () => void moveGroupOrder(group, 1) : undefined,
      onDelete: canEdit ? () => setDeletingGroup(group) : undefined,
      deleteNote: '削除しても、中のタグは未分類に残ります。',
    })),
    { id: UNGROUPED, label: '未分類', count: ready ? items.filter((tag) => !tag.groupId).length : null, color: 'var(--color-ink-disabled)', icon: <FolderOpen size={14} aria-hidden="true" /> },
  ]

  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...groups.map((group) => ({ value: group.id, label: `フォルダ：${group.name}` })),
    { value: UNGROUPED, label: 'フォルダ：未分類' },
  ]

  const kpis = [
    { title: '未使用', icon: CircleDashed, value: unusedCount, unit: '件', detail: '友だち0人・どこにも使っていない' },
    { title: '付けている友だち', icon: Users, value: statsFailed ? null : stats?.tags.taggedFriends ?? null, unit: '人', detail: '1つ以上付いている' },
    { title: '今月付けた回数', icon: TagIcon, value: statsFailed ? null : stats?.tags.assignedThisMonth ?? null, unit: '回', detail: '手動・自動' },
    { title: '整理の候補', icon: Sparkles, value: cleanupCount, unit: '件', detail: '未使用・名前が重なっている' },
  ]

  const filterActive = Boolean(query || folder || usageFilter !== 'all' || sourceFilter !== 'all' || quick.length)
  const clearFilters = () => { setView({ q: '', folder: '', usage: 'all', source: 'all', quick: '', page: '1' }) }

  // 閲覧のみには押せない作るボタンを置かない（2026-10-06 オーナー決定）。
  const createButton = (wide: boolean) => status === 'forbidden' || !canEdit ? null : (
    <Button href="/tags/new" variant="primary" className={wide ? styles.createWide : undefined}><Plus size={15} aria-hidden="true" />タグを作る</Button>
  )

  const search = (
    <span className={narrow ? styles.searchNarrow : styles.search}>
      <SearchField
        aria-label="タグ名・用途で探す"
        placeholder="タグ名・用途で探す"
        value={query}
        onChange={setQuery}
        onClear={() => setQuery('')}
      />
    </span>
  )
  const usageSelect = (
    <Select
      aria-label="使用状態で絞り込む"
      width={145}
      value={usageFilter}
      onChange={setUsageFilter}
      options={[
        { value: 'all', label: '使用状態：すべて' },
        { value: 'linked', label: '使用状態：連動あり' },
        { value: 'unused', label: '使用状態：未使用' },
      ]}
    />
  )
  const sourceSelect = (
    <Select
      aria-label="付け方で絞り込む"
      width={132}
      value={sourceFilter}
      onChange={setSourceFilter}
      options={[
        { value: 'all', label: '付け方：すべて' },
        ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label: `付け方：${label}` })),
      ]}
    />
  )
  /* 「よく使う絞り込み」：重ねて絞れる5つ（v7 の QUICK_FILTERS）。開いたメニューで入れ切り。 */
  const quickItems: ActionMenuItem[] = [
    ...QUICK_FILTERS.map(([value, label]) => ({
      id: `quick-${value}`,
      label,
      icon: quick.includes(value) ? <Check size={14} aria-hidden="true" /> : <span className={styles.checkSpace} aria-hidden="true" />,
      onSelect: () => setQuick((current) => current.includes(value) ? current.filter((key) => key !== value) : [...current, value]),
    })),
    ...(quick.length ? [{ id: 'quick-clear', label: 'すべて外す', dividerBefore: true, onSelect: () => setQuick([]) }] : []),
  ]
  const quickButton = (
    <span className={styles.menuAnchor}>
      <Button
        type="button"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={quickOpen}
        aria-label={quick.length ? `よく使う絞り込み（${quick.length}件選択中）` : 'よく使う絞り込み'}
        title="よく使う絞り込み"
        data-active={quick.length > 0 || undefined}
        className={styles.quickButton}
        onClick={() => setQuickOpen((open) => !open)}
      >
        <Bookmark size={15} aria-hidden="true" />
        {narrow ? null : <span>よく使う絞り込み</span>}
      </Button>
      <ActionMenu open={quickOpen} onClose={() => setQuickOpen(false)} ariaLabel="よく使う絞り込み" items={quickItems} />
    </span>
  )
  const pageSizeSelect = (
    <PageSizeSelect value={pageSize} onChange={(value) => setPageSize(value || 20)} options={PAGE_SIZES} label={null} />
  )

  const folderNote = (
    <>
      <p className={styles.folderNote}>フォルダを消しても、中のタグは未分類に残ります</p>
      {folderError ? (
        <p role="alert" className={styles.folderNote}>
          {folderError}
          <button type="button" onClick={() => void load()} className={styles.inlineRetry}>もう一度</button>
        </p>
      ) : null}
    </>
  )

  const table = status === 'forbidden' ? (
    <div className={styles.stateCard}>
      <AlertCircle className={styles.stateIconError} aria-hidden="true" />
      <p className={styles.stateTitle}>タグを見る権限がありません</p>
      <p className={styles.stateDesc}>タグを見るには権限が要ります。オーナーか管理者に追加を依頼してください。</p>
    </div>
  ) : status === 'error' ? (
    <div className={styles.stateCard} data-design-node="U0aKD">
      <AlertCircle className={styles.stateIconError} aria-hidden="true" />
      <p className={styles.stateTitle}>タグを読み込めませんでした</p>
      <p className={styles.stateDesc}>再読み込みしても直らない場合はエラー報告へ。</p>
      <Button type="button" onClick={() => void load()}>もう一度試す</Button>
    </div>
  ) : ready && visible.length === 0 ? (
    /* 修正案 D-2：空の一覧。 */
    <EmptyList
      data-design-node="U0aKD"
      icon={<TagIcon aria-hidden="true" />}
      title="まだタグがありません"
      description="友だちに目印を付けて、配信の絞り込みや対応の振り分けに使います。"
      create={{ label: '最初のタグを作る', href: '/tags/new' }}
      canCreate={canEdit}
      filtered={items.length > 0}
      onClearFilters={filterActive ? clearFilters : undefined}
      filteredDescription="検索語・フォルダ・絞り込みを外すと、すべて出ます"
    />
  ) : (
    <DelayedSkeleton loading={!ready} skeleton={<div className={styles.skeleton} data-design-node="U0aKD" aria-busy="true" />}>
      <DataTable className={styles.table} data-design="TagTable">
        <thead>
          <TableHeadRow>
            <Th className={styles.colStar}>
              <Star className={styles.headStar} aria-hidden="true" />
              <span className="sr-only">一覧に出す</span>
            </Th>
            <Th className={styles.colName}>タグ</Th>
            {/* 左にフォルダの列があるときは表にフォルダ列を置かず、名前の前に色の丸（2026-10-07 オーナー）。1152 は列を畳むので表に出す（絵 aPeD8）。 */}
            {narrow ? <Th className={styles.colFolder}>フォルダ</Th> : null}
            <Th className={styles.colCount}>人数</Th>
            <Th className={styles.colSource}>付け方</Th>
            <Th className={styles.colLink}>連動</Th>
            <Th className={styles.colUsage}>使っている所</Th>
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <RovingTbody reorderKey={liveOrder.shown.map((tag) => tag.id).join(',')}>
          {liveOrder.shown.map((tag) => {
            const group = groups.find((item) => item.id === tag.groupId)
            const editHref = `/tags/edit?id=${tag.id}`
            return (
              <Tr
                interactive
                key={tag.id}
                data-reorder-id={tag.id}
                onDragEnter={() => liveOrder.enter(tag.id)}
                onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                onDrop={dragId ? () => void move(liveOrder.dropTarget(tag.id)) : undefined}
                className={styles.row}
                leaving={leavingId === tag.id}
                tabIndex={0}
                onClick={() => openTagDetail(tag.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    openTagDetail(tag.id)
                  }
                }}
              >
                <Td className={styles.colStar} onClick={(event) => event.stopPropagation()}>
                  {canEdit ? (
                    <button
                      type="button"
                      className={styles.starButton}
                      data-on={Boolean(tag.isStarred)}
                      aria-pressed={Boolean(tag.isStarred)}
                      aria-label={tag.isStarred ? '友だち一覧に表示しない' : '友だち一覧に表示する'}
                      title={tag.isStarred ? '友だち一覧に表示しない' : '友だち一覧に表示する'}
                      onClick={() => void toggleStar(tag)}
                    >
                      <Star className={styles.starIcon} aria-hidden="true" />
                    </button>
                  ) : (
                    // 閲覧のみ：押せる星は置かず、友だち一覧に出しているかの印だけを見せる。
                    <span
                      className={styles.starButton}
                      data-on={Boolean(tag.isStarred)}
                      role="img"
                      aria-label={tag.isStarred ? '友だち一覧に表示している' : '友だち一覧に表示していない'}
                      title={tag.isStarred ? '友だち一覧に表示している' : '友だち一覧に表示していない'}
                    >
                      <Star className={styles.starIcon} aria-hidden="true" />
                    </span>
                  )}
                </Td>
                <Td className={styles.colName}>
                  <ContextMenu label={`タグ「${tag.name}」の操作`} items={tagContextItems(tag)}>
                    <div className={styles.nameRow}>
                      <span
                        className={styles.gripBox}
                        draggable={canEdit}
                        onClick={(event) => event.stopPropagation()}
                        onDragStart={() => setDragId(tag.id)}
                        onDragEnd={() => setDragId(null)}
                      >
                        {/* 閲覧のみ：つまみは隠し、幅だけ空けて名前の位置を保つ */}
                        {canEdit ? (
                          <ReorderGrip label={tag.name} onMove={(direction) => void keyboardMove(tag.id, direction)}>
                            <GripVertical className={styles.gripIcon} aria-hidden="true" />
                          </ReorderGrip>
                        ) : (
                          <span className={styles.gripSpace} aria-hidden="true"><GripVertical className={styles.gripIcon} /></span>
                        )}
                      </span>
                      {narrow ? (
                        <Link href={editHref} className={styles.name} title={tag.name} onClick={(event) => event.stopPropagation()}>{tag.name}</Link>
                      ) : (
                        <FolderDotName folder={group ? { name: group.name, color: group.color ?? FOLDER_FALLBACK_COLOR } : null}>
                          <Link href={editHref} className={styles.name} title={tag.name} onClick={(event) => event.stopPropagation()}>{tag.name}</Link>
                        </FolderDotName>
                      )}
                      {tag.status === 'archived' ? <span className={styles.miniBadge}>保管済み</span> : null}
                      {tag.cleanupReasons?.includes('duplicate_name') ? (
                        <span className={`${styles.miniBadge} ${styles.miniBadgeWarn}`} title="正規化した名前がほかのタグと重なっています。整理候補です。">名前が重なっている</span>
                      ) : null}
                    </div>
                    <p className={styles.sub}>{`${formatDate(tag.createdAt)}登録`}</p>
                  </ContextMenu>
                </Td>
                {narrow ? (
                  <Td className={styles.colFolder}>
                    <span className={styles.folderCell} title={group?.name ?? '未分類'}>
                      {group ? (
                        <Folder className={styles.folderIcon} aria-hidden="true" color={group.color ?? FOLDER_FALLBACK_COLOR} fill={group.color ?? FOLDER_FALLBACK_COLOR} />
                      ) : (
                        <FolderOpen className={styles.folderIcon} aria-hidden="true" />
                      )}
                      <span className={styles.truncate}>{group?.name ?? '未分類'}</span>
                    </span>
                  </Td>
                ) : null}
                {/* 人数は、そのタグで絞った友だち一覧へのリンク。 */}
                <Td className={styles.colCount} onClick={(event) => event.stopPropagation()}>
                  <Link href={`/friends?tag=${encodeURIComponent(tag.id)}`} className={styles.countLink} title={`「${tag.name}」が付いている友だちを見る`}>
                    {tag.friendCount ?? 0}人
                  </Link>
                </Td>
                <Td className={styles.colSource}><span className={styles.cellText} title={sourceLabel(tag)}>{sourceLabel(tag)}</span></Td>
                <Td className={styles.colLink}><span className={styles.cellText} title={tagLinkText(tag)}>{tagLinkText(tag)}</span></Td>
                <Td className={styles.colUsage}><span className={styles.cellText} title={usageLabel(tag)}>{usageLabel(tag)}</span></Td>
                <Td className={styles.colMenu} onClick={(event) => event.stopPropagation()}>
                  {/* 閲覧のみ：「…」の中は変える項目だけなので、ボタンごと置かない（列の幅は残す） */}
                  {canEdit ? <span className={styles.menuAnchor}>
                    <RowMenu
                      className={styles.menuButton}
                      label={`タグ「${tag.name}」の操作`}
                      items={rowMenuItems(tag)}
                      open={openMenuId === tag.id}
                      onOpenChange={(next) => {
                        setMenuMoveFor(null)
                        setOpenMenuId(next ? tag.id : null)
                      }}
                    />
                  </span> : null}
                </Td>
              </Tr>
            )
          })}
        </RovingTbody>
      </DataTable>

      {/* 件数とページ送り（絵：左に件数・右にページ送り）。表示件数は道具の段の右端。 */}
      <div className={styles.pager}>
        <span className={styles.pagerCount}>
          {`${filtered.length}件中 ${filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, filtered.length)}件`}
        </span>
        {pages > 1 ? (
          <Pagination page={currentPage} pageCount={pages} onPageChange={setPage} ariaLabel="タグのページ送り" />
        ) : null}
      </div>
    </DelayedSkeleton>
  )

  return (
    <>
      {/* 数の帯（絵の4つ）。並びと線は共有の帯に任せる。 */}
      <KpiBand data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.title}
            presentation="band"
            title={kpi.title}
            icon={<kpi.icon size={13} aria-hidden="true" />}
            value={kpi.value}
            unit={kpi.value == null ? '' : kpi.unit}
            detail={kpi.detail}
          />
        ))}
      </KpiBand>

      <ListPageBody
        folders={<>
          {createButton(true) ?? (status === 'forbidden' ? null : <span className={styles.viewerCreateSpace} aria-hidden="true" />)}
          <FolderPanel
            activeId={folder}
            onSelect={setFolder}
            onAddFolder={canEdit ? () => setFolderDialog('new') : undefined}
            addFolderLabel="フォルダを追加"
            rows={folderRows}
          >
            {folderNote}
          </FolderPanel>
        </>}
        collapsedFolders={<>
          {createButton(false)}
          <Select aria-label="フォルダ" width={150} value={folder} onChange={setFolder} options={folderSelectOptions} />
        </>}
        toolbar={narrow ? <>
          {/* 1152（aPeD8）：1段目＝作る・フォルダ・探す・使用状態、2段目＝付け方・よく使う・右端に表示件数。 */}
          {search}
          {usageSelect}
          <div className={styles.toolbarRow2}>
            {sourceSelect}
            {quickButton}
            <span className={styles.toolbarSpacer} />
            {pageSizeSelect}
          </div>
        </> : <>
          {search}
          {usageSelect}
          {sourceSelect}
          <span className={styles.toolbarSpacer} />
          {quickButton}
          {pageSizeSelect}
        </>}
      >
        {actionError ? (
          <p role="alert" className={styles.errorBand}>
            <AlertCircle className={styles.errorIcon} aria-hidden="true" />
            {actionError}
            <button type="button" onClick={() => { setActionError(''); void load() }}>読み直す</button>
          </p>
        ) : null}
        {table}
      </ListPageBody>

      {/* 行の詳細パネル。フォルダの入力中はそちらを出す。 */}
      {folderDialog ? null : (
        <DetailPanel
          open={activeTag !== null}
          title={activeTag?.name ?? ''}
          description={activeTag ? `${activeGroup?.name ?? '未分類'}・${activeTag.friendCount ?? 0}人` : undefined}
          onClose={() => setActiveTagId(null)}
          hasPrev={activeTagIndex > 0}
          hasNext={activeTagIndex >= 0 && activeTagIndex < visible.length - 1}
          onPrev={activeTagIndex > 0 ? () => setActiveTagId(visible[activeTagIndex - 1].id) : undefined}
          onNext={activeTagIndex >= 0 && activeTagIndex < visible.length - 1 ? () => setActiveTagId(visible[activeTagIndex + 1].id) : undefined}
          footer={activeTag ? (
            <>
              <Button href={`/tags/edit?id=${activeTag.id}`}>編集する</Button>
              <Button href={`/tags/new?copy=${activeTag.id}`}>複製して作る</Button>
            </>
          ) : undefined}
        >
          {activeTag ? (
            <dl className={styles.detailList}>
              <div><dt>フォルダ</dt><dd>{activeGroup?.name ?? '未分類'}</dd></div>
              <div>
                <dt>人数</dt>
                <dd>
                  <Link href={`/friends?tag=${encodeURIComponent(activeTag.id)}`} className={styles.countLink}>
                    {activeTag.friendCount ?? 0}人
                  </Link>
                </dd>
              </div>
              <div><dt>付け方</dt><dd>{sourceLabel(activeTag)}</dd></div>
              <div><dt>連動</dt><dd>{tagLinkText(activeTag)}</dd></div>
              <div><dt>使っている所</dt><dd>{usageLabel(activeTag)}</dd></div>
              <div><dt>登録日</dt><dd>{formatDate(activeTag.createdAt)}</dd></div>
            </dl>
          ) : null}
        </DetailPanel>
      )}

      {csvOpen ? <TagCsvImportDialog open onClose={onCsvClose} onCompleted={() => void load()} /> : null}

      {folderDialog ? (
        <TagFolderDialog
          group={folderDialog === 'new' ? undefined : folderDialog}
          accountId={accountId}
          onClose={() => setFolderDialog(null)}
          onSaved={() => void load()}
        />
      ) : null}

      <ConfirmDialog
        open={deletingGroup !== null}
        title={deletingGroup ? `「${deletingGroup.name}」を削除しますか？` : 'フォルダを削除しますか？'}
        description="削除しても、中のタグは未分類に残ります。この操作は元に戻せません。"
        confirmLabel="フォルダを削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => { if (!folderBusy) setDeletingGroup(null) }}
        onConfirm={() => void removeGroup()}
      />

      {deleteTarget && (
        <DeleteTagDialog
          tag={deleteTarget}
          accountId={accountId}
          onCancel={() => setDeleteTarget(null)}
          onArchived={(result) => {
            const id = deleteTarget?.id
            setDeleteTarget(null)
            if (result) notifyToast(result)
            if (id) leave(id, () => load())
            else void load()
          }}
        />
      )}
    </>
  )
}
