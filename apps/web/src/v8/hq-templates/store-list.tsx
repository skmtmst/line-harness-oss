'use client'

/*
 * ★V8 統括のひな形の一覧を「店の同じ機能の一覧と同じ形」で出す（オーナー 2026-10-08・B-27〜B-29・B-34・B-36）。
 * 絵：テンプレート i0Ao0R（V8.pen の行「統括」）・LRc93（V8-B 版）、回答フォーム wZPua、タグ DzdC3、リッチメニュー noVq4。
 *
 * 店の一覧（src/v8/templates/list.tsx）と同じ型（ListPage）・同じ共通部品（数の帯・種類のタブ・フォルダの列・表・ページ送り）・
 * 同じ見た目（店の一覧の CSS をそのまま読む）で組む。違いは「配る」口だけ：
 *   - 表の「使っている所」の代わりに「配布先」（N アカウント・まだ配っていない）
 *   - 全種類の行の右端「…」の左に［配る］（共通部品 RowQuickAction。「…」の中にも同じ項目。オーナー 2026-10-08）
 *   - 数の帯は配ったアカウントの数
 * 読み書き（一覧・分類・複製・削除・配る）は呼ぶ側（console.tsx）が今までどおり持つ。ここは見せ方と押した知らせだけ。
 */
import { useListUrlValue } from '@/components/shared/list-url-state'
import { useMemo, useState, type ReactNode } from 'react'
import {
  CircleDashed, ClipboardList, Copy, FileText, GalleryHorizontalEnd, HelpCircle, Image as ImageIcon, Inbox, Link2,
  MessageSquare, Pencil, Plus, Send, Sparkles, Ticket, Trash2, Unlink, Users,
} from 'lucide-react'
import type { HqTemplateFolder, HqTemplateListStats, TemplateKind } from '@line-crm/shared'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FolderEditorDialog from '@/components/shared/folder-editor-dialog'
import { describeFolderFailure } from '@/components/shared/folder-failure'
import { notifyToast } from '@/components/shared/toast'
import { FOLDER_SELECT_COLORS } from '@line-crm/shared'
import EmptyList from '@/components/shared/empty-list'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName } from '@/components/shared/folder-dot'
import TagPill from '@/components/shared/tag-pill'
import { deleteFolderDescription } from '@/components/shared/folder-row-actions'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListToolbar from '@/components/shared/list-toolbar'
import Pagination from '@/components/shared/pagination'
import { RowMenu, RowQuickAction } from '@/components/shared/row-actions'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import Select from '@/components/shared/select'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { formatNumber } from '@/lib/format'
import type { HqTemplate, TemplateType } from '@/lib/hq-templates-api'
import { distributedAccountsLine, templateSubLine } from './list-row'
import { AttributeTabs, OtherTabPanel, assignmentMethods, cleanupTagCount, matchesTagFilters, unusedTagCount, useAttributeTab, type TagUsageFilter } from './attribute-tabs'
import storeStyles from '../templates/list.module.css'
import hqStyles from './store-list.module.css'
import attributeStyles from './attribute-tabs.module.css'
import { folderDisplayColor } from '@/components/shared/folder-dot'
import { formatDate as polishFormatDate } from '@/lib/format'
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value'
import Notice from '@/components/shared/notice'

/** 店のテンプレートと同じ6種類（上のタブ）。 */
export const KIND_TABS: { kind: TemplateKind; label: string; icon: typeof MessageSquare }[] = [
  { kind: 'message', label: 'メッセージ', icon: MessageSquare },
  { kind: 'carousel', label: 'カルーセル', icon: GalleryHorizontalEnd },
  { kind: 'rich_message', label: 'リッチメッセージ', icon: ImageIcon },
  { kind: 'rich_video', label: 'リッチビデオ', icon: ImageIcon },
  { kind: 'question', label: '質問', icon: HelpCircle },
  { kind: 'coupon', label: 'クーポン', icon: Ticket },
  { kind: 'research', label: 'リサーチ', icon: ClipboardList },
]
const KIND_LABEL: Record<TemplateKind, string> = Object.fromEntries(KIND_TABS.map((tab) => [tab.kind, tab.label])) as Record<TemplateKind, string>

