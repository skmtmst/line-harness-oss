'use client'

/*
 * ★V8 友だち属性「タグ」タブの一覧（Pencil `I1E7Bt`、フォルダ窓 `IjVpM`、
 * 状態の板 `U0aKD`）。
 *
 * 数え方・絞り込み・並べ替え・保管の判断は v7（`tags-page-v4.tsx`）と
 * 同じ関数を使う。変えたのは置き場だけ——作る口はフォルダの列の上、
 * フォルダの追加は列の下、行の操作は右端の「…」、人数はリンク。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CalendarPlus, ListChecks, MoreHorizontal, Tag as TagIcon, Users, X } from 'lucide-react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError, type ListStats } from '@/lib/api'
import { FOLDER_COLORS } from '@/components/shared/folder-add-dialog'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { notifyToast } from '@/components/shared/toast'
import Button from '@/components/shared/button'
import MultiSelect from '@/components/shared/multi-select'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import { TableHeadRow, Th } from '@/components/shared/table'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { mergeVisibleOrder } from '@/components/friend-fields/reorder-utils'
import TagCsvImportDialog from '@/components/friend-fields/tag-csv-import-dialog'
import { isCurrentTagListRequest, type TagListRequestKey } from '@/components/friend-fields/tag-list-state'
import {
  FOLDER_FALLBACK_COLOR,
  DeleteTagDialog,
  GripIcon,
  QUICK_FILTERS,
  SOURCE_LABELS,
  StarIcon,
  UNGROUPED,
  cleanupKnown,
  formatDate,
  hasLinkedActions,
  isThisMonth,
  isUnused,
  sourceLabel,
  usageLabel,
} from '@/components/friend-fields/tags-page-v4'
import styles from './list-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 連動の札（v7 `linkChips` と同じ文言）。色だけ V8 の部品へ写す。
 * 灰の「他N」はマイル以外の連動アクションの数。0件は出さない。
 */
function tagLinkChips(tag: Tag): Array<{ label: string; className: string }> {
  const chips: Array<{ label: string; className: string }> = []
  if (tag.mileageReward) chips.push({ label: `本人+${tag.mileageReward}`, className: styles.linkChipAccent })
  if (tag.referralMileageReward) chips.push({ label: `紹介+${tag.referralMileageReward}`, className: styles.linkChipAccent })
  if (tag.mileageMultiplierBps) chips.push({ label: `${tag.mileageMultiplierBps / 10000}倍`, className: styles.linkChipWarn })
  if (tag.otherActionCount) chips.push({ label: `他${tag.otherActionCount}`, className: styles.linkChipNeutral })
  return chips
}

