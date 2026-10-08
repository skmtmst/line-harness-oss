'use client'

/*
 * ★V8 統括 一括配信の一覧（絵 U4Eep0・V8.pen の行「統括」。2026-10-08 オーナー：店の一斉配信とほぼ同じ画面）。
 *
 * 店の一斉配信の一覧（src/v8/broadcasts/list.tsx）と同じ型（ListPage）・同じ共通部品（数の帯・札・表・ページ送り）・
 * 同じ見た目（店の一覧の CSS をそのまま読む）で組む。違いは「送るアカウント」だけ：
 *   - 配信条件の列は「N アカウント」と、誰に送るか（友だち全員／タグ）
 *   - 結果の列はアカウントの合計（届いた人数・失敗したアカウント）
 * 1行＝1回の一括配信。行を押すと詳細（送った結果）へ。動きは BEHAVIOR.md。
 */
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowUpDown, CalendarClock, FilePen, Inbox, List, MailOpen, Plus, Send } from 'lucide-react'
import type { HqBroadcastRun } from '@line-crm/shared'
import { ListPage, ListPagePagination } from '@/components/templates/list-page'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel from '@/components/shared/folder-panel'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { FolderDotName } from '@/components/shared/folder-dot'
import { deleteFolderDescription } from '@/components/shared/folder-row-actions'
import { TextField } from '@/components/shared/text-field'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import type { FolderPanelRow } from '@/components/shared/folder-panel'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import { formatNumber } from '@/lib/format'
import { hqBroadcastsApi } from '@/lib/hq-broadcasts-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { failedCount, jpDateTime, runBadge, sendTotals } from './model'
import styles from '../broadcasts/list.module.css'

type StatusKey = 'all' | 'scheduled' | 'draft' | 'sent' | 'error'
const STATUS_CHIPS: { key: StatusKey; label: string; icon: typeof List }[] = [
  { key: 'all', label: 'すべて', icon: List },
  { key: 'scheduled', label: '予約中', icon: CalendarClock },
  { key: 'draft', label: '下書き', icon: FilePen },
  { key: 'sent', label: '送信済み', icon: Send },
  { key: 'error', label: 'エラー', icon: AlertCircle },
]

/** 一覧の札と同じ分け方（runBadge の言葉から）。 */
function statusKeyOf(run: HqBroadcastRun): Exclude<StatusKey, 'all'> | null {
  const label = runBadge(run).label
  if (label === '下書き') return 'draft'
  if (label === '予約中' || label === '送っています') return 'scheduled'
  if (label === '送信済み' || label === '一部失敗') return 'sent'
  if (label === '失敗あり') return 'error'
  return null
}

function audienceText(run: HqBroadcastRun): string {
  return run.input?.audience?.kind === 'tag' ? `タグ：${run.input.audience.tagName}` : '友だち全員'
}

const NEW_HREF = '/hq/broadcasts/new'

/** 開封・クリックの率（API-18。アカウントの合計。1つでも数えていなければ出さない）。 */
function rateLine(targets: HqBroadcastRun['targets'], reached: number): string | null {
  if (reached <= 0 || targets.length === 0) return null
  if (targets.some((t) => t.openedCount == null || t.clickedCount == null)) return null
  const pct = (n: number) => `${((n / reached) * 100).toFixed(1)}%`
  return `開封 ${pct(targets.reduce((sum, t) => sum + (t.openedCount ?? 0), 0))}・クリック ${pct(targets.reduce((sum, t) => sum + (t.clickedCount ?? 0), 0))}`
}

/** 統括の一括配信のフォルダ（API-18。色は持たない）。 */
type HqFolder = { id: string; name: string; revision: number; item_count: number; color?: string | null }

