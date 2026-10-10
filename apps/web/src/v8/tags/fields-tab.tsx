'use client'

import { useListUrlValue } from '@/components/shared/list-url-state';
import { RowNameLink } from '@/components/shared/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, FileText, GripVertical, Info, PenLine, Plus, Send, Users } from 'lucide-react';
import Link from '@/components/shared/list-navigation'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation';
import { AlertCircle } from 'lucide-react';
import type { Folder, FriendField, FriendFieldListSummary, FriendFieldType } from '@line-crm/shared';
import { api, ApiError } from '@/lib/api';
import { createResponseGate } from '@/lib/latest-request';
import { useRowLeaving } from '@/lib/use-row-leaving';
import { ListPageBody } from '@/components/templates';
import FolderPanel, { FolderPanelNote, type FolderPanelRow } from '@/components/shared/folder-panel';
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import { FolderDotName } from '@/components/shared/folder-dot';
import { type ActionMenuItem } from '@/components/shared/action-menu';
import ListState from '@/components/shared/list-state'
import { RowMenu, RowQuickAction } from '@/components/shared/row-actions';
import DetailPanel, { useDetailPanelUrl } from '@/components/shared/detail-panel';
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu';
import InlineEdit from '@/components/shared/inline-edit'
import { withViewTransition } from '@/components/shared/view-transition';
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import KpiCard from '@/components/shared/kpi-card'
import KpiBand from '@/components/shared/kpi-band'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table';
import { DelayedSkeleton } from '@/components/shared/skeleton';
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected';
import { notifyToast } from '@/components/shared/toast';
import PageSizeSelect, { PAGE_SIZES as STANDARD_PAGE_SIZES } from '@/components/shared/page-size-select';
import ReorderHandle from '@/components/shared/reorder-handle'
import { useFlipRows, useLiveReorder } from '@/lib/use-live-reorder';
import { mergeVisibleOrder, movableIds } from '@/components/friend-fields/reorder-utils';
import { FIELD_TYPE_LABELS, destinationLabel, fieldDeletionBlockedReason, knownUsageCount } from '@/components/friend-fields/field-list';
import styles from './list.module.css'
import type { AttributeListHost } from './attribute-host';
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value';
import { SaveErrorField } from '@/components/shared/save-form-errors';
import { ListPager } from '@/components/templates/list-page';
import { ListToolbarSearchSlot } from '@/components/shared/list-toolbar';
import Notice from '@/components/shared/notice'

/*
 * ★V8 タグ「友だち情報欄」タブ（Pencil `q5gbcM`）。
 *
 * 動き（読み込み・数の帯・絞り込み・フォルダ・並べ替え・削除の安全確認・移行への入口・
 * 行の詳細パネル・名前のその場の直し・右クリック）は今の V8 タブ（app/tags/fields-tab-v8.tsx）から写した。
 * 見た目は絵に合わせた：数の帯は板の端から端、左にフォルダの列（いちばん上が「項目を作る」）、
 * 右の上に案内の帯、表は名前の前にフォルダの色の丸（表にフォルダ列は置かない）、行の右端は必ず「…」、
 * 表の下に操作の説明。
 */

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 未分類の印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'
const PAGE_SIZES = STANDARD_PAGE_SIZES

/** 種類の言葉（絵：選ぶ種類は「1つ選ぶ」「いくつも選ぶ」）。ほかは今の言葉。 */
export function fieldTypeWord(type: FriendFieldType): string {
  if (type === 'select') return '1つ選ぶ'
  if (type === 'multi_select') return 'いくつも選ぶ'
  return FIELD_TYPE_LABELS[type] ?? type
}