/**
 * タグのフォルダ追加・編集の窓（Pencil `IjVpM`）。
 *
 * 共通の FolderAddDialog は `folders` 表（api.folders）を書く。
 * タグの分類は `tag_groups` 表なので、この画面だけの窓を持つ
 * （中身の形と色の並びは FolderAddDialog と同じ）。
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
  const dialogRef = useOverlayFocus(true, onClose, saving)

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
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div role="dialog" aria-modal="true" aria-label={group ? 'フォルダを直す' : 'フォルダを追加'} className="bg-canvas rounded-panel w-full max-w-md p-5 shadow-float">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-ink text-base font-bold">{group ? 'フォルダを直す' : 'フォルダを追加'}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <p className="text-ink-faint mt-1 text-xs leading-relaxed">
          タグを分けてしまう箱です。消しても、入っていたタグは未分類として残ります。
        </p>
        <label className="mt-4 block">
          <span className="text-ink-secondary mb-1 block text-xs font-medium">
            フォルダ名 <span className="text-danger">*</span>
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
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          />
        </label>
        <div className="mt-3">
          <span className="text-ink-secondary mb-1 block text-xs font-medium">色</span>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`色 ${c}`}
                aria-pressed={color === c}
                style={{ backgroundColor: c }}
                className={`rounded-pill h-7 w-7 ${color === c ? 'ring-accent ring-2 ring-offset-2' : ''}`}
              />
            ))}
          </div>
        </div>
        {error ? <p className="text-danger mt-3 text-xs" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-4 py-2 text-sm">
            キャンセル
          </button>
          <Button variant="primary" type="button" onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? (group ? '保存中…' : '追加中…') : (group ? '保存する' : 'フォルダを作る')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function TagsTabV8({
  accountId,
  fixture,
  canEdit,
  csvOpen,
  onCsvClose,
}: {
  accountId: string | null
  fixture?: { items: Tag[]; groups: TagGroup[] }
  canEdit: boolean
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
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [usageFilter, setUsageFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [quick, setQuick] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  /* フォルダの窓と操作の状態。 */
  const [folderDialog, setFolderDialog] = useState<'new' | TagGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<TagGroup | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  /* 行の「…」メニュー。「フォルダへ移す」はメニューの2段目。 */
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuMoveFor, setMenuMoveFor] = useState<string | null>(null)
  /*
   * ActionMenu は項目を選ぶと必ず onClose を呼ぶ。「フォルダへ移す」は
   * 閉じずに2段目へ切り替えるため、選んだ直後の onClose だけ見送る印。
   * （一斉配信の一覧と同じ直し。2段目を選ぶと閉じない不具合があった）
   */
  const keepMenuOpenRef = useRef(false)
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

  /*
   * 数の帯のサーバー側の数（付けている友だち・今月付けた回数）。
   * 一覧とは別の要求なので、失敗しても一覧は止めない（カードは「—」）。
   */
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

  /*
   * アカウントを切り替えたら、前のアカウントのフォルダ選択と件数を残さない
   * （v7 と同じ、#981 A04-02）。
   */
  useEffect(() => {
    if (fixture) return
    setItems([])
    setGroups([])
    setFolder('')
    setPage(1)
    setOpenMenuId(null)
    setMenuMoveFor(null)
  }, [fixture, accountId])

  const filtered = useMemo(() => items.filter((tag) => {
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
  }), [items, query, folder, usageFilter, sourceFilter, quick])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [query, folder, usageFilter, sourceFilter, quick, pageSize])

  /** アカウント切替直後の1フレームは「未取得」として扱う（v7 と同じ）。 */
  const staleAccount = !fixture && loadRequestRef.current.accountId !== accountId
  const ready = status === 'ready' && !staleAccount

  /* 整理候補の数。未取得は null（「—」）、取得できて0件は 0。v7 と同じ。 */
  const cleanupCount = cleanupKnown(items, ready)
    ? items.filter((tag) => (tag.cleanupReasons?.length ?? 0) > 0).length
    : null
  const unusedCount = cleanupKnown(items, ready)
    ? items.filter((tag) => tag.cleanupReasons?.includes('unused')).length
    : null

  /*
   * 並び替え（v7 と同じ）。絞り込み中は見えている行だけを入れ替え、
   * 隠れた行の位置を保つ。失敗した並びは元に戻す。
   */
  const applyTagOrder = async (order: string[]) => {
    const previous = items
    const result = await api.tags.reorder(order)
    if (!result.success) {
      setItems(previous)
      setActionError(`並び順を保存できませんでした（${result.error}）`)
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

  /** つまみにフォーカスして ↑/↓（N-049）。 */
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

  /** 「一覧に出す」の星（v7 と同じ。押した瞬間に切り替え、失敗は戻す）。 */
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
    } catch (reason) {
      setItems((current) => current.map((item) => item.id === tag.id ? { ...item, isStarred: tag.isStarred } : item))
      setActionError(reason instanceof ApiError ? reason.message : '表示の切り替えに失敗しました。通信を確かめて、もう一度お試しください。')
      void load()
    }
  }

  /* 「フォルダへ移す」（v7 は編集画面でやっていた操作を行の「…」から）。 */
  const moveTagToGroup = async (tag: Tag, groupId: string | null) => {
    setOpenMenuId(null)
    setMenuMoveFor(null)
    setActionError('')
    try {
      const res = await api.tags.setGroup(tag.id, groupId)
      if (!res.success) throw new Error(res.error)
      void load()
    } catch (reason) {
      setActionError(reason instanceof ApiError ? reason.message : 'フォルダへ移せませんでした。')
    }
  }

  /* フォルダの並び順（v7 FolderList と同じ、隣との順位交換）。 */
  const moveGroupOrder = async (group: TagGroup, direction: -1 | 1) => {
    const index = groups.findIndex((item) => item.id === group.id)
    const other = groups[index + direction]
    if (!other || folderBusy) return
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
      setFolderError(reason instanceof Error ? reason.message : '並び順を変更できませんでした')
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

  /** 行の「…」。複製・フォルダへ移す・保管する（行を押すと編集）。 */
  const rowMenuItems = (tag: Tag): ActionMenuItem[] => {
    if (menuMoveFor === tag.id) {
      return [
        { id: 'move-back', label: '← 操作にもどる', onSelect: () => { keepMenuOpenRef.current = true; setMenuMoveFor(null) } },
        { id: 'move-ungrouped', label: '未分類', onSelect: () => void moveTagToGroup(tag, null) },
        ...groups.map((group) => ({
          id: `move-${group.id}`,
          label: group.name,
          onSelect: () => void moveTagToGroup(tag, group.id),
        })),
      ]
    }
    const readonly = !canEdit
    const readonlyReason = '閲覧のみのため変更できません'
    const items_: ActionMenuItem[] = [
      { id: 'edit', label: '編集', external: true, disabled: readonly, disabledReason: readonly ? readonlyReason : undefined, onSelect: () => router.push(`/tags/edit?id=${tag.id}`) },
      { id: 'copy', label: '複製して作る', external: true, disabled: readonly, disabledReason: readonly ? readonlyReason : undefined, onSelect: () => router.push(`/tags/new?copy=${tag.id}`) },
      { id: 'move', label: 'フォルダへ移す', disabled: readonly, disabledReason: readonly ? readonlyReason : undefined, onSelect: () => { keepMenuOpenRef.current = true; setMenuMoveFor(tag.id) } },
    ]
    /* 保管済みに戻す口は無いため、同じ確認を繰り返さない（v7 R190）。 */
    if (tag.status !== 'archived') {
      items_.push({
        id: 'archive',
        label: '保管する',
        tone: 'danger',
        dividerBefore: true,
        disabled: readonly,
        disabledReason: readonly ? readonlyReason : undefined,
        onSelect: () => setDeleteTarget(tag),
      })
    }
    return items_
  }

  /* フォルダの列。数は一覧と同じものを数える（v7 と同じ）。 */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: ready ? items.length : null, color: 'var(--color-accent)' },
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
    { id: UNGROUPED, label: '未分類', count: ready ? items.filter((tag) => !tag.groupId).length : null, color: 'var(--color-ink-disabled)' },
  ]

  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...groups.map((group) => ({ value: group.id, label: `フォルダ：${group.name}` })),
    { value: UNGROUPED, label: 'フォルダ：未分類' },
  ]

  const kpis = [
    { title: '未使用', icon: TagIcon, value: unusedCount, unit: '件', detail: '友だち0人・参照0件' },
    { title: '付けている友だち', icon: Users, value: statsFailed ? null : stats?.tags.taggedFriends ?? null, unit: '人', detail: '1つ以上付与' },
    { title: '今月付けた回数', icon: CalendarPlus, value: statsFailed ? null : stats?.tags.assignedThisMonth ?? null, unit: '回', detail: '手動・自動' },
    { title: '整理の候補', icon: ListChecks, value: cleanupCount, unit: '件', detail: '未使用・重複名' },
  ]

  const filterActive = Boolean(query || folder || usageFilter !== 'all' || sourceFilter !== 'all' || quick.length)

  return (
    <>
      {/* 数の帯（設計の4枚。「付けている友だち」「今月付けた回数」「整理の候補」）。 */}
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.title} className={styles.kpi}>
            <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
            <p className={styles.kpiValue}>{kpi.value ?? '—'}<span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span></p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      <div className={styles.split}>
        {/* 左のフォルダの列。いちばん上は「タグを作る」、列の下に「フォルダを追加」。 */}
        <div className={styles.folderCol}>
          {status === 'forbidden' ? null : canEdit ? (
            <Button href="/tags/new" variant="primary" className="w-full">＋ タグを作る</Button>
          ) : (
            <Button type="button" variant="primary" className="w-full" disabled>＋ タグを作る</Button>
          )}
          <FolderPanel
            activeId={folder}
            onSelect={setFolder}
            onAddFolder={canEdit ? () => setFolderDialog('new') : undefined}
            addFolderDisabled={!canEdit}
            addFolderLabel="フォルダを追加"
            rows={folderRows}
          >
            <p className={styles.folderNote}>
              フォルダを削除しても、中のタグは未分類として残ります。件数には保管済みのタグも含みます。
            </p>
            {folderError ? (
              <p role="alert" className={styles.folderNote}>
                {folderError}
                <button type="button" onClick={() => void load()} className="text-action ml-2 font-semibold hover:underline">
                  もう一度
                </button>
              </p>
            ) : null}
          </FolderPanel>
        </div>

        <div className={styles.listCol}>
          {/* 道具の段：検索・選ぶ欄 2 つ・右に「よく使う絞り込み」。狭い板では「タグを作る」とフォルダ選びがここへ畳まれる。 */}
          <div className={styles.toolbar}>
            {status === 'forbidden' ? null : (
              canEdit ? (
                <Button href="/tags/new" variant="primary" className={styles.toolbarCreate}>＋ タグを作る</Button>
              ) : (
                <Button type="button" variant="primary" className={styles.toolbarCreate} disabled>＋ タグを作る</Button>
              )
            )}
            <div className={styles.folderSelectWrap}>
              <Select
                aria-label="フォルダ"
                value={folder}
                onChange={setFolder}
                options={folderSelectOptions}
              />
            </div>
            <div className={styles.searchWrap}>
              <SearchField
                aria-label="タグ名・用途で検索"
                placeholder="タグ名・用途で検索"
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
              />
            </div>
            <Select
              aria-label="使用状態で絞り込む"
              value={usageFilter}
              onChange={setUsageFilter}
              options={[{ value: 'all', label: '使用状態：すべて' }, { value: 'linked', label: '連動あり' }, { value: 'unused', label: '未使用' }]}
            />
            <Select
              aria-label="付与元で絞り込む"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[{ value: 'all', label: '付与元：すべて' }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
            />
            <span className={styles.toolbarSpacer} />
            <span className={styles.quickWrap}>
              <MultiSelect
                aria-label="よく使う絞り込み"
                className="w-full"
                maxChips={1}
                onChange={setQuick}
                options={QUICK_FILTERS.map(([value, label]) => ({ value, label }))}
                placeholder="よく使う"
                values={quick}
              />
            </span>
          </div>

          {actionError ? (
            <p role="alert" className={styles.errorBand}>
              {actionError}
              <button type="button" onClick={() => void load()}>読み直す</button>
            </p>
          ) : null}

          {status === 'loading' || staleAccount ? (
            <div className={styles.skeletonRows} role="status">
              <span className="sr-only">読み込んでいます</span>
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className={styles.skeletonRow}>
                  <span className={styles.skeletonDot} />
                  <span className={styles.skeletonBar} />
                  <span className={styles.skeletonBar} style={{ maxWidth: 120 }} />
                  <span className={styles.skeletonBar} style={{ maxWidth: 160 }} />
                </div>
              ))}
            </div>
          ) : status === 'forbidden' ? (
            <div className={styles.stateCard}>
              <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>タグを見る権限がありません</p>
              <p className={styles.stateDesc}>タグを見るには権限が要ります。オーナーか管理者に追加を依頼してください。</p>
            </div>
          ) : status === 'error' ? (
            <div className={styles.stateCard}>
              <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>タグを読み込めませんでした</p>
              <p className={styles.stateDesc}>再読み込みしても直らない場合はエラー報告へ。</p>
              <Button type="button" onClick={() => void load()}>もう一度試す</Button>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateCard}>
              <span className={styles.stateIcon}>
                <TagIcon size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>まだタグがありません</p>
              <p className={styles.stateDesc}>「＋ タグを作る」から最初の1つを作ると、ここに並びます。</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.stateCard}>
              <p className={styles.stateTitle}>条件に合うタグはありません</p>
              <p className={styles.stateDesc}>検索語・フォルダ・絞り込みを変えてください。</p>
              {filterActive ? (
                <Button type="button" onClick={() => { setQuery(''); setFolder(''); setUsageFilter('all'); setSourceFilter('all'); setQuick([]) }}>
                  条件を外す
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <TableHeadRow>
                      <Th style={{ width: 44 }}><span className="sr-only">並び替え</span></Th>
                      <Th>タグ</Th>
                      <Th>フォルダ</Th>
                      <Th>人数</Th>
                      <Th>付け方</Th>
                      <Th>連動</Th>
                      <Th>使用先</Th>
                      <Th style={{ width: 56 }}>一覧に出す</Th>
                      <Th className={styles.menuCell}><span className="sr-only">操作</span></Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {visible.map((tag) => {
                      const group = groups.find((item) => item.id === tag.groupId)
                      const chips = tagLinkChips(tag)
                      const editHref = `/tags/edit?id=${tag.id}`
                      return (
                        <tr
                          key={tag.id}
                          className={styles.rowClick}
                          tabIndex={0}
                          onClick={() => router.push(editHref)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              router.push(editHref)
                            }
                          }}
                        >
                          <td
                            draggable={canEdit}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={() => setDragId(tag.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => void move(tag.id)}
                            className={styles.gripCell}
                            data-fixed={!canEdit}
                          >
                            <ReorderGrip label={tag.name} disabled={!canEdit} disabledReason="閲覧のみのため並び替えできません" onMove={(direction) => void keyboardMove(tag.id, direction)}><GripIcon /></ReorderGrip>
                          </td>
                          <td>
                            <div className={styles.nameRow}>
                              <span className={styles.folderDot} style={{ backgroundColor: group?.color ?? FOLDER_FALLBACK_COLOR }} />
                              <Link href={editHref} className={styles.cellTitle} title={tag.name} onClick={(event) => event.stopPropagation()}>{tag.name}</Link>
                              {tag.status === 'archived' && <span className={styles.miniBadge}>保管済み</span>}
                              {tag.cleanupReasons?.includes('duplicate_name') && <span className={`${styles.miniBadge} ${styles.miniBadgeWarn}`} title="正規化した名前がほかのタグと重なっています。整理候補です。">重複名</span>}
                            </div>
                            <p className={styles.cellSub}>{formatDate(tag.createdAt)} 登録</p>
                          </td>
                          <td className={styles.cellMuted}><span className={styles.cellTruncate} title={group?.name ?? '未分類'}>{group?.name ?? '未分類'}</span></td>
                          {/* 人数は、そのタグで絞った友だち一覧へのリンク（V8 の新しい導線）。 */}
                          <td onClick={(event) => event.stopPropagation()}>
                            <Link href={`/friends?tag=${encodeURIComponent(tag.id)}`} className={styles.countLink} title={`「${tag.name}」が付いている友だちを見る`}>
                              {tag.friendCount ?? 0}人
                            </Link>
                          </td>
                          <td className={styles.cellMuted}><span className={styles.cellTruncate} title={sourceLabel(tag)}>{sourceLabel(tag)}</span></td>
                          <td>
                            <div className={styles.linkChips}>
                              {chips.length === 0
                                ? <span className={styles.cellMuted}>—</span>
                                : chips.map((chip) => <span key={chip.label} className={`${styles.linkChip} ${chip.className}`}>{chip.label}</span>)}
                            </div>
                          </td>
                          <td className={styles.cellMuted}><span className={styles.cellTruncate} title={usageLabel(tag)}>{usageLabel(tag)}</span></td>
                          <td onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.starButton}
                              data-on={Boolean(tag.isStarred)}
                              disabled={!canEdit}
                              aria-pressed={Boolean(tag.isStarred)}
                              aria-label={tag.isStarred ? '友だち一覧に表示しない' : '友だち一覧に表示する'}
                              title={canEdit ? undefined : '閲覧のみのため変更できません'}
                              onClick={() => void toggleStar(tag)}
                            >
                              <StarIcon filled={Boolean(tag.isStarred)} />
                            </button>
                          </td>
                          <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.menuButton}
                              aria-label={`タグ「${tag.name}」の操作`}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === tag.id}
                              title={`タグ「${tag.name}」の操作`}
                              onClick={() => {
                                setMenuMoveFor(null)
                                setOpenMenuId((current) => (current === tag.id ? null : tag.id))
                              }}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </button>
                            <ActionMenu
                              open={openMenuId === tag.id}
                              onClose={() => {
                                // 2段目への切り替え直後は閉じない。外側・Esc は閉じる。
                                if (keepMenuOpenRef.current) {
                                  keepMenuOpenRef.current = false
                                  return
                                }
                                setOpenMenuId(null)
                              }}
                              ariaLabel={`タグ「${tag.name}」の操作`}
                              items={rowMenuItems(tag)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* 件数とページ送り。表示件数はこの段の右に置く。 */}
              <div className={styles.pagerRow}>
                <span className={styles.pagerCount}>
                  {filtered.length}件中 {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, filtered.length)}件
                </span>
                <div className={styles.pagerRight}>
                  <Select
                    aria-label="表示件数"
                    size="page-size"
                    value={String(pageSize)}
                    onChange={(value) => setPageSize(Number(value) || 20)}
                    options={[
                      { value: '20', label: '20件表示' },
                      { value: '50', label: '50件表示' },
                      { value: '100', label: '100件表示' },
                    ]}
                  />
                  <Pagination
                    page={currentPage}
                    pageCount={pages}
                    onPageChange={setPage}
                    ariaLabel="タグのページ送り"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {csvOpen ? (
        <TagCsvImportDialog
          open
          onClose={onCsvClose}
          onCompleted={() => void load()}
        />
      ) : null}

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
          onArchived={(result) => { setDeleteTarget(null); if (result) notifyToast(result); void load() }}
        />
      )}
    </>
  )
}