/** 種類ごとの言葉（店の同じ機能の一覧と同じ）。 */
const WORDS: Record<TemplateType, { title: string; item: string; create: string; search: string; description: string; column: string }> = {
  template: { title: 'テンプレート', item: 'テンプレート', create: 'テンプレートを作る', search: '名前・本文・差し込みで探す', column: 'テンプレート', description: 'メッセージのひな形を作り、各 LINE アカウントへ配ります。配ったあとに直すと、配った先へ新しい版として届きます。' },
  form: { title: '回答フォーム', item: 'フォーム', create: 'フォームを作る', search: 'フォーム名・質問文', column: 'フォーム（質問の数）', description: '回答フォームのひな形を作り、各 LINE アカウントへ配ります。配ったあとに直すと、新しい版として届きます。' },
  tag: { title: 'タグ', item: 'タグ', create: 'タグを作る', search: 'タグ名・用途で探す', column: 'タグ', description: 'タグ（タグ・入力してもらう項目・対応の印）のひな形を作り、各 LINE アカウントへ配ります。配った先で同じ名前・色で使えます。' },
  rich_menu: { title: 'リッチメニュー', item: 'メニュー', create: 'メニューを作る', search: 'メニュー名・ボタン名', column: 'メニュー（大きさ・ボタン）', description: 'リッチメニューのひな形を作り、各 LINE アカウントへ配ります。配った先では、そのアカウントの条件で出し分けます。' },
  scenario: { title: 'シナリオ', item: 'シナリオ', create: 'シナリオを作る', search: 'シナリオ名で探す', column: 'シナリオ', description: 'シナリオのひな形を作り、停止中の下書きとして各 LINE アカウントへ配ります。' },
}

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/** M月D日（店の一覧と同じ。時刻は title）。 */
function monthDay(iso: string): string {
  return polishFormatDate(iso, { style: 'list-day', fallback: '—' })
}

/**
 * 公開の札（店と同じ3つ：公開中／未公開の変更／下書きだけ。絵 i0Ao0R）。統括では「配ったか」で決める：
 * 配った先がいまの版を持っている＝公開中、直したあと配っていない先がある（API-18 の outdated_account_count）＝未公開の変更、まだ配っていない＝下書きだけ。
 */
export function stateOf(row: HqTemplate): { label: string; tone: 'live' | 'changes' | 'draft' } {
  if ((row.distributed_account_count ?? 0) === 0) return { label: '下書きだけ', tone: 'draft' }
  if ((row.outdated_account_count ?? 0) > 0) return { label: '未公開の変更', tone: 'changes' }
  return { label: '公開中', tone: 'live' }
}

