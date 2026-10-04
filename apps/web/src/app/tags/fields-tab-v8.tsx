'use client'

/*
 * ★V8 友だち属性「友だち情報欄」タブの一覧（Pencil `q5gbcM`、状態 `U0aKD`）。
 *
 * 項目もフォルダを持つので、タグと同じく左にフォルダの列を出す
 * （folders.kind = 'friend_field'。こちらは共通の folders 表なので
 * FolderAddDialog がそのまま使える）。
 * 数え方・並べ替え・削除の安全確認は v7（`field-list.tsx`）と同じ関数を使う。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, ClipboardList, FileText, LockKeyhole, MoreHorizontal, RefreshCw, Users } from 'lucide-react'
import type { Folder, FriendField, FriendFieldListSummary, FriendFieldType } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useRowLeaving } from '@/lib/use-row-leaving'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import { TableHeadRow, Th } from '@/components/shared/table'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { mergeVisibleOrder, movableIds } from '@/components/friend-fields/reorder-utils'
import {
  FIELD_TYPE_LABELS,
  destinationLabel,
  fieldDeletionBlockedReason,
  knownUsageCount,
} from '@/components/friend-fields/field-list'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import { notifyToast } from '@/components/shared/toast'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { TagRowsSkeleton } from './tag-rows-skeleton'
import styles from './list-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 未分類の印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

export default function FieldsTabV8({ accountId, canEdit }: { accountId: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<FriendField[]>([])
  const [summary, setSummary] = useState<FriendFieldListSummary | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  /* 集計は一覧とは別の要求（v7 と同じ。片方だけ落ちてももう片方は出す）。 */
  const [statsStatus, setStatsStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  // 操作の失敗は読み込みの失敗とは別の状態にする（#1014 ATTR-02）。
  const [actionError, setActionError] = useState('')
  const [retryOrder, setRetryOrder] = useState<FriendField[] | null>(null)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | FriendFieldType>('all')
  const [folderFilter, setFolderFilter] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FriendField | null>(null)
  const { leavingId, leave } = useRowLeaving()
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderDialog, setFolderDialog] = useState<'new' | Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  /* アカウント切替のあとに届いた古い応答で一覧を上書きしない（ATTR-01）。 */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(accountId)
  accountRef.current = accountId

  /* 切替で残るものは閉じる。別アカウントの削除確認や掴んだままのつまみを残さない。 */
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
  }, [accountId])
  useEffect(() => { void load() }, [load])

  /*
   * フォルダは folders 表（kind=friend_field）。件数はサーバーがこの kind を
   * 数える口をまだ持たないので、一覧の items から数える（同じ母集団）。
   */
  const loadFolders = useCallback(async () => {
    if (!accountId) return
    setFolderError('')
    try {
      const res = await api.folders.list('friend_field', accountId)
      if (res.success) setFolders(res.data)
      else setFolderError('フォルダを読み込めませんでした。')
    } catch {
      setFolderError('フォルダを読み込めませんでした。')
    }
  }, [accountId])
  useEffect(() => { void loadFolders() }, [loadFolders])

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
  useEffect(() => setPage(1), [query, type, folderFilter, pageSize])

  /*
   * 並び替え（v7 と同じ）: /api/friend-fields/reorder へ「動かせる行だけの
   * 新しい順」を1回で渡す。共通項目（isInherited）と隠れた行の位置は保つ。
   */
  const applyOrder = async (next: FriendField[]) => {
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
      notifyToast(message, {
        tone: 'error',
        actionLabel: 'もう一度',
        onAction: () => { void applyOrder(next) },
      })
    }
  }

  const move = async (targetId: string) => {
    if (!accountId || !dragId || dragId === targetId) return setDragId(null)
    const order = visible.map((field) => field.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((id) => items.find((field) => field.id === id)).filter(Boolean) as FriendField[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (field) => field.isInherited === true))
  }

  /** つまみにフォーカスして ↑/↓（N-049）。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = visible.map((field) => field.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((field) => field.id === i)).filter(Boolean) as FriendField[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (field) => field.isInherited === true))
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
    }
    catch (reason) { setActionError(reason instanceof ApiError ? reason.message : '削除できませんでした') }
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

  /** 行の「…」。編集・移行・削除。 */
  const rowMenuItems = (field: FriendField): ActionMenuItem[] => {
    const readonly = !canEdit
    const readonlyReason = '閲覧のみのため変更できません'
    const editHref = `/tags/fields/edit?id=${encodeURIComponent(field.id)}`
    const items_: ActionMenuItem[] = [
      { id: 'edit', label: '編集', external: true, disabled: readonly, disabledReason: readonly ? readonlyReason : undefined, onSelect: () => router.push(editHref) },
    ]
    if ((knownUsageCount(field) ?? 0) > 0) {
      items_.push({
        id: 'migrate',
        label: '移行',
        external: true,
        disabled: readonly,
        disabledReason: readonly ? readonlyReason : undefined,
        onSelect: () => router.push(`/tags/fields/migrate?id=${encodeURIComponent(field.id)}`),
      })
    }
    if (!field.isInherited) {
      const blocked = fieldDeletionBlockedReason(field)
      items_.push({
        id: 'delete',
        label: '削除する',
        tone: 'danger',
        dividerBefore: true,
        disabled: readonly || blocked !== null,
        disabledReason: readonly ? readonlyReason : (blocked ?? undefined),
        onSelect: () => setPendingDelete(field),
      })
    }
    return items_
  }

  /* 数の帯（v7 の4枚と同じ数）。 */
  const kpiReason = statsStatus === 'loading' ? STATE_TEXT.loading
    : statsStatus === 'forbidden' ? STATE_TEXT.forbiddenView
      : statsStatus === 'error' ? STATE_TEXT.error
        : null
  const detailOf = (whenAvailable: string): string => kpiReason ?? whenAvailable
  const kpis = [
    { title: '項目数', icon: ClipboardList, value: summary?.total ?? null, unit: '件', detail: detailOf(typeof summary?.inUse === 'number' ? `使用中 ${summary.inUse}件` : '使用中の数は未集計') },
    { title: '登録済み友だち', icon: Users, value: summary?.registeredFriends ?? null, unit: '人', detail: detailOf('1項目以上を登録') },
    // 口そのものが無いときは、読込・失敗とは別の言葉にする（v7 と同じ）。
    { title: 'フォーム連携', icon: FileText, value: summary?.formLinks ?? null, unit: '件', detail: kpiReason ?? (summary?.formLinks === null ? notConnectedText('回答フォームの登録先') : '回答の登録先') },
    { title: '今月の更新', icon: RefreshCw, value: summary?.updatedThisMonth ?? null, unit: '件', detail: detailOf('追加・編集') },
  ]

  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: status === 'ready' ? items.length : null, color: 'var(--color-accent)' },
    ...folders.map((f, index) => ({
      id: f.id,
      label: f.name,
      /* サーバーは friend_field の件数をまだ返さない（FOLDER_ITEM_COUNT_TABLES に無い）。
         一覧の items（同じ母集団）から数える。未取得の間は null = 出さない。 */
      count: status === 'ready' ? items.filter((field) => field.folderId === f.id).length : null,
      color: f.color,
      onEdit: canEdit ? () => setFolderDialog(f) : undefined,
      onMoveUp: canEdit && index > 0 ? () => void moveFolderOrder(index, -1) : undefined,
      onMoveDown: canEdit && index < folders.length - 1 ? () => void moveFolderOrder(index, 1) : undefined,
      onDelete: canEdit ? () => setDeletingFolder(f) : undefined,
      deleteNote: '削除しても、中の項目は未分類に残ります。',
    })),
    { id: UNFILED, label: '未分類', count: status === 'ready' ? items.filter((field) => !field.folderId).length : null, color: 'var(--color-ink-disabled)' },
  ]

  const folderSelectOptions = [
    { value: '', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: `フォルダ：${f.name}` })),
    { value: UNFILED, label: 'フォルダ：未分類' },
  ]

  const filterActive = Boolean(query || type !== 'all' || folderFilter)

  return (
    <>
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.title} className={styles.kpi}>
            <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
            <p className={styles.kpiValue}>{kpi.value ?? '—'}<span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span></p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      {/* 一覧の上の案内の帯（種類を変える注意）。 */}
      <p className={styles.noteBand}>
        既定値は友だち情報が空欄のときの送信値です。種類は新規登録後に変更せず、回答フォーム・友だち詳細・変数挿入で同じ定義を使います。
      </p>

      <div className={styles.split}>
        {/* 左のフォルダの列。いちばん上は「項目を作る」。 */}
        <div className={styles.folderCol}>
          {status === 'forbidden' ? null : canEdit ? (
            <Button href="/tags/fields/new" variant="primary" className="w-full">＋ 項目を作る</Button>
          ) : (
            <Button type="button" variant="primary" className="w-full" disabled>＋ 項目を作る</Button>
          )}
          <FolderPanel
            activeId={folderFilter}
            onSelect={setFolderFilter}
            onAddFolder={canEdit ? () => setFolderDialog('new') : undefined}
            addFolderDisabled={!canEdit}
            addFolderLabel="フォルダを追加"
            rows={folderRows}
          >
            <p className={styles.folderNote}>
              フォルダを削除しても、中の項目は未分類として残ります。
            </p>
            {folderError ? (
              <p role="alert" className={styles.folderNote}>
                {folderError}
                <button type="button" onClick={() => void loadFolders()} className="text-action ml-2 font-semibold hover:underline">
                  もう一度
                </button>
              </p>
            ) : null}
          </FolderPanel>
        </div>

        <div className={styles.listCol}>
          <div className={styles.toolbar}>
            {status === 'forbidden' ? null : canEdit ? (
              <Button href="/tags/fields/new" variant="primary" className={styles.toolbarCreate}>＋ 項目を作る</Button>
            ) : (
              <Button type="button" variant="primary" className={styles.toolbarCreate} disabled>＋ 項目を作る</Button>
            )}
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
                aria-label="項目名で検索"
                placeholder="項目名で検索"
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
              />
            </div>
            <Select
              aria-label="項目の種類"
              value={type}
              onChange={(value) => setType(value as typeof type)}
              options={[{ value: 'all', label: '種類：すべて' }, ...Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({ value, label }))]}
            />
          </div>

          {actionError ? (
            <p role="alert" className={styles.errorBand}>
              {actionError}
              {retryOrder ? (
                <button type="button" onClick={() => { const next = retryOrder; setRetryOrder(null); if (next) void applyOrder(next) }}>再試行</button>
              ) : (
                <button type="button" onClick={() => void load()}>読み直す</button>
              )}
            </p>
          ) : null}

          {status === 'forbidden' ? (
            <div className={styles.stateCard}>
              <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>友だち情報欄を見る権限がありません</p>
              <p className={styles.stateDesc}>オーナーか管理者に確認してください。</p>
            </div>
          ) : status === 'error' ? (
            <div className={styles.stateCard}>
              <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
                <AlertCircle size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>友だち情報欄を読み込めませんでした</p>
              <p className={styles.stateDesc}>{error || '再読み込みしても直らない場合はエラー報告へ。'}</p>
              <Button type="button" onClick={() => void load()}>もう一度試す</Button>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.stateCard}>
              <span className={styles.stateIcon}>
                <ClipboardList size={20} aria-hidden="true" />
              </span>
              <p className={styles.stateTitle}>まだ友だち情報欄がありません</p>
              <p className={styles.stateDesc}>「＋ 項目を作る」から最初の項目を作ってください。</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.stateCard}>
              <p className={styles.stateTitle}>条件に合う項目はありません</p>
              <p className={styles.stateDesc}>項目名・種類・フォルダを変えてください。</p>
              {filterActive ? (
                <Button type="button" onClick={() => { setQuery(''); setType('all'); setFolderFilter('') }}>条件を外す</Button>
              ) : null}
            </div>
          ) : (
            <DelayedSkeleton loading={status === 'loading'} skeleton={<TagRowsSkeleton rows={4} narrow={[120]} />}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <TableHeadRow>
                      <Th style={{ width: 44 }}><span className="sr-only">並び替え</span></Th>
                      <Th>項目名</Th>
                      <Th>種類</Th>
                      <Th>使用中</Th>
                      <Th>回答フォーム</Th>
                      <Th>表示先</Th>
                      <Th className={styles.menuCell}><span className="sr-only">操作</span></Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {pageItems.map((field) => {
                      const editHref = `/tags/fields/edit?id=${encodeURIComponent(field.id)}`
                      return (
                        <tr
                          key={field.id}
                          className={styles.rowClick}
                          data-leaving={leavingId === field.id || undefined}
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
                            draggable={canEdit && !field.isInherited}
                            onClick={(event) => event.stopPropagation()}
                            onDragStart={() => setDragId(field.id)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => void move(field.id)}
                            className={styles.gripCell}
                            data-fixed={field.isInherited || !canEdit}
                          >
                            <ReorderGrip
                              label={field.name}
                              disabled={field.isInherited || !canEdit}
                              disabledReason={field.isInherited ? '共通項目は移行後に並び替えできます' : '閲覧のみのため並び替えできません'}
                              onMove={(direction) => void keyboardMove(field.id, direction)}
                            />
                          </td>
                          <td>
                            <Link href={editHref} className={styles.cellTitle} title={`${field.name}を編集`} onClick={(event) => event.stopPropagation()}>{field.name}</Link>
                            <p className={`${styles.cellSub} ${styles.mono}`} title={`{{field.${field.fieldKey}}}`}>{`{{field.${field.fieldKey}}}`}</p>
                          </td>
                          <td className={styles.cellText}>{FIELD_TYPE_LABELS[field.type] ?? field.type}</td>
                          <td className={styles.cellText} style={{ fontVariantNumeric: 'tabular-nums' }}>{knownUsageCount(field) ?? '—'}{knownUsageCount(field) === null ? '' : '人'}</td>
                          <td className={styles.cellMuted} title={field.formUsageCount === undefined ? '回答フォームの使用数は未集計' : undefined}>
                            {field.formUsageCount === undefined ? '—' : `${field.formUsageCount}個`}
                          </td>
                          <td className={styles.cellMuted}><span className={styles.cellTruncate} title={destinationLabel(field)}>{destinationLabel(field)}</span></td>
                          <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                            {field.isInherited ? (
                              <span title="共通項目は直接削除できません" className="mr-1 inline-flex align-middle text-ink-faint">
                                <LockKeyhole size={16} aria-label="共通項目のため削除できません" />
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className={styles.menuButton}
                              aria-label={`項目「${field.name}」の操作`}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === field.id}
                              title={`項目「${field.name}」の操作`}
                              onClick={() => setOpenMenuId((current) => (current === field.id ? null : field.id))}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </button>
                            <ActionMenu
                              open={openMenuId === field.id}
                              onClose={() => setOpenMenuId(null)}
                              ariaLabel={`項目「${field.name}」の操作`}
                              items={rowMenuItems(field)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.pagerRow}>
                <span className={styles.pagerCount}>
                  {visible.length}件中 {visible.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, visible.length)}件
                </span>
                <div className={styles.pagerRight}>
                  <Select
                    aria-label="表示件数"
                    size="page-size"
                    value={String(pageSize)}
                    onChange={(value) => setPageSize(Number(value) || 20)}
                    options={[
                      { value: '20', label: '20件表示' },
                      { value: '30', label: '30件表示' },
                      { value: '40', label: '40件表示' },
                      { value: '50', label: '50件表示' },
                      { value: '100', label: '100件表示' },
                    ]}
                  />
                  <Pagination
                    page={currentPage}
                    pageCount={pages}
                    onPageChange={setPage}
                    ariaLabel="友だち情報欄のページ送り"
                  />
                </div>
              </div>

              {/* 表の下の段（安全確認の説明・v7 と同じ言葉）。 */}
              <section className={styles.safetyNote}>
                <h2 className={styles.safetyNoteTitle}>既定値・種類・削除の安全確認</h2>
                <p className={styles.safetyNoteBody}>既定値は空欄送信事故を防ぎます。種類は新規登録後に変更不可とし、値が入っている項目は削除せず新しい項目へ移行します。</p>
              </section>
            </DelayedSkeleton>
          )}
        </div>
      </div>

      {folderDialog ? (
        <FolderAddDialog
          kind="friend_field"
          folder={folderDialog === 'new' ? undefined : folderDialog}
          accountId={accountId}
          note="項目を分けてしまう箱です。消しても、入っていた項目は未分類として残ります。"
          placeholder="例: 基本情報"
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
        onConfirm={() => void removeFolder()}
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
