'use client'

/*
 * ★V8 オートメーションの共通アクション（Pencil `LnGNw`）。
 *
 * 2026-10-06 オーナー決定で src/v8 に一から書いた。データの口・動きは今までの V8
 * （app/common-actions/common-actions-v8.tsx）と同じ（一覧・検索・状態の絞り込み・複製・保管・CSV）。
 * 違いは見せ方だけ——型（ListPage）に、タブ・数の帯・左のフォルダの列（上に「共通アクションを作る」）・
 * 案内の帯・道具の段・表（絵の列の並び）を渡す。行の右端は「中身を見る」と「…」。
 */
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Archive,
  Bookmark,
  Download,
  FilePen,
  GitBranch,
  Link2,
  ListChecks,
  MoreHorizontal,
  PhoneOff,
  Plus,
  Radio,
  TriangleAlert,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, type CommonActionSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { formatNumber } from '@/lib/format'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import Notice from '@/components/shared/notice'
import FilterChip from '@/components/shared/filter-chip'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import {
  AUTOMATIONS_DESCRIPTION,
  AutomationBand,
  AutomationTabs,
  READONLY_REASON,
  ViewerBand,
  useAutomationManage,
  useAutomationRunManage,
  useAutomationTabCounts,
  type BandCell,
} from './shell'
import styles from './common-actions.module.css'

type Filter = 'all' | 'published' | 'draft' | 'old_version' | 'unused' | 'archived'
type Summary = {
  total: number; published: number; draft: number; oldVersion: number; unused: number; archived: number
  actions: number; bindings: number; outdated: number; outdatedItems: number; executions: number; failures: number
}

const STATUS_LABEL: Record<CommonActionSummary['status'], string> = {
  published: '公開中',
  draft: '下書き',
  archived: '保管',
}
const UNFILED = '__unfiled__'

/** 「中身を見る」と「使われている場所」の行き先（版と使われている場所の画面）。 */
export function versionsHref(id: string): string {
  return `/common-actions/versions?id=${encodeURIComponent(id)}`
}

function TableHead() {
  return (
    <thead>
      <TableHeadRow className={styles.headRow} data-table-layout="columns">
        <Th className={styles.colName}>アクション名</Th>
        <Th className={styles.colState}>状態</Th>
        <Th className={styles.colSteps}>中の処理</Th>
        <Th className={styles.colUsed} align="right">呼び出し元</Th>
        <Th className={styles.colVersion}>版</Th>
        <Th className={styles.colOps}>操作</Th>
      </TableHeadRow>
    </thead>
  )
}