/** 合計（API-18）。1つでも数えていない行があれば null（「—」）。 */
function sumOrNull(values: Array<number | null | undefined>): number | null {
  if (values.some((value) => value == null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

/** 今月送った数（API-18）。取れない種類（別資産のクーポン等）は null＝「—」。0 は「0通」。 */
export function sentLabel(count: number | null | undefined): string {
  return count == null ? emptyValue('unknown') : `${formatNumber(count)}通`
}

export interface HqStoreListProps {
  type: TemplateType
  rows: HqTemplate[]
  ready: boolean
  busy: boolean
  canEdit: boolean
  /** 配る先になるアカウントの数（数の帯の「全 N アカウントのうち」）。 */
  accountTotal: number
  /** 一覧の集計（API-18：今月送った数・新しい版を未配布のひな形の数）。取れなければ null。 */
  stats?: HqTemplateListStats | null
  /** 6種類のタブ（テンプレートだけ）。 */
  kind?: TemplateKind
  kindCounts?: Partial<Record<TemplateKind, number>> | null
  onKindChange?: (kind: TemplateKind) => void
  folders: HqTemplateFolder[]
  folderLoadFailed: boolean
  folderFilter: string
  onFolderFilter: (id: string) => void
  onAddFolder: (name: string, color: string | null) => Promise<void>
  onRenameFolder: (folder: HqTemplateFolder, name: string, color: string | null) => Promise<void>
  onDeleteFolder: (folder: HqTemplateFolder) => Promise<void>
  /** ほかの人が先に直した・消した（409・404）ときにフォルダの一覧を読み直す。 */
  onReloadFolders?: () => Promise<void>
  onCreate: () => void
  onEdit: (row: HqTemplate) => void
  /** 名前を押したとき（詳細 pQ4fH）。無ければ編集を開く。 */
  onOpen?: (row: HqTemplate) => void
  onDistributeFolder?: (id: string, name: string) => void
  /** 全種類を数える。種類タブや検索でフォルダの配布範囲を狭めない。 */
  folderContents?: HqTemplate[] | null
  onDistribute: (row: HqTemplate) => void
  onDuplicate: (row: HqTemplate) => void
  onRemove: (row: HqTemplate) => void
  notices?: ReactNode
  overlays?: ReactNode
}

export default function HqStoreList(props: HqStoreListProps) {
  const {
    type, rows, ready, busy, canEdit, accountTotal, stats, kind, kindCounts, onKindChange, folders, folderLoadFailed, folderFilter, onFolderFilter,
    onAddFolder, onRenameFolder, onDeleteFolder, onReloadFolders, onCreate, onEdit, onOpen, onDistribute, onDistributeFolder, folderContents, onDuplicate, onRemove, notices, overlays,
  } = props
  const words = WORDS[type]
  const [query, setQuery] = useListUrlValue('q', '')
  const [undistributedOnly, setUndistributedOnly] = useListUrlValue('undistributedOnly', false)
  /* タグ（DzdC3）だけ：上のタブ（タグ・友だち情報欄・対応マーク・保存した検索）と、使用状態・付け方の絞り込み。 */
  const attribute = useAttributeTab('/hq/friend-attributes')
  const [tagUsage, setTagUsage] = useState<TagUsageFilter>('all')
  const [tagMethod, setTagMethod] = useState('all')
  const [pageSize, setPageSize] = useListUrlValue('pageSize', 20)
  const [page, setPage] = useListUrlValue('page', 1)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  /* 分類（フォルダ）の窓：足す・名前を変える（統括のひな形の分類は色を持たない）・消す。 */
  const [folderDialog, setFolderDialog] = useState<{ editing: HqTemplateFolder | null } | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState<string | null>(FOLDER_SELECT_COLORS[0].value)
  const [deletingFolder, setDeletingFolder] = useState<HqTemplateFolder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [folderNameError, setFolderNameError] = useState('')
  /* 送る版（revision）はいつも今の一覧から引く。409 で読み直したあとの2回目の保存が新しい版で通る。 */
  const latestFolder = (folder: HqTemplateFolder) => folders.find((f) => f.id === folder.id) ?? folder

  const folderOf = (id: string | null | undefined) => folders.find((folder) => folder.id === id) ?? null
  const countIn = (id: string) => rows.filter((row) => (row.folder_id ?? 'none') === id).length

  const filtered = useMemo(() => {
    const words = query.normalize('NFKC').toLocaleLowerCase('ja-JP').trim()
    return rows.filter((row) => {
      if (folderFilter !== 'all' && (row.folder_id ?? 'none') !== folderFilter) return false
      if (undistributedOnly && (row.distributed_account_count ?? 0) > 0) return false
      if (type === 'tag' && !matchesTagFilters(row, tagUsage, tagMethod)) return false
      if (!words) return true
      return [row.name, row.description ?? '', row.content_summary ?? ''].some((text) => text.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(words))
    })
  }, [rows, folderFilter, undistributedOnly, query, type, tagUsage, tagMethod])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize)

  /*
   * 数の帯（絵 i0Ao0R・wZPua）：ひな形（下書き N件＝まだ配っていない）・配ったアカウント・今月送った数（テンプレートだけ。
   * ほかの種類は配ったひな形）・新しい版を未配布（API-18。直したあと配っていない先があるひな形の数）。
   */
  const distributed = rows.filter((row) => (row.distributed_account_count ?? 0) > 0).length
  const accountNames = new Set(rows.flatMap((row) => row.distributed_account_names ?? []))
  const namesComplete = rows.every((row) => (row.distributed_account_more ?? 0) === 0)
  const outdated = stats ? stats.outdatedTemplateCount : rows.filter((row) => (row.outdated_account_count ?? 0) > 0).length
  const kpis = [
    { key: 'templates', title: 'ひな形', icon: FileText, value: ready ? rows.length : null, unit: '件', detail: ready ? `下書き ${rows.length - distributed}件` : emptyValue('unknown') },
    { key: 'accounts', title: '配ったアカウント', icon: Link2, value: ready && namesComplete ? accountNames.size : null, unit: '件', detail: ready ? (namesComplete ? `全 ${formatNumber(accountTotal)} アカウントのうち` : '数え切れないアカウントがあります') : emptyValue('unknown') },
    type === 'rich_menu'
      ? { key: 'taps', title: '今月押された', icon: Send, value: ready ? sumOrNull(rows.map((row) => row.tap_count)) : null, unit: '回', detail: ready ? '配った先でボタンが押された回数' : emptyValue('unknown') }
      : type === 'tag'
      ? { key: 'friends', title: '付けている友だち', icon: Users, value: ready ? sumOrNull(rows.map((row) => row.friend_count)) : null, unit: '人', detail: ready ? '配った先の合計' : emptyValue('unknown') }
      : type === 'template'
      ? { key: 'sent', title: '今月送った数', icon: Send, value: ready && stats ? stats.thisMonthSentCount : null, unit: '通', detail: ready ? '配った先の合計' : emptyValue('unknown') }
      : { key: 'distributed', title: '配ったひな形', icon: Send, value: ready ? distributed : null, unit: '件', detail: ready ? '1つ以上のアカウントへ配った' : emptyValue('unknown') },
    { key: 'outdated', title: '新しい版を未配布', icon: Users, value: ready ? outdated : null, unit: '件', detail: ready ? '直したあと配っていない' : emptyValue('unknown') },
  ]

  /*
   * タグ（DzdC3）の数の帯：未使用・付けている友だち・（今月付けた回数の代わりに）新しい版を未配布・整理の候補。
   * 今月付けた回数は統括の一覧の受け口に無いので出さない（見た目だけ置かない）。
   */
  const tagKpis = [
    { key: 'unused', title: '未使用', icon: CircleDashed, value: ready ? unusedTagCount(rows) : null, unit: '件', detail: ready ? '配った先で付いている友だちが0人' : emptyValue('unknown') },
    { key: 'friends', title: '付けている友だち', icon: Users, value: ready ? sumOrNull(rows.map((row) => row.friend_count)) : null, unit: '人', detail: ready ? '配った先の合計' : emptyValue('unknown') },
    { key: 'outdated', title: '新しい版を未配布', icon: Send, value: ready ? outdated : null, unit: '件', detail: ready ? '直したあと配っていない' : emptyValue('unknown') },
    { key: 'cleanup', title: '整理の候補', icon: Sparkles, value: ready ? cleanupTagCount(rows) : null, unit: '件', detail: ready ? '未使用・名前が重なっている' : emptyValue('unknown') },
  ]
  const bandKpis = type === 'tag' ? tagKpis : kpis

  const tabs = kind && onKindChange ? (
    <div className={storeStyles.tabsBox}>
      <Tabs
        label={`${words.title}の種類`}
        items={KIND_TABS.map((tab) => ({
          label: tab.label,
          count: kindCounts?.[tab.kind],
          current: kind === tab.kind,
          onClick: () => { onKindChange(tab.kind); setPage(1) },
        }))}
      />
    </div>
  ) : undefined

  const createButton = (full: boolean) => !canEdit ? null : (
    <Button type="button" variant="primary" className={full ? 'v8-folder-create w-full' : undefined} disabled={!ready || busy} onClick={onCreate}>
      <Plus size={15} aria-hidden="true" />{words.create}
    </Button>
  )

  const leadingActions = (id: string, name: string): ActionMenuItem[] | undefined => {
    const contents = folderContents === undefined ? rows : folderContents
    const count = contents?.filter((row) => id === 'none' ? !row.folder_id : row.folder_id === id).length ?? 0
    return canEdit && ready && !busy && type !== 'scenario' && onDistributeFolder && count > 0 ? [{
      id: `${id}-distribute`, label: 'このフォルダを配る', icon: <Send size={14} aria-hidden="true" />, emphasis: true,
      onSelect: () => onDistributeFolder(id, name),
    }] : undefined
  }
  const folderRows: FolderPanelRow[] = [
    { kind: 'all' as const, id: 'all', label: 'すべて', count: ready ? rows.length : null, icon: <Inbox size={15} aria-hidden="true" /> },
    ...folders.map((folder) => ({
      kind: 'folder' as const,
      id: folder.id,
      label: folder.name,
      color: folder.color,
      count: ready ? countIn(folder.id) : null,
      leadingActions: leadingActions(folder.id, folder.name),
      ...(canEdit ? {
        onEdit: () => { setFolderError(''); setFolderNameError(''); setFolderName(folder.name); setFolderColor(folderDisplayColor(folder)); setFolderDialog({ editing: folder }) },
        onDelete: () => { setFolderError(''); setDeletingFolder(folder) },
      } : {}),
    })),
    { kind: 'unfiled' as const, id: 'none', label: '未分類', count: ready ? countIn('none') : null, leadingActions: leadingActions('none', '未分類') },
  ]
  const selectFolder = (id: string) => { onFolderFilter(id); setPage(1) }
  const folderPanel = folderLoadFailed ? (
    <Notice tone="danger" className={storeStyles.folderNoteNoticePlacement} >フォルダを読み込めませんでした。ページを再読み込みしてください。</Notice>
  ) : (
    <FolderPanel
      activeId={folderFilter}
      onSelect={selectFolder}
      onAddFolder={canEdit ? () => { setFolderError(''); setFolderNameError(''); setFolderName(''); setFolderColor(FOLDER_SELECT_COLORS[0].value); setFolderDialog({ editing: null }) } : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      <p className={storeStyles.folderNote}>
        {type === 'template' ? 'フォルダは種類のタブをまたいで使えます。消しても、中のテンプレートは未分類に残ります' : `フォルダを消しても、中の${words.item}は未分類に残ります`}
      </p>
    </FolderPanel>
  )

  const saveFolder = async () => {
    const name = folderName.trim()
    if (!name || folderBusy || !folderDialog) return
    setFolderBusy(true)
    setFolderError('')
    setFolderNameError('')
    try {
      if (folderDialog.editing) await onRenameFolder(latestFolder(folderDialog.editing), name, folderColor)
      else await onAddFolder(name, folderColor)
      setFolderDialog(null)
    } catch (caught) {
      // 理由ごとに言い分ける（共通の describeFolderFailure）。入力した名前と色は残す。
      const failure = describeFolderFailure(caught, 'save')
      if (failure.kind === 'missing') {
        notifyToast(failure.message, { tone: 'error' })
        await onReloadFolders?.().catch(() => undefined)
        setFolderDialog(null)
        return
      }
      if (failure.kind === 'conflict') await onReloadFolders?.().catch(() => undefined)
      if (failure.nameError) setFolderNameError(failure.nameError)
      else setFolderError(failure.message)
    } finally {
      setFolderBusy(false)
    }
  }
  const removeFolder = async () => {
    if (!deletingFolder || folderBusy) return
    setFolderBusy(true)
    setFolderError('')
    try {
      await onDeleteFolder(latestFolder(deletingFolder))
      setDeletingFolder(null)
    } catch (caught) {
      const failure = describeFolderFailure(caught, 'delete')
      if (failure.kind === 'missing') {
        notifyToast(failure.message, { tone: 'error' })
        await onReloadFolders?.().catch(() => undefined)
        setDeletingFolder(null)
        return
      }
      if (failure.kind === 'conflict') await onReloadFolders?.().catch(() => undefined)
      setFolderError(failure.message)
    } finally {
      setFolderBusy(false)
    }
  }

  const rowMenu = (row: HqTemplate): ActionMenuItem[] => [
    { id: 'distribute', label: '配る', icon: <Send size={14} aria-hidden="true" />, onSelect: () => onDistribute(row) },
    { id: 'edit', label: '編集する', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => onEdit(row) },
    { id: 'duplicate', label: '複製する', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => onDuplicate(row) },
    { id: 'remove', label: '削除する', icon: <Trash2 size={14} aria-hidden="true" />, tone: 'danger', dividerBefore: true, onSelect: () => onRemove(row) },
  ]

  const toolbar = (
    <div className={type === 'tag' ? `${storeStyles.wideTools} ${attributeStyles.tagTools}` : storeStyles.wideTools}>
      <ListToolbar
        search={{ placeholder: words.search, label: `${words.title}のひな形を検索`, value: query, onChange: (value) => { setQuery(value); setPage(1) } }}
        filters={(
          <>
          {type === 'tag' ? (
            <>
              <Select aria-label="使用状態で絞り込む" width={145} value={tagUsage} onChange={(value) => { setTagUsage(value as TagUsageFilter); setPage(1) }} options={[
                { value: 'all', label: '使用状態：すべて' },
                { value: 'used', label: '使用状態：付いている' },
                { value: 'unused', label: '使用状態：未使用' },
              ]} />
              <Select aria-label="付け方で絞り込む" width={132} value={tagMethod} onChange={(value) => { setTagMethod(value); setPage(1) }} options={[
                { value: 'all', label: '付け方：すべて' },
                ...assignmentMethods(rows).map((method) => ({ value: method, label: `付け方：${method}` })),
              ]} />
            </>
          ) : null}
          <div role="group" aria-label="配ったかで絞り込む" className={storeStyles.chipGroup}>
            <FilterChip selected={undistributedOnly} onChange={() => { setUndistributedOnly((value) => !value); setPage(1) }} title="まだどのアカウントへも配っていないひな形" icon={<Unlink size={13} aria-hidden="true" />}>
              未配布
            </FilterChip>
          </div>
          </>
        )}
        trailing={(
          <div className={storeStyles.perPageBox}>
            <Select aria-label="1ページに出す件数" size="page-size" value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1) }} options={PAGE_SIZE_OPTIONS} />
          </div>
        )}
      />
    </div>
  )

  /*
   * 種類ごとの列（店の同じ機能の一覧と同じ並び）。違いは「配布先」の列だけ。
   *   テンプレート i0Ao0R：種類・公開・配布先・今月送った数・更新・［配る］・「…」
   *   タグ DzdC3：人数・付け方・配布先・［配る］・「…」（人数は API-18 の配った先で付いている友だちの合計）
   *   リッチメニュー noVq4：順・誰に出すか・状態・配布先・今月押された・［配る］・「…」（API-18 の順・誰に出すか・配った先の押された数）
   *   回答フォーム wZPua：状態・配布先・更新・［配る］・「…」
   * ［配る］の列は見出しが空の幅60（絵の「列 配る」）、「…」との間は 16。閲覧のみ（配れない人）には列ごと出さない。
   */
  const rankOf = new Map(type === 'rich_menu'
    ? [...rows].sort((a, b) => (a.display_order ?? Number.MAX_SAFE_INTEGER) - (b.display_order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'ja')).map((row, index) => [row.id, index + 1] as const)
    : [])
  const ordered = type === 'rich_menu' ? [...shown].sort((a, b) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0)) : shown
  const destCell = (row: HqTemplate) => {
    const destLine = distributedAccountsLine(row)
    return row.distributed_account_count === undefined ? (
      <span className={storeStyles.cellFaint}>{emptyValue('unknown')}</span>
    ) : row.distributed_account_count > 0 ? (
      <span className={storeStyles.hqDest}>
        <span className={storeStyles.usageLink}>{`${formatNumber(row.distributed_account_count)} アカウント`}</span>
        {destLine ? <span className={storeStyles.cellSub} title={destLine}>{destLine}</span> : null}
      </span>
    ) : (
      <span className={storeStyles.usageLink}>まだ配っていない</span>
    )
  }
  const stateCell = (row: HqTemplate) => {
    const state = stateOf(row)
    return (
      <span className={storeStyles.publishPill} data-tone={state.tone}>
        <span className={storeStyles.publishDot} aria-hidden="true" />
        {state.label}
      </span>
    )
  }
  /* 列の幅（col）と中身の箱（Td）は列ごとに書く（className を変数で渡すと見張りが読めない）。 */
  type Column = { key: string; head: string; col: ReactNode; cell: (row: HqTemplate) => ReactNode }
  const plainTd = (key: string, text: ReactNode, title?: string) => <Td key={key} className={storeStyles.cellPlain} title={title}>{text}</Td>
  const boxedTd = (key: string, inner: ReactNode) => <Td key={key}>{inner}</Td>
  const columns: Column[] = type === 'template' ? [
    { key: 'kind', head: '種類', col: <col key="kind" className={storeStyles.colKind} />, cell: (row) => boxedTd('kind', <span className={storeStyles.kindBadge}>{KIND_LABEL[(row.kind ?? 'message') as TemplateKind] ?? 'メッセージ'}</span>) },
    { key: 'state', head: '公開', col: <col key="state" className={storeStyles.colPublish} />, cell: (row) => boxedTd('state', stateCell(row)) },
    { key: 'dest', head: '配布先', col: <col key="dest" className={storeStyles.colUsage} />, cell: (row) => boxedTd('dest', destCell(row)) },
    { key: 'sent', head: '今月送った数', col: <col key="sent" className={storeStyles.colMonthly} />, cell: (row) => plainTd('sent', sentLabel(row.this_month_sent_count), row.this_month_sent_count == null ? '今月送った数は、この種類では数えていません' : undefined) },
    { key: 'updated', head: '更新', col: <col key="updated" className={storeStyles.colUpdated} />, cell: (row) => plainTd('updated', monthDay(row.updated_at), row.updated_at) },
  ] : type === 'tag' ? [
    { key: 'friends', head: '人数', col: <col key="friends" className={storeStyles.colKind} />, cell: (row) => plainTd('friends', row.friend_count == null ? emptyValue('unknown') : `${formatNumber(row.friend_count)}人`, '配った先のアカウントで、このタグが付いている友だちの合計') },
    { key: 'method', head: '付け方', col: <col key="method" className={storeStyles.colKind} />, cell: (row) => plainTd('method', row.assignment_method ?? emptyValue('unknown')) },
    { key: 'dest', head: '配布先', col: <col key="dest" className={storeStyles.colHqDest} />, cell: (row) => boxedTd('dest', destCell(row)) },
  ] : type === 'rich_menu' ? [
    { key: 'audience', head: '誰に出すか', col: <col key="audience" className={storeStyles.colPublish} />, cell: (row) => plainTd('audience', row.display_audience ?? emptyValue('unknown'), row.display_audience ?? undefined) },
    { key: 'state', head: '状態', col: <col key="state" className={storeStyles.colPublish} />, cell: (row) => boxedTd('state', stateCell(row)) },
    { key: 'dest', head: '配布先', col: <col key="dest" className={storeStyles.colUsage} />, cell: (row) => boxedTd('dest', destCell(row)) },
    { key: 'taps', head: '今月押された', col: <col key="taps" className={storeStyles.colMonthly} />, cell: (row) => plainTd('taps', row.tap_count == null ? emptyValue('unknown') : `${formatNumber(row.tap_count)}回`, '配った先のアカウントで押された回数の合計') },
  ] : type === 'form' ? [
    { key: 'storage', head: '保存先', col: <col key="storage" className={hqStyles.colFormStorage} />, cell: () => plainTd('storage', '—', '保存先の情報は未取得です') },
    { key: 'state', head: '状態', col: <col key="state" className={hqStyles.colFormState} />, cell: (row) => boxedTd('state', stateCell(row)) },
    { key: 'dest', head: '配布先', col: <col key="dest" className={hqStyles.colFormDest} />, cell: (row) => boxedTd('dest', destCell(row)) },
  ] : [
    { key: 'state', head: '状態', col: <col key="state" className={storeStyles.colPublish} />, cell: (row) => boxedTd('state', stateCell(row)) },
    { key: 'dest', head: '配布先', col: <col key="dest" className={storeStyles.colHqDest} />, cell: (row) => boxedTd('dest', destCell(row)) },
    { key: 'updated', head: '更新', col: <col key="updated" className={storeStyles.colUpdated} />, cell: (row) => plainTd('updated', monthDay(row.updated_at), row.updated_at) },
  ]
  const body = !ready ? (
    <div className={storeStyles.stateCard} role="status">
      <p className={storeStyles.stateTitle}>{busy ? 'ひな形を読み込み中…' : '読み込めませんでした。権限や接続を確認し、ページを再読み込みしてください。'}</p>
    </div>
  ) : filtered.length === 0 ? (
    <EmptyList
      icon={<FileText aria-hidden="true" />}
      title={`まだ${words.item}のひな形がありません`}
      description="ひな形を作ると、ここから各 LINE アカウントへ配れます。"
      create={{ label: `最初の${words.item}を作る`, onClick: onCreate }}
      canCreate={canEdit}
      filtered={Boolean(query || undistributedOnly || folderFilter !== 'all' || tagUsage !== 'all' || tagMethod !== 'all')}
      onClearFilters={() => { setQuery(''); setUndistributedOnly(false); setTagUsage('all'); setTagMethod('all'); onFolderFilter('all'); setPage(1) }}
      filteredDescription="検索や「未配布」・フォルダを外すと、すべて出ます"
    />
  ) : (
    <div className={`${storeStyles.tableWrap} ${storeStyles.hqTable}`}>
      <DataTable>
        <colgroup>
          {type === 'rich_menu' ? <col className={storeStyles.colSelect} /> : null}
          <col />
          {columns.map((column) => column.col)}
          {canEdit ? <col className={storeStyles.colHqDistribute} /> : null}
          <col className={storeStyles.colMenu} />
        </colgroup>
        <thead>
          <TableHeadRow>
            {type === 'rich_menu' ? <Th className={storeStyles.headCell}>順</Th> : null}
            <Th className={storeStyles.headCell}>{words.column}</Th>
            {columns.map((column) => <Th key={column.key} className={storeStyles.headCell}>{column.head}</Th>)}
            {canEdit ? <Th aria-label="配る" /> : null}
            <Th aria-label="操作" />
          </TableHeadRow>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const folder = folderOf(row.folder_id)
            const sub = templateSubLine(row, KIND_LABEL[(row.kind ?? 'message') as TemplateKind] ?? words.item)
            return (
              <Tr key={row.id} data-row-id={row.id} density="template">
                {type === 'rich_menu' ? <Td className={storeStyles.cellPlain}>{rankOf.get(row.id) ?? emptyValue('unknown')}</Td> : null}
                <NameCell
                  name={(
                    <div className={storeStyles.dotLine}>
                      {type === 'tag' ? (
                        canEdit ? <button type="button" className={`${storeStyles.cellTitle} ${hqStyles.hqNameButton}`} title={row.name} onClick={() => (onOpen ?? onEdit)(row)}>
                          <TagPill name={row.name} color={folder ? folderDisplayColor(folder) : null} size="sm" />
                        </button> : <TagPill name={row.name} color={folder ? folderDisplayColor(folder) : null} size="sm" />
                      ) : <FolderDotName folder={folder ? { name: folder.name, color: folder.color } : null}>
                        {canEdit ? (
                          <button type="button" className={`${storeStyles.cellTitle} ${hqStyles.hqNameButton}`} title={row.name} onClick={() => (onOpen ?? onEdit)(row)}>{row.name}</button>
                        ) : <span className={storeStyles.cellTitle} ><TruncatedText value={String(row.name ?? '')} /></span>}
                      </FolderDotName>}
                    </div>
                  )}
                  sub={<span className={`${storeStyles.cellSub} ${storeStyles.dotIndent}`} title={sub}>{sub}</span>}
                />
                {columns.map((column) => column.cell(row))}
                {canEdit ? (
                  <Td className={`${storeStyles.menuCell} ${storeStyles.hqDistributeCell}`}>
                    <div className={storeStyles.menuBox}>
                      <RowQuickAction label="配る" ariaLabel={`${row.name}を配る`} icon={<Send aria-hidden="true" />} disabled={busy} onClick={() => onDistribute(row)} />
                    </div>
                  </Td>
                ) : null}
                <Td className={storeStyles.menuCell}>
                  <div className={`${storeStyles.menuBox} ${storeStyles.hqActions}`}>
                    {canEdit ? (
                      <RowMenu label={`${words.item}「${row.name}」の操作`} items={rowMenu(row)} size="row" open={openMenuId === row.id} onOpenChange={(next) => setOpenMenuId(next ? row.id : null)} />
                    ) : null}
                  </div>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const summary = `${formatNumber(filtered.length)} 件中 ${(current - 1) * pageSize + 1}〜${Math.min(current * pageSize, filtered.length)} 件`
  const pager = !ready || filtered.length === 0 ? null : pageCount > 1 ? (
    <Pagination page={current} pageCount={pageCount} onPageChange={setPage} summary={<span className={storeStyles.pagerCount}>{summary}</span>} />
  ) : <p className={storeStyles.pagerSolo}>{summary}</p>

  if (type === 'tag' && attribute.tab !== 'tags') {
    return <OtherTabPanel tab={attribute.tab} title={words.title} description={words.description} onSelect={(key) => { attribute.select(key); setPage(1) }} />
  }

  return (
    <ListPage
      boardId={type === 'template' ? 'i0Ao0R' : type === 'form' ? 'wZPua' : type === 'tag' ? 'DzdC3' : type === 'rich_menu' ? 'noVq4' : 'LRc93'}
      headingSize="regular"
      title={words.title}
      help={words.description}
      tabs={type === 'tag' ? <AttributeTabs tab={attribute.tab} onSelect={(key) => { attribute.select(key); setPage(1) }} /> : tabs}
      stats={(
        <KpiBand data-design="KPIs" className={storeStyles.kpiStrip}>
          {bandKpis.map((kpi) => (
            <KpiCard key={kpi.key} presentation="band" title={kpi.title} icon={<kpi.icon size={13} aria-hidden="true" />} value={kpi.value} unit={kpi.value == null ? '' : kpi.unit} detail={<span className={storeStyles.kpiDetailWrap}>{kpi.detail}</span>} />
          ))}
        </KpiBand>
      )}
      folderNav={{ rows: folderRows, activeId: folderFilter, onSelect: selectFolder, createAction: createButton(false) ?? undefined }}
      folders={<>{createButton(true) ?? <span className={storeStyles.viewerCreateSpace} aria-hidden="true" />}{folderPanel}</>}
      toolbar={toolbar}
      pagination={pager}
      overlays={(
        <>
          {overlays}
          <FolderEditorDialog
            name={folderName} onNameChange={(next) => { setFolderName(next); setFolderNameError('') }} color={folderColor} onColorChange={setFolderColor}
            nameError={folderNameError || undefined}
            open={folderDialog !== null}
            title={folderDialog?.editing ? 'フォルダを直す' : 'フォルダを追加'}
            description={`${words.item}のひな形を分けてしまう箱です。消しても、中のひな形は未分類に残ります。`}
            busy={folderBusy}
            error={folderError || undefined}
            confirmLabel={folderDialog?.editing ? '保存する' : '追加する'}
            cancelLabel="やめる"
            onCancel={() => { if (!folderBusy) setFolderDialog(null) }}
            onConfirm={() => saveFolder()}
          />
          <ConfirmDialog
            open={deletingFolder !== null}
            title={`フォルダ「${deletingFolder?.name ?? ''}」を消しますか？`}
            description={deleteFolderDescription(`${words.item}のひな形`, deletingFolder ? countIn(deletingFolder.id) : null)}
            confirmLabel="フォルダを消す"
            cancelLabel="キャンセル"
            destructive
            busy={folderBusy}
            error={folderError || undefined}
            onCancel={() => { if (!folderBusy) setDeletingFolder(null) }}
            onConfirm={() => removeFolder()}
          />
        </>
      )}
    >
      {notices}
      {body}
    </ListPage>
  )
}