export default function FieldsTab({ accountId, canEdit, narrow = false, host }: { accountId: string | null; canEdit: boolean; narrow?: boolean; host?: AttributeListHost<FriendField> }) {
  const router = useRouter()
  const [items, setItems] = useState<FriendField[]>([])
  const [summary, setSummary] = useState<FriendFieldListSummary | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  /* 集計は一覧とは別の要求（片方だけ落ちてももう片方は出す）。 */
  const [statsStatus, setStatsStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  // 操作の失敗は読み込みの失敗とは別の状態にする（ATTR-02）。
  const [actionError, setActionError] = useState('')
  const [retryOrder, setRetryOrder] = useState<FriendField[] | null>(null)
  const [query, setQuery] = useListUrlValue('q', '')
  const [type, setType] = useState<'all' | FriendFieldType>('all')
  const [folderFilter, setFolderFilter] = useListUrlValue('folderFilter', '')
  const [pageSize, setPageSize] = useListUrlValue('pageSize', 20)
  const [page, setPage] = useListUrlValue('page', 1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FriendField | null>(null)
  const { leavingId, leave } = useRowLeaving()
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderDialog, setFolderDialog] = useState<'new' | Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 行の詳細パネル。URL に ?field=<id> を残す。 */
  const [activeFieldId, setActiveFieldId] = useDetailPanelUrl('field')
  const openFieldDetail = (id: string) => host ? (canEdit ? host.onEdit(id) : undefined) : withViewTransition(() => setActiveFieldId(current => current === id ? null : id))

  /* アカウント切替のあとに届いた古い応答で一覧を上書きしない（ATTR-01）。 */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(accountId)
  accountRef.current = accountId

  useEffect(() => {
    gateRef.current.invalidate()
    setPendingDelete(null)
    setDragId(null)
    setFolderFilter('')
    setPage(1)
    setError('')
    setActionError('')
    setRetryOrder(null)
    setOpenMenuId(null)
  }, [accountId])

  const load = useCallback(async () => {
    if (host) { host.reload(); return }
    const account = accountId
    const token = gateRef.current.begin()
    if (!account) {
      setItems([]); setSummary(null); setStatus('error'); setStatsStatus('error'); setError('LINE公式アカウントを選んでください')
      return
    }
    setStatus('loading'); setStatsStatus('loading'); setError('')
    const stale = () => !gateRef.current.current(token) || accountRef.current !== account
    void api.friendFields.stats(account).then((stats) => {
      if (stale()) return
      if (stats.success) { setSummary(stats.data); setStatsStatus('ready') }
      else { setSummary(null); setStatsStatus('error') }
    }, (reason) => {
      if (stale()) return
      setSummary(null)
      setStatsStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    })
    try {
      const list = await api.friendFields.list(account, { withUsage: true })
      if (stale()) return
      if (!list.success) throw new Error('load failed')
      setItems(list.data); setStatus('ready')
    } catch (reason) {
      if (stale()) return
      const forbidden = reason instanceof ApiError && reason.status === 403
      setItems([])
      setStatus(forbidden ? 'forbidden' : 'error')
      setError(forbidden ? '' : '再読み込みしても直らない場合はエラー報告へ。')
    }
  }, [accountId, host])
  useEffect(() => { if (!host) void load() }, [load, host])
  useEffect(() => { if (host) { setItems(host.items); setStatus(host.status); setError(host.error ?? ''); setFolders(host.folders ?? []); setFolderError(host.foldersFailed ? 'フォルダを読み込めませんでした。' : '') } }, [host])

  /* フォルダは folders 表（kind=friend_field）。件数は一覧の items から数える（同じ母集団）。 */
  const loadFolders = useCallback(async () => {
    if (host) { host.reload(); return }
    if (!accountId) return
    setFolderError('')
    try {
      const res = await api.folders.list('friend_field', accountId)
      if (res.success) setFolders(res.data)
      else setFolderError('フォルダを読み込めませんでした。')
    } catch {
      setFolderError('フォルダを読み込めませんでした。')
    }
  }, [accountId, host])
  useEffect(() => { if (!host) void loadFolders() }, [loadFolders, host])

  const visible = useMemo(() => items.filter((field) => {
    if (query && !field.name.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja'))) return false
    if (type !== 'all' && field.type !== type) return false
    if (folderFilter === UNFILED && field.folderId) return false
    if (folderFilter && folderFilter !== UNFILED && field.folderId !== folderFilter) return false
    return true
  }), [items, query, type, folderFilter])

  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pages)
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  /* 動かしている間、置き場所を入れ替えて見せ、ほかの行は滑らかに場所を空ける（自動応答と同じ動き）。 */
  const liveOrder = useLiveReorder(pageItems, (field) => field.id, dragId)
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  useFlipRows(bodyRef, liveOrder.shown.map((field) => field.id).join(','))
  const activeField = items.find((item) => item.id === activeFieldId) ?? null
  const activeFieldIndex = pageItems.findIndex((item) => item.id === activeFieldId)
  useEffect(() => setPage(1), [query, type, folderFilter, pageSize])
  useEffect(() => {
    if (host && !host.foldersFailed && folderFilter && folderFilter !== UNFILED && !folders.some((folder) => folder.id === folderFilter)) setFolderFilter('')
  }, [host, folders, folderFilter])

  /* 並び替え：/api/friend-fields/reorder へ「動かせる行だけの新しい順」を1回で渡す。共通項目の位置は保つ。 */
  const applyOrder = async (next: FriendField[]) => {
    if (host) { await host.onOrder(next.map((item) => item.id)); return }
    if (!accountId) return
    const previous = items
    setItems(next)
    setActionError('')
    setRetryOrder(null)
    try {
      const res = await api.friendFields.reorder(accountId, movableIds(next, (field) => !field.isInherited))
      if (!res.success) throw new Error(res.error)
      await load()
    } catch (reason) {
      setItems(previous)
      const message = reason instanceof ApiError ? `並び順を保存できませんでした（${reason.message}）` : '並び順を保存できませんでした'
      setActionError(message)
      setRetryOrder(next)
      notifyToast(message, { tone: 'error', actionLabel: 'もう一度', onAction: () => { void applyOrder(next) } })
    }
  }

  const reorderTo = async (order: string[]) => {
    const visibleNext = order.map((id) => items.find((field) => field.id === id)).filter(Boolean) as FriendField[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (field) => field.isInherited === true))
  }

  const move = async (targetId: string) => {
    if ((!accountId && !host) || !dragId || dragId === targetId) return setDragId(null)
    const order = visible.map((field) => field.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    await reorderTo(order)
  }

  /** つまみにフォーカスして ↑/↓（N-049）。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = visible.map((field) => field.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    await reorderTo(order)
  }

  const remove = async (field: FriendField) => {
    if (!accountId) return
    const blockedReason = fieldDeletionBlockedReason(field)
    if (blockedReason) {
      setActionError(blockedReason)
      return
    }
    setActionError('')
    try {
      await api.friendFields.delete(field.id, accountId)
      leave(field.id, () => load())
    } catch (reason) {
      setActionError(reason instanceof ApiError ? reason.message : '削除できませんでした')
    }
  }

  const moveFolderOrder = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const result = await api.folders.swapOrder(target.id, neighbor.id)
      if (!result.success) throw new Error(result.error)
      await loadFolders()
    } catch {
      setFolderError('並び順を変えられませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async () => {
    if (!deletingFolder || folderBusy) return
    const targetId = deletingFolder.id
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(targetId)
      if (!res.success) throw new Error(res.error)
      setDeletingFolder(null)
      if (folderFilter === targetId) setFolderFilter('')
      await loadFolders()
      /* フォルダを消した項目は未分類に戻るので一覧も読み直す。 */
      await load()
    } catch {
      setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  /* 行の「…」と右クリックは同じ中身。統括は配る、店は移行。 */
  const rowMenuItems = (field: FriendField): ActionMenuItem[] => {
    if (host) return canEdit ? [
      { id: 'edit', label: '編集', onSelect: () => host.onEdit(field.id) },
      { id: 'distribute', label: '配る', onSelect: () => host.onDistribute(field.id) },
      { id: 'delete', label: '削除する', tone: 'danger', dividerBefore: true, onSelect: () => host.onRemove(field.id) },
    ] : []
    if (!canEdit) return [{ id: 'open', label: '詳しく見る', onSelect: () => openFieldDetail(field.id) }]
    const list: ActionMenuItem[] = [
      { id: 'edit', label: '編集', external: false, href: `/tags/fields/edit?id=${encodeURIComponent(field.id)}`, onSelect: () => router.push(`/tags/fields/edit?id=${encodeURIComponent(field.id)}`) },
    ]
    if ((knownUsageCount(field) ?? 0) > 0) {
      list.push({ id: 'migrate', label: '移行（種類を変える）', external: false, href: `/tags/fields/migrate?id=${encodeURIComponent(field.id)}`, onSelect: () => router.push(`/tags/fields/migrate?id=${encodeURIComponent(field.id)}`) })
    }
    if (!field.isInherited) {
      const blocked = fieldDeletionBlockedReason(field)
      list.push({
        id: 'delete',
        label: '削除する',
        tone: 'danger',
        dividerBefore: true,
        disabled: blocked !== null,
        disabledReason: blocked ?? undefined,
        onSelect: () => setPendingDelete(field),
      })
    }
    return list
  }
  const fieldContextItems = (field: FriendField): ContextMenuItem[] =>
    rowMenuItems(field).map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      onSelect: () => item.onSelect?.(),
    }))

  /* 数の帯（4つ）。 */
  const kpiReason = statsStatus === 'loading' ? STATE_TEXT.loading
    : statsStatus === 'forbidden' ? STATE_TEXT.forbiddenView
      : statsStatus === 'error' ? STATE_TEXT.error
        : null
  const detailOf = (whenAvailable: string): string => kpiReason ?? whenAvailable
  const kpis = [
    { title: '項目', icon: ClipboardList, value: summary?.total ?? null, unit: '件', detail: detailOf(typeof summary?.inUse === 'number' ? `使っている ${summary.inUse} 件` : '使っている数は未集計') },
    { title: '入力済みの友だち', icon: Users, value: summary?.registeredFriends ?? null, unit: '人', detail: detailOf('1つ以上入っている') },
    // 口そのものが無いときは、読込・失敗とは別の言葉にする（v7 と同じ）。
    { title: '回答フォームで集める', icon: FileText, value: summary?.formLinks ?? null, unit: '件', detail: kpiReason ?? (summary?.formLinks === null ? notConnectedText('回答フォームの登録先') : '回答で自動で入る') },
    { title: '今月の変更', icon: PenLine, value: summary?.updatedThisMonth ?? null, unit: '件', detail: detailOf('追加・名前の変更') },
  ]

  const folderRows: FolderPanelRow[] = [
    { kind: 'all' as const, id: '', label: 'すべて', count: status === 'ready' ? items.length : null },
    ...folders.map((f, index) => ({
      kind: 'folder' as const,
      id: f.id,
      label: f.name,
      count: status === 'ready' ? items.filter((field) => field.folderId === f.id).length : null,
      color: f.color,
      onEdit: canEdit ? () => host ? host.onEditFolder?.(f.id) : setFolderDialog(f) : undefined,
      onMoveUp: !host && canEdit && index > 0 ? () => void moveFolderOrder(index, -1) : undefined,
      onMoveDown: !host && canEdit && index < folders.length - 1 ? () => void moveFolderOrder(index, 1) : undefined,
      onDelete: canEdit ? () => host ? host.onRemoveFolder?.(f.id) : setDeletingFolder(f) : undefined,
      deleteNote: '削除しても、中の項目は未分類に残ります。',
    })),
    { kind: 'unfiled' as const, id: UNFILED, label: '未分類', count: status === 'ready' ? items.filter((field) => !field.folderId).length : null },
  ]
  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: `フォルダ：${f.name}` })),
    { value: UNFILED, label: 'フォルダ：未分類' },
  ]
  const folderDotOf = (folderId: string | null | undefined) => {
    const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
    return folder ? { name: folder.name, color: folder.color } : null
  }

  const filterActive = Boolean(query || type !== 'all' || folderFilter)

  /* 閲覧のみには作るボタンを置かない（2026-10-06 オーナー）。 */
  const createButton = (wide: boolean) => status === 'forbidden' || !canEdit ? null : (
    <Button {...(host ? { onClick: host.onCreate, disabled: host.busy } : { href: '/tags/fields/new' })} variant="primary" className={wide ? styles.createWide : undefined}><Plus size={15} aria-hidden="true" />項目を作る</Button>
  )

  const table = status === 'forbidden' ? (
    <ListState kind="forbidden" title="友だち情報欄を見る権限がありません" />
  ) : status === 'error' ? (
    <ListState kind="error" title="友だち情報欄を読み込めませんでした" description={error || undefined} onRetry={() => void load()} />
  ) : status === 'ready' && items.length === 0 ? (
    <ListState kind="empty" title="まだ項目はありません" description="友だちに入力してもらう項目（誕生日・住まいなど）を作れます。" action={createButton(false)} />
  ) : status === 'ready' && visible.length === 0 ? (
    <ListState kind="empty" emptyPreset="filtered" title="条件に合うものはありません" action={filterActive ? <Button type="button" onClick={() => { setQuery(''); setType('all'); setFolderFilter('') }}>条件を外す</Button> : undefined} />
  ) : (
    <DelayedSkeleton loading={status !== 'ready'} skeleton={<div className={styles.skeleton} aria-busy="true" />}>
      <DataTable className={styles.table}>
        <thead>
          <TableHeadRow>
            <Th className={styles.markColGrip}><span className="sr-only">並び替え</span></Th>
            <Th className={styles.searchColName}>項目名</Th>
            <Th className={styles.fieldColType}>種類</Th>
            <Th className={styles.fieldColType}>入っている人</Th>
            <Th className={styles.fieldColType}>回答フォーム</Th>
            <Th className={styles.fieldColPlace}>出す場所</Th>
            {host && canEdit ? <Th className={styles.colDistribute}><span className="sr-only">配る</span></Th> : null}
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody ref={bodyRef}>
          {liveOrder.shown.map((field) => {
            const usage = knownUsageCount(field)
            const key = `{{field.${field.fieldKey}}}`
            return (
              <Tr
                interactive
                key={field.id}
                data-reorder-id={field.id}
                onDragEnter={() => { if (!field.isInherited) liveOrder.enter(field.id) }}
                onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                onDrop={dragId ? () => void move(liveOrder.dropTarget(field.id)) : undefined}
                className={`${styles.row} ${styles.fieldRow}`}
                leaving={leavingId === field.id}
                tabIndex={0}
                detailKey="field" onOpen={() => openFieldDetail(field.id)}
                 data-row-id={field.id}
              >
                <Td className={styles.markColGrip}>
                  {canEdit ? (
                    <span
                      className={styles.gripBox}
                      draggable={!field.isInherited}
                      title={field.isInherited ? '共通項目は移行後に並び替えできます' : undefined}
                      onDragStart={() => setDragId(field.id)}
                      onDragEnd={() => setDragId(null)}
                    >
                      <ReorderHandle
                        label={field.name}
                        disabledReason={field.isInherited === true ? '共通項目は移行後に並び替えできます' : null}
                        onMove={(direction) => void keyboardMove(field.id, direction)}
                      >
                        <GripVertical className={styles.gripIcon} aria-hidden="true" />
                      </ReorderHandle>
                    </span>
                  ) : <span className={styles.gripSpace} aria-hidden="true" />}
                </Td>
                <Td className={styles.searchColName}>
                  <ContextMenu label={`項目「${field.name}」の操作`} items={fieldContextItems(field)}>
                    <div className={styles.nameRow}>
                      <FolderDotName folder={folderDotOf(field.folderId)}>
                        {canEdit && !host ? (
                          <RowNameLink href={`/tags/fields/edit?id=${encodeURIComponent(field.id)}`} className={styles.name}  onClick={(event) => event.stopPropagation()}><TruncatedText value={String(field.name ?? '')} /></RowNameLink>
                        ) : host && canEdit ? <RowNameLink href="#" className={styles.name}  onClick={(event) => { event.preventDefault(); event.stopPropagation(); host.onEdit(field.id) }}><TruncatedText value={String(field.name ?? '')} /></RowNameLink> : <span className={styles.name} ><TruncatedText value={String(field.name ?? '')} /></span>}
                      </FolderDotName>
                    </div>

                  </ContextMenu>
                </Td>
                <Td className={styles.fieldColType}><span className={styles.cellText}>{fieldTypeWord(field.type)}</span></Td>
                <Td className={styles.fieldColType}><span className={styles.cellText}>{usage === null ? emptyValue('unknown') : `${usage}人`}</span></Td>
                <Td className={styles.fieldColType}>
                  <span className={styles.cellText} title={field.formUsageCount === undefined ? '回答フォームの使用数は未集計' : undefined}>
                    {field.formUsageCount === undefined || field.formUsageCount === 0 ? emptyValue('unknown') : `${field.formUsageCount}つ`}
                  </span>
                </Td>
                <Td className={styles.fieldColPlace}><span className={styles.cellText} title={host ? undefined : destinationLabel(field)}>{host ? emptyValue('unknown') : destinationLabel(field)}</span></Td>
                {host && canEdit ? <Td className={styles.colDistribute}><RowQuickAction label="配る" ariaLabel={`${field.name}を配る`} icon={<Send />} disabled={host.busy} onClick={() => host.onDistribute(field.id)} /></Td> : null}
                <Td className={styles.colMenu}>
                  <span className={styles.menuAnchor}>
                    {(!host || canEdit) ? <RowMenu
                      size="row"
                      label={`項目「${field.name}」の操作`}
                      items={rowMenuItems(field)}
                      open={openMenuId === field.id}
                      onOpenChange={(next) => setOpenMenuId(next ? field.id : null)}
                    /> : null}
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>

      {pages > 1 ? (
        <ListPager>
          <span className={styles.pagerCount}>
            {`${visible.length} 件中 ${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, visible.length)} 件`}
          </span>
          <Pagination page={currentPage} pageCount={pages} onPageChange={setPage} ariaLabel="友だち情報欄のページ送り" />
        </ListPager>
      ) : null}

    </DelayedSkeleton>
  )

  return (
    <>
      {host?.kpis ?? <KpiBand data-design="KPIs" className={styles.kpis}>
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
      </KpiBand>}

      <ListPageBody
        skeleton
        listHelp={canEdit ? `行の「…」に：編集・${host ? '配る' : '移行（種類を変える）'}・削除。並べ替えはつまんで上下（キーボードは上下キー）` : '行から中身を見られます。'}
        folders={<>
          <FolderPanel
            createAction={createButton(true)}
            activeId={folderFilter}
            onSelect={setFolderFilter}
            onAddFolder={canEdit ? () => host ? host.onAddFolder?.() : setFolderDialog('new') : undefined}
            addFolderLabel="フォルダを追加"
            rows={folderRows}
          >
            <FolderPanelNote>フォルダを消しても、中の項目は未分類に残ります</FolderPanelNote>
            {folderError ? (
              <Notice tone="danger" className={styles.folderNoteNoticePlacement} >{folderError}
                <button type="button" onClick={() => void loadFolders()} className={styles.inlineRetry}>もう一度</button></Notice>
            ) : null}
          </FolderPanel>
        </>}
        collapsedFolders={<>
          {createButton(false)}
          <SaveErrorField names={["folderFilter","folder_filter"]}><Select aria-label="フォルダ" width={150} value={folderFilter} onChange={setFolderFilter} options={folderSelectOptions} /></SaveErrorField>
        </>}
        toolbar={<>
          {/* 案内の帯は道具の段の上（絵：表の列の上だけにかかる）。 */}
          <p className={`${styles.readonlyBand} ${styles.toolbarBand}`}>
            <Info className={styles.readonlyIcon} aria-hidden="true" />
            {host ? '情報欄のひな形を各アカウントへ配れます。種類と差し込みの名前は作ったあと変えられません。別の種類は新しいひな形を作ってください。' : '項目の種類を変えると、入っている値が変わることがあります。種類を変えるときは「移行」で事前に確かめてから変えます。'}
          </p>
          <ListToolbarSearchSlot>
            <SearchField aria-label="項目名で探す" placeholder="項目名で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />
          </ListToolbarSearchSlot>
          <SaveErrorField names={["type"]}><Select
            aria-label="種類で絞り込む"
            width={119}
            value={type}
            onChange={(value) => setType(value as typeof type)}
            options={[
              { value: 'all', label: '種類：すべて' },
              ...(Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]).map((value) => ({ value, label: `種類：${fieldTypeWord(value)}` })),
            ]}
          /></SaveErrorField>
          <span className={styles.toolbarSpacer} />
          <PageSizeSelect value={pageSize} onChange={(value) => setPageSize(value || 20)} options={PAGE_SIZES} label={null} />
        </>}
      >
        {actionError ? (
          <Notice tone="danger" >{actionError}{retryOrder ? (
              <button type="button" onClick={() => { const next = retryOrder; setRetryOrder(null); if (next) void applyOrder(next) }}>再試行</button>
            ) : (
              <button type="button" onClick={() => { setActionError(''); void load() }}>もう一度読み込む</button>
            )}</Notice>
        ) : null}
        {table}
      </ListPageBody>

      {/* 行の詳細パネル。名前はその場で直せる。 */}
      <DetailPanel
        open={!host && activeField !== null}
        title={activeField?.name ?? ''}
        description={activeField ? `{{field.${activeField.fieldKey}}}・${fieldTypeWord(activeField.type)}` : undefined}
        onClose={() => setActiveFieldId(null)}
        hasPrev={activeFieldIndex > 0}
        hasNext={activeFieldIndex >= 0 && activeFieldIndex < pageItems.length - 1}
        onPrev={activeFieldIndex > 0 ? () => setActiveFieldId(pageItems[activeFieldIndex - 1].id) : undefined}
        onNext={activeFieldIndex >= 0 && activeFieldIndex < pageItems.length - 1 ? () => setActiveFieldId(pageItems[activeFieldIndex + 1].id) : undefined}
        footer={activeField && canEdit ? (
          <>
            <Button href={`/tags/fields/edit?id=${encodeURIComponent(activeField.id)}`}>編集する</Button>
            {(knownUsageCount(activeField) ?? 0) > 0 ? (
              <Button href={`/tags/fields/migrate?id=${encodeURIComponent(activeField.id)}`}>移行する</Button>
            ) : null}
          </>
        ) : undefined}
      >
        {activeField ? (
          <dl className={styles.detailList}>
            <div>
              <dt>項目名</dt>
              <dd>
                {/* 閲覧のみ：鉛筆は置かず、名前だけを見せる（2026-10-06 オーナー決定）。 */}
                {canEdit ? (
                  <InlineEdit
                    label="項目名"
                    value={activeField.name}
                    maxLength={40}
                    disabled={!accountId || activeField.isInherited}
                    onSave={async (next) => {
                      if (!accountId) throw new Error('no account')
                      const res = await api.friendFields.update(activeField.id, accountId, { name: next })
                      if (!res.success) throw new Error(res.error)
                      void load()
                    }}
                  />
                ) : activeField.name}
              </dd>
            </div>
            <div><dt>差し込み名</dt><dd>{`{{field.${activeField.fieldKey}}}`}</dd></div>
            <div><dt>種類</dt><dd>{fieldTypeWord(activeField.type)}</dd></div>
            <div><dt>入っている人</dt><dd>{knownUsageCount(activeField) === null ? emptyValue('unknown') : `${knownUsageCount(activeField)}人`}</dd></div>
            <div><dt>回答フォーム</dt><dd>{activeField.formUsageCount === undefined ? emptyValue('unknown') : `${activeField.formUsageCount}つ`}</dd></div>
            <div><dt>出す場所</dt><dd>{destinationLabel(activeField)}</dd></div>
          </dl>
        ) : null}
      </DetailPanel>

      {folderDialog ? (
        <FolderAddDialog
          kind="friend_field"
          folder={folderDialog === 'new' ? undefined : folderDialog}
          accountId={accountId}
          note="項目を分けてしまう箱です。消しても、入っていた項目は未分類として残ります。"
          placeholder="例：基本情報"
          onClose={() => setFolderDialog(null)}
          onAdded={() => { setFolderDialog(null); void loadFolders() }}
        />
      ) : null}

      <ConfirmDialog
        open={deletingFolder !== null}
        title={deletingFolder ? `フォルダ「${deletingFolder.name}」を削除しますか？` : 'フォルダを削除しますか？'}
        description="削除しても、中の項目は未分類に残ります。この操作は元に戻せません。"
        confirmLabel="フォルダを削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => { if (!folderBusy) setDeletingFolder(null) }}
        onConfirm={() => removeFolder()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`項目「${pendingDelete?.name ?? ''}」を削除しますか？`}
        description="値が入っていない項目だけ削除できます。この操作は元に戻せません。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { const target = pendingDelete; setPendingDelete(null); if (target) void remove(target) }}
      />
    </>
  )
}