export default function CommonActionsV8() {
  usePageTitle('オートメーション')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useAutomationManage()
  const canEdit = canManage !== false
  const viewerOnly = canManage === false
  const runPermissions = useAutomationRunManage()
  const canExportCsv = runPermissions === null || runPermissions.canExport
  const tabCounts = useAutomationTabCounts()

  const [items, setItems] = useState<CommonActionSummary[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<{ item: CommonActionSummary; mode: 'archive' | 'unarchive' } | null>(null)
  const [archivingBusy, setArchivingBusy] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [actionError, setActionError] = useState('')
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const my = ++requestSeq.current
    if (!selectedAccountId) {
      setItems([]); setSummary(null); setTotal(0); setLoading(false)
      return
    }
    setLoading(true)
    setActionError('')
    setLoadFailed(false)
    try {
      const response = await api.commonActions.list({
        accountId: selectedAccountId,
        status: filter,
        query: deferredQuery,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (requestSeq.current !== my) return
      if (response.success) {
        setItems(response.data)
        setTotal(response.pagination?.total ?? response.data.length)
        if (response.summary) setSummary(response.summary)
      } else {
        setLoadFailed(true)
      }
    } catch {
      if (requestSeq.current !== my) return
      setLoadFailed(true)
    } finally {
      if (requestSeq.current === my) setLoading(false)
    }
  }, [deferredQuery, filter, page, pageSize, selectedAccountId])

  /* フォルダの箱（kind=common_action）。共通アクションを入れる口がまだ無いので、件数は出さない。 */
  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) { setFolders([]); return }
    try {
      const res = await api.folders.list('common_action', selectedAccountId)
      setFolders(res.success ? res.data : [])
    } catch {
      setFolders([])
    }
  }, [selectedAccountId])

  useEffect(() => { if (!accountLoading) void load() }, [accountLoading, load])
  useEffect(() => { void loadFolders() }, [loadFolders])
  useEffect(() => { setPage(1) }, [filter, deferredQuery, pageSize, selectedAccountId])

  const duplicate = async (item: CommonActionSummary) => {
    if (!selectedAccountId || duplicatingId) return
    setDuplicatingId(item.id)
    setActionError('')
    try {
      const response = await api.commonActions.duplicate(item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      router.push(`/common-actions/edit?id=${encodeURIComponent(response.data.id)}`)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '共通アクションを複製できませんでした')
      setDuplicatingId(null)
    }
  }

  /* 保管：使われている所があるときは保管できない（サーバも断る）。窓で理由を出して閉じるだけ。 */
  const confirmArchive = async () => {
    if (!archiving || !selectedAccountId || archivingBusy) return
    if (archiving.mode === 'archive' && archiving.item.bindingCount > 0) {
      setArchiving(null)
      return
    }
    setArchivingBusy(true)
    setArchiveError('')
    try {
      const response = archiving.mode === 'archive'
        ? await api.commonActions.archive(archiving.item.id, selectedAccountId)
        : await api.commonActions.unarchive(archiving.item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      setArchiving(null)
      await load()
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : '操作を完了できませんでした')
    } finally {
      setArchivingBusy(false)
    }
  }

  /* 行の「…」：使われている場所・公開する（下書き）・複製・保管／保管を戻す（閲覧のみは使われている場所だけ）。 */
  const rowMenuItems = (item: CommonActionSummary): ActionMenuItem[] => {
    const usage: ActionMenuItem = { id: 'usage', label: '版と使われている場所を見る', onSelect: () => router.push(versionsHref(item.id)) }
    if (!canEdit) return [usage]
    return [
      usage,
      ...(item.status !== 'archived'
        ? [{ id: 'edit', label: item.status === 'draft' ? '下書きを編集・公開する' : '下書きの中身を編集する', onSelect: () => router.push(`/common-actions/edit?id=${encodeURIComponent(item.id)}`) }]
        : []),
      { id: 'duplicate', label: duplicatingId === item.id ? '複製中' : '複製して下書きを作る', disabled: duplicatingId !== null, onSelect: () => void duplicate(item) },
      item.status === 'archived'
        ? { id: 'unarchive', label: '保管を戻す', onSelect: () => { setArchiveError(''); setArchiving({ item, mode: 'unarchive' }) } }
        : { id: 'archive', label: '保管する', tone: 'danger', dividerBefore: true, onSelect: () => { setArchiveError(''); setArchiving({ item, mode: 'archive' }) } },
    ]
  }

  /* ===== 数の帯 ===== */
  const ready = summary !== null && !loadFailed
  const cells: BandCell[] = [
    { key: 'total', title: '共通アクション', icon: <ListChecks size={13} aria-hidden="true" />, value: ready ? summary.total : null, unit: '件', detail: ready ? `公開中 ${summary.published}・下書き ${summary.draft}` : '—' },
    { key: 'bindings', title: '使われている所', icon: <Link2 size={13} aria-hidden="true" />, value: ready ? summary.bindings : null, unit: 'か所', detail: ready && summary.outdated > 0 ? `古い版のまま ${summary.outdated}か所` : 'ルール・シナリオなど5機能から' },
    { key: 'executions', title: '今月動いた', icon: <Activity size={13} aria-hidden="true" />, value: ready ? summary.executions : null, unit: '回', detail: '今月（日本時間）の実行回数' },
    { key: 'failures', title: '失敗', icon: <TriangleAlert size={13} aria-hidden="true" />, value: ready ? summary.failures : null, unit: '件', detail: '「動いた記録」からやり直せます' },
  ]

  /* ===== フォルダ ===== */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: ready ? summary.total : null },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: null, color: folder.color })),
    { id: UNFILED, label: '未分類', count: ready ? summary.total : null },
  ]
  /* 閲覧のみには押せない「共通アクションを作る」を置かない（場所だけ空ける）。 */
  const createButton = canEdit
    ? <Button variant="primary" href="/common-actions/new" className="v8-folder-create w-full"><Plus size={15} aria-hidden="true" />共通アクションを作る</Button>
    : <span className={styles.createSpace} aria-hidden="true" />

  /* ===== 道具の段 ===== */
  const count = (value: number | undefined) => (value === undefined || !ready ? '' : ` ${formatNumber(value)}`)
  const chip = (value: Exclude<Filter, 'all'>, label: string, icon: ReactNode, n: number | undefined) => (
    <FilterChip selected={filter === value} onChange={(next) => setFilter(next ? value : 'all')} icon={icon}>{`${label}${count(n)}`}</FilterChip>
  )
  const filterChips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      {chip('published', '公開中', <Radio size={13} aria-hidden="true" />, summary?.published)}
      {chip('draft', '下書き', <FilePen size={13} aria-hidden="true" />, summary?.draft)}
      {chip('old_version', '古い版あり', <GitBranch size={13} aria-hidden="true" />, summary?.oldVersion)}
      {chip('unused', '呼ばれていない', <PhoneOff size={13} aria-hidden="true" />, summary?.unused)}
      {chip('archived', '保管', <Archive size={13} aria-hidden="true" />, summary?.archived)}
    </div>
  )
  const savedBox = (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select
        aria-label="よく使う絞り込み"
        value={filter === 'old_version' || filter === 'unused' ? filter : ''}
        onChange={(value) => setFilter((value || 'all') as Filter)}
        options={[
          { value: '', label: 'よく使う絞り込み' },
          { value: 'old_version', label: '古い版のまま使われている' },
          { value: 'unused', label: 'どこからも呼ばれていない' },
        ]}
      />
    </div>
  )
  const toolbar = (
    <>
      <div className={styles.noticeRow}>
        <Notice tone="info">共通アクションは、ルール・シナリオ・自動応答・回答フォーム・リッチメニューから呼び出せる「処理のまとまり」です。公開しても、使っている所は今の版のまま。使う所ごとに新しい版へ切り替えます。</Notice>
      </div>
      {actionError ? <div className={styles.noticeRow}><Notice tone="danger">{actionError}</Notice></div> : null}
      <ListToolbar
        search={{ placeholder: '共通アクションを探す', label: '共通アクションを検索', width: 240, value: query, onChange: setQuery }}
        filters={filterChips}
        trailing={<>{savedBox}<PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} label={null} /></>}
      />
    </>
  )

  /* ===== 表 ===== */
  let listBody: ReactNode
  if (accountLoading || loading) {
    listBody = <ListState kind="loading" title="共通アクションを読み込んでいます" />
  } else if (!selectedAccountId) {
    listBody = <ListState kind="empty" title="LINE公式アカウントを選んでください" />
  } else if (loadFailed) {
    listBody = (
      <ListState
        kind="error"
        title="共通アクションを読み込めませんでした"
        description="登録した内容は消えていません。通信を確かめて、もう一度お試しください。"
        action={<Button variant="secondary" onClick={() => void load()}>もう一度試す</Button>}
      />
    )
  } else if (items.length === 0 || (folderFilter && folderFilter !== UNFILED)) {
    listBody = query || filter !== 'all' || folderFilter
      ? <ListState kind="empty" title="条件に合う共通アクションはありません" description="検索や絞り込みの札を外すと、すべて出ます。" action={<Button variant="secondary" onClick={() => { setQuery(''); setFilter('all'); setFolderFilter('') }}>条件を外す</Button>} />
      : <ListState kind="empty" title="まだ、共通アクションはありません" description="よく使う処理をまとめると、設定の重複を減らせます。" action={canEdit ? <Button variant="primary" href="/common-actions/new"><Plus size={15} aria-hidden="true" />共通アクションを作る</Button> : undefined} />
  } else {
    listBody = (
      <>
        <div className={styles.tableWrap}>
          <DataTable className={styles.table}>
            <TableHead />
            <tbody>
              {items.map((item) => {
                const menuLabel = `共通アクション「${item.name}」の操作`
                const versionSub = item.oldVersionBindingCount > 0
                  ? `古い版 ${item.oldVersionBindingCount}`
                  : item.status === 'published' && item.draftVersion != null ? '下書きあり' : null
                return (
                  <Tr key={item.id} className={styles.row} data-table-layout="columns" data-row-id={item.id}>
                    <Td className={styles.colName}>
                      {/* 名前の前にフォルダの丸（共通アクションはフォルダに入れないので未分類の輪）。説明は名前の頭にそろえる。 */}
                      <FolderDotName folder={null}>
                        <a className={styles.name} href={versionsHref(item.id)} title={item.name} onClick={(event) => { event.preventDefault(); router.push(versionsHref(item.id)) }}>{item.name}</a>
                      </FolderDotName>
                      <span className={`${styles.sub} ${styles.subIndent}`} title={item.description ?? undefined}>{item.description || '説明はありません'}</span>
                    </Td>
                    <Td className={styles.colState}>
                      <span className={styles.pill} data-tone={item.status === 'published' ? 'active' : 'neutral'}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {STATUS_LABEL[item.status]}
                      </span>
                    </Td>
                    <Td className={styles.colSteps}><span className={styles.main}>{`${item.actionCount}個の処理`}</span></Td>
                    <Td className={styles.colUsed}><span className={styles.main}>{`${formatNumber(item.bindingCount)} か所`}</span></Td>
                    <Td className={styles.colVersion}>
                      <span className={styles.main}>{item.publishedVersion ? `v${item.publishedVersion}` : '—'}</span>
                      {versionSub ? <span className={item.oldVersionBindingCount > 0 ? styles.subWarn : styles.sub}>{versionSub}</span> : null}
                    </Td>
                    <Td className={styles.colOps}>
                      <div className={styles.opsBox}>
                        <Button href={versionsHref(item.id)}>中身を見る</Button>
                        <IconButton
                          title={menuLabel}
                          aria-label={menuLabel}
                          aria-haspopup="menu"
                          aria-expanded={openMenuId === item.id}
                          onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu
                          open={openMenuId === item.id}
                          onClose={() => setOpenMenuId(null)}
                          ariaLabel={menuLabel}
                          note={canEdit ? undefined : READONLY_REASON}
                          items={rowMenuItems(item).map((menuItem) => ({ ...menuItem, onSelect: () => { setOpenMenuId(null); menuItem.onSelect() } }))}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
        <p className={styles.footNote}>
          {canEdit
            ? '行の「…」から 版と使われている場所を見る・下書きの中身を編集・複製・保管。'
            : '行の「…」から 版と使われている場所を見る。'}
        </p>
      </>
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pager = !loading && !loadFailed && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, total)} / {formatNumber(total)}件
      </span>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="共通アクション一覧のページ送り" />
    </ListPagePagination>
  ) : null

  const csvEmpty = !loading && !loadFailed && total === 0
  const csvScoped = filter !== 'all' || deferredQuery.trim() !== ''

  return (
    <ListPage
      boardId="LnGNw"
      headingSize="regular"
      title="オートメーション"
      description={AUTOMATIONS_DESCRIPTION}
      actions={canExportCsv && selectedAccountId
        ? csvEmpty
          ? <Button disabled title="条件に合う共通アクションがないため書き出せません"><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
          : (
            <Button
              href={api.commonActions.csvUrl({ accountId: selectedAccountId, status: filter === 'all' ? undefined : filter, query: deferredQuery.trim() || undefined })}
              title={csvScoped ? `この条件の${total}件を書き出します` : `全${total}件を書き出します`}
            >
              <Download size={15} aria-hidden="true" />CSV で書き出す
            </Button>
          )
        : undefined}
      tabs={<AutomationTabs active="common-actions" counts={{ ...tabCounts, commonActions: ready ? summary.total : tabCounts.commonActions }} />}
      stats={<>
        {viewerOnly ? <ViewerBand /> : null}
        <AutomationBand label="共通アクションの数の帯" cells={cells} />
      </>}
      folders={<>
        {createButton}
        <FolderPanel
          activeId={folderFilter}
          onSelect={setFolderFilter}
          onAddFolder={canEdit ? () => setFolderDialogOpen(true) : undefined}
          addFolderLabel="フォルダを追加"
          rows={folderRows}
        >
          {canEdit ? null : <span className={styles.addSpace} aria-hidden="true" />}
          <p className={styles.folderNote}>フォルダを消しても、中の共通アクションは未分類に残ります</p>
        </FolderPanel>
      </>}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
        {folderDialogOpen ? (
          <FolderAddDialog
            kind="common_action"
            accountId={selectedAccountId}
            note="共通アクションを分けてしまう箱です。消しても、入っていた共通アクションは未分類として残ります。"
            placeholder="例: 購入・予約"
            onClose={() => setFolderDialogOpen(false)}
            onAdded={() => void loadFolders()}
          />
        ) : null}
        <Dialog
          open={Boolean(archiving)}
          title={archiving?.mode === 'unarchive'
            ? `「${archiving?.item.name}」の保管を戻しますか`
            : `「${archiving?.item.name}」を保管しますか`}
          description={archiving?.mode === 'unarchive'
            ? '通常一覧に戻ります。実行記録はそのまま残ります。'
            : '通常一覧から外れます。実行記録は残ります。'}
          confirmLabel={archiving?.mode === 'unarchive'
            ? '保管を戻す'
            : archiving && archiving.item.bindingCount > 0 ? '閉じる' : '保管する'}
          busy={archivingBusy}
          onCancel={() => setArchiving(null)}
          onConfirm={() => void confirmArchive()}
        >
          {archiving?.mode === 'archive' && archiving.item.bindingCount > 0 ? (
            <p className={styles.dialogWarn} role="alert">
              利用中のため保管できません（{archiving.item.bindingCount}か所）。先に利用先を外してください。
            </p>
          ) : null}
          {archiveError ? <p className={styles.dialogError} role="alert">{archiveError}</p> : null}
        </Dialog>
      </>}
    >
      {listBody}
    </ListPage>
  )
}