export default function HqBroadcastList() {
  const router = useRouter()
  usePageTitle('一括配信')
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)
  const [runs, setRuns] = useState<HqBroadcastRun[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusKey>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  /* 並び順（絵 U4Eep0 の「新しい順」）。口は作った順の新しい順で返すので、古い順は逆に並べる。 */
  const [sortKey, setSortKey] = useState<'newest' | 'oldest'>('newest')
  /* 左の列のフォルダ（店の一斉配信と同じ。API-18 の統括のフォルダ）。読めなくても一覧は出す。 */
  const [folders, setFolders] = useState<HqFolder[] | null>(null)
  const [folderFilter, setFolderFilter] = useState('all')
  const [folderDialog, setFolderDialog] = useState<{ editing: HqFolder | null } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [deletingFolder, setDeletingFolder] = useState<HqFolder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await hqBroadcastsApi.list()
      setRuns(res.data); setError(null)
    } catch (caught) {
      setError(caught)
    }
  }, [])
  const loadFolders = useCallback(async () => {
    try {
      const res = await hqBroadcastsApi.folders()
      setFolders(res.data)
    } catch {
      setFolders(null)
    }
  }, [])
  useEffect(() => { void load(); void loadFolders() }, [load, loadFolders])

  const all = useMemo(() => runs ?? [], [runs])
  const counts = useMemo(() => {
    const result: Record<StatusKey, number> = { all: all.length, scheduled: 0, draft: 0, sent: 0, error: 0 }
    for (const run of all) { const key = statusKeyOf(run); if (key) result[key] += 1 }
    return result
  }, [all])
  const folderIdOf = (run: HqBroadcastRun) => run.input?.folderId ?? null
  const inFolder = useCallback((run: HqBroadcastRun) => folderFilter === 'all' || (folderFilter === 'none' ? !run.input?.folderId || !(folders ?? []).some((f) => f.id === run.input.folderId) : run.input?.folderId === folderFilter), [folderFilter, folders])
  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase()
    const hits = all.filter((run) => inFolder(run) && (status === 'all' || statusKeyOf(run) === status)
      && (!words || [run.title, run.input?.messageContent ?? ''].some((text) => text.toLocaleLowerCase().includes(words))))
    return sortKey === 'oldest' ? [...hits].reverse() : hits
  }, [all, status, query, inFolder, sortKey])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize)

  /* 数の帯（一括配信の記録から数えられるもの）。 */
  const ready = runs !== null
  const sentRuns = all.filter((run) => statusKeyOf(run) === 'sent')
  const delivered = sentRuns.reduce((sum, run) => sum + run.targets.filter((t) => !t.excluded).reduce((s, t) => s + t.successCount, 0), 0)
  const failedStores = all.reduce((sum, run) => sum + run.targets.filter((t) => !t.excluded && (t.status === 'failed' || failedCount(t) > 0)).length, 0)
  /*
   * 平均の開封率（絵 U4Eep0 の4つ目）：送った配信の開いた人の合計÷届いた人の合計。開いた数を数えていない
   * アカウントが1つでもあれば出さない（「—」）。一覧に送った日が無いので「過去28日」ではなく送った配信全体。
   * 今月の送信枠（絵の2つ目）は統括の口に無いので、代わりにエラーを置く（見た目だけ置かない）。
   */
  const sentTargets = all.filter((run) => statusKeyOf(run) === 'sent' || statusKeyOf(run) === 'error').flatMap((run) => run.targets.filter((t) => !t.excluded && t.successCount > 0))
  const openKnown = sentTargets.length > 0 && sentTargets.every((t) => t.openedCount != null)
  const openReached = sentTargets.reduce((sum, t) => sum + t.successCount, 0)
  const openRate = openKnown && openReached > 0 ? Math.round((sentTargets.reduce((sum, t) => sum + (t.openedCount ?? 0), 0) / openReached) * 1000) / 10 : null
  const kpis = [
    { key: 'scheduled', title: '予約中', icon: CalendarClock, value: ready ? counts.scheduled : null, unit: '件', detail: ready ? `下書き ${formatNumber(counts.draft)}件` : '—' },
    { key: 'sent', title: '送った配信', icon: Send, value: ready ? counts.sent : null, unit: '件', detail: ready ? `${formatNumber(delivered)}人に届いた` : '—' },
    { key: 'error', title: 'エラー', icon: AlertCircle, value: ready ? counts.error : null, unit: '件', detail: ready ? `失敗したアカウント ${formatNumber(failedStores)}件` : '—' },
    { key: 'open', title: '平均の開封率', icon: MailOpen, value: ready ? openRate : null, unit: '%', detail: ready ? (openRate == null ? 'まだ数えていません' : '送った配信の合計') : '—' },
  ]

  const createButton = (full: boolean) => canManage ? (
    <Button variant="primary" href={NEW_HREF} className={full ? 'v8-folder-create w-full' : undefined}>
      <Plus size={15} aria-hidden="true" />配信を作る
    </Button>
  ) : null

  const countIn = (id: string) => all.filter((run) => (id === 'none' ? !folderIdOf(run) || !(folders ?? []).some((f) => f.id === folderIdOf(run)) : folderIdOf(run) === id)).length
  const folderRows: FolderPanelRow[] = [
    { id: 'all', label: 'すべて', count: ready ? all.length : null, icon: <Inbox size={15} aria-hidden="true" /> },
    ...(folders ?? []).map((folder) => ({
      id: folder.id,
      label: folder.name,
      color: folder.color,
      count: ready ? countIn(folder.id) : null,
      colorEditable: false,
      ...(canManage ? {
        onEdit: () => { setFolderError(''); setFolderName(folder.name); setFolderDialog({ editing: folder }) },
        onDelete: () => { setFolderError(''); setDeletingFolder(folder) },
      } : {}),
    })),
    ...(folders && folders.length > 0 ? [{ id: 'none', label: '未分類', count: ready ? countIn('none') : null }] : []),
  ]
  const selectFolder = (id: string) => { setFolderFilter(id); setPage(1) }
  const saveFolder = async () => {
    const name = folderName.trim()
    if (!name || folderBusy || !folderDialog) return
    setFolderBusy(true); setFolderError('')
    try {
      if (folderDialog.editing) await hqBroadcastsApi.updateFolder(folderDialog.editing.id, name, folderDialog.editing.revision)
      else await hqBroadcastsApi.createFolder(name)
      await loadFolders()
      setFolderDialog(null)
    } catch (caught) {
      setFolderError(japaneseDetailOf(caught) || 'フォルダを保存できませんでした')
    } finally {
      setFolderBusy(false)
    }
  }
  const removeFolder = async () => {
    if (!deletingFolder || folderBusy) return
    setFolderBusy(true); setFolderError('')
    try {
      await hqBroadcastsApi.deleteFolder(deletingFolder.id, deletingFolder.revision)
      await loadFolders()
      setDeletingFolder(null); setFolderFilter('all')
    } catch (caught) {
      setFolderError(japaneseDetailOf(caught) || 'フォルダを消せませんでした')
    } finally {
      setFolderBusy(false)
    }
  }

  const toolbar = (
    <div className={styles.tools}>
      <div className={styles.toolRow}>
        <div className={styles.searchBox}>
          <SearchField aria-label="タイトル・内容で探す" placeholder="タイトル・内容で探す" value={query} onChange={(value) => { setQuery(value); setPage(1) }} onClear={() => { setQuery(''); setPage(1) }} />
        </div>
      </div>
      <div className={styles.toolRow}>
        <div className={styles.chips} role="group" aria-label="状態で絞る">
          {STATUS_CHIPS.map((chip) => (
            <FilterChip key={chip.key} selected={status === chip.key} onChange={() => { setStatus(chip.key); setPage(1) }} icon={<chip.icon size={13} aria-hidden="true" />}>
              {`${chip.label} ${formatNumber(counts[chip.key])}`}
            </FilterChip>
          ))}
        </div>
        <span className={styles.spacer} aria-hidden="true" />
        <div className={styles.pageSizeBox}>
          <Select
            aria-label="表示件数"
            size="page-size"
            value={String(pageSize)}
            onChange={(value) => { setPageSize(Number(value) || 20); setPage(1) }}
            options={[{ value: '10', label: '10件表示' }, { value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }]}
          />
        </div>
        <button
          type="button"
          className={styles.sortButton}
          aria-label={`並び順：${sortKey === 'newest' ? '新しい順' : '古い順'}（押すと入れ替え）`}
          onClick={() => { setSortKey((current) => (current === 'newest' ? 'oldest' : 'newest')); setPage(1) }}
        >
          <ArrowUpDown size={14} aria-hidden="true" />
          {sortKey === 'newest' ? '新しい順' : '古い順'}
        </button>
      </div>
    </div>
  )

  let content
  if (error && !runs) content = <ListState kind="error" error={error} onRetry={() => void load()} />
  else if (!runs) content = <ListState kind="loading" />
  else if (filtered.length === 0) {
    content = (
      <EmptyList
        icon={<Send aria-hidden="true" />}
        title="一括配信はまだありません"
        description="送るアカウントを選んで、同じ内容を一度に送れます。各店のアカウントに入らずに送れます。"
        create={{ label: '最初の一括配信を作る', href: NEW_HREF }}
        canCreate={canManage}
        filtered={Boolean(query || status !== 'all' || folderFilter !== 'all')}
        onClearFilters={() => { setQuery(''); setStatus('all'); setFolderFilter('all'); setPage(1) }}
        filteredDescription="検索や状態の札を外すと、すべて出ます"
      />
    )
  } else {
    content = (
      <DataTable className={styles.table} data-design="hq-broadcasts">
        <thead>
          <TableHeadRow>
            <Th className={styles.colTitle}>タイトル・内容</Th>
            <Th className={styles.colStatus}>状態</Th>
            <Th className={styles.colAudience}>配信条件</Th>
            <Th className={styles.colDate}>配信日時</Th>
            <Th className={styles.colResultWide}>結果</Th>
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {shown.map((run) => {
            const badge = runBadge(run)
            const totals = sendTotals(run.targets)
            const live = run.targets.filter((t) => !t.excluded)
            const href = `/hq/broadcasts/detail?id=${encodeURIComponent(run.id)}`
            const stores = run.status === 'prepared' ? `${formatNumber(totals.sendStores)} アカウント（外す ${formatNumber(totals.skipStores)}）` : `${formatNumber(live.length)} アカウント`
            const reached = live.reduce((sum, t) => sum + t.successCount, 0)
            const failed = live.filter((t) => t.status === 'failed' || failedCount(t) > 0).length
            const sent = statusKeyOf(run) === 'sent' || statusKeyOf(run) === 'error'
            return (
              <Tr key={run.id} className={styles.row}>
                <Td>
                  <div className={styles.titleLine}>
                    <FolderDotName folder={(() => { const folder = (folders ?? []).find((f) => f.id === folderIdOf(run)); return folder ? { name: folder.name, color: folder.color } : null })()}>
                      <Link href={href} className={styles.cellTitle} title={run.title}>{run.title}</Link>
                    </FolderDotName>
                  </div>
                  <span className={styles.cellSub}>{run.input?.messageType === 'image' ? '画像' : run.input?.messageType === 'flex' ? 'カード型' : 'テキスト'}</span>
                </Td>
                <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                <Td>
                  <span className={styles.cellMain} title={stores}>{stores}</span>
                  <span className={styles.cellSub}>{audienceText(run)}</span>
                </Td>
                <Td>
                  <span className={styles.cellMain}>{run.scheduledAt ? jpDateTime(run.scheduledAt) : run.status === 'prepared' ? '未設定' : 'すぐ送った'}</span>
                  {statusKeyOf(run) === 'scheduled' && run.scheduledAt ? <span className={styles.cellSub}>予約</span> : null}
                </Td>
                <Td>
                  {sent ? (
                    <>
                      <span className={styles.resultMain}>{`${formatNumber(reached)}人に届いた`}</span>
                      {failed > 0 ? <span className={styles.cellSub}>{`失敗したアカウント ${formatNumber(failed)}`}</span> : rateLine(live, reached) ? <span className={styles.cellSub}>{rateLine(live, reached)}</span> : null}
                    </>
                  ) : <span className={styles.cellMain}>—</span>}
                </Td>
                <Td className={styles.colMenu}>
                  <div className={styles.menuBox}>
                    <RowActions subjectName={run.title} menuItems={[
                      { id: 'open', label: run.status === 'prepared' ? '確かめて送る' : '送った結果を見る', onSelect: () => { router.push(href) } },
                      ...(run.status === 'prepared' && canManage ? [{ id: 'edit', label: '下書きを直す', onSelect: () => { router.push(`${NEW_HREF}?id=${encodeURIComponent(run.id)}`) } }] : []),
                    ]} />
                  </div>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    )
  }

  const pager = runs && filtered.length > 0 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>{pageCount > 1 ? `${formatNumber(filtered.length)}件中 ${(current - 1) * pageSize + 1}〜${Math.min(current * pageSize, filtered.length)}件` : `${formatNumber(filtered.length)}件`}</span>
      {pageCount > 1 ? <Pagination page={current} pageCount={pageCount} onPageChange={setPage} ariaLabel="一括配信のページ送り" /> : null}
    </ListPagePagination>
  ) : null

  return (
    <ListPage
      boardId="U4Eep0"
      headingSize="compact"
      title="一括配信"
      description="選んだアカウントの友だちにまとめて送るメッセージの一覧です。予約・下書き・送った結果をここで見ます。"
      stats={(
        <KpiBand>
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} presentation="band" density="compact" title={kpi.title} icon={<kpi.icon size={14} aria-hidden="true" />} value={kpi.value} unit={kpi.value == null ? '' : kpi.unit} detail={kpi.detail} />
          ))}
        </KpiBand>
      )}
      folderNav={{ rows: folderRows, activeId: folderFilter, onSelect: selectFolder, createAction: createButton(false) ?? undefined }}
      folders={(
        <FolderPanel
          createAction={createButton(true) ?? <span className={styles.viewerCreateSpace} aria-hidden="true" />}
          activeId={folderFilter}
          onSelect={selectFolder}
          onAddFolder={canManage ? () => { setFolderError(''); setFolderName(''); setFolderDialog({ editing: null }) } : undefined}
          addFolderLabel="フォルダを追加"
          rows={folderRows}
        >
          {canManage ? null : <span className={styles.viewerAddSpace} aria-hidden="true" />}
          <p className={styles.note}>フォルダを消しても、入っていたものは未分類に残ります</p>
        </FolderPanel>
      )}
      overlays={(
        <>
          <Dialog
            open={folderDialog !== null}
            title={folderDialog?.editing ? 'フォルダの名前を変える' : 'フォルダを追加'}
            description="一括配信を分けてしまう箱です。消しても、中の配信は未分類に残ります。"
            busy={folderBusy}
            error={folderError || undefined}
            confirmLabel={folderDialog?.editing ? '保存する' : '追加する'}
            cancelLabel="やめる"
            onCancel={() => { if (!folderBusy) setFolderDialog(null) }}
            onConfirm={() => void saveFolder()}
          >
            <TextField aria-label="フォルダの名前" value={folderName} maxLength={100} disabled={folderBusy} placeholder="例: キャンペーン" onChange={(event) => setFolderName(event.target.value)} />
          </Dialog>
          <ConfirmDialog
            open={deletingFolder !== null}
            title={`フォルダ「${deletingFolder?.name ?? ''}」を消しますか？`}
            description={deleteFolderDescription('一括配信', deletingFolder ? countIn(deletingFolder.id) : null)}
            confirmLabel="フォルダを消す"
            cancelLabel="キャンセル"
            destructive
            busy={folderBusy}
            error={folderError || undefined}
            onCancel={() => { if (!folderBusy) setDeletingFolder(null) }}
            onConfirm={() => void removeFolder()}
          />
        </>
      )}
      toolbar={toolbar}
      pagination={pager}
    >
      {content}
    </ListPage>
  )
}
