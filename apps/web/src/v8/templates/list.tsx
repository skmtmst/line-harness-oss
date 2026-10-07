'use client'

/*
 * ★V8 テンプレートの一覧（Pencil「★V8 画面の地図」のテンプレートの行）。
 * 一覧 `v19Ivv`・1152 `L7zA7C`・閲覧のみ `hEDTK`・削除の確認 `V6JFnd`・
 * 削除できない `Z0g3si`・作る種類を選ぶ `R9XUMr`・状態の板 `susGP`。
 *
 * 動き（呼ぶ API・権限・失敗の扱い・URL の指定）は今までの V8 一覧
 * （app/templates/list-v8.tsx）と同じ。見た目だけを型（ListPage）と部品で組み直した。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useListScrollMemory, useListUrlState, useOnAccountSwitch } from '@/components/shared/list-url-state'
import { runOptimistic } from '@/lib/undoable'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bookmark,
  Braces,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  Folder as FolderIcon,
  GalleryHorizontalEnd,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Link2,
  List,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Send,
  SquareArrowOutUpRight,
  Ticket,
  Trash2,
  TriangleAlert,
  Unlink,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, type BroadcastAssetKind, type TemplateQuestion } from '@/lib/api'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatDateTime, formatNumber } from '@/lib/format'
import { contentExcerpt } from '@/lib/broadcast-summary'
import { ListPage } from '@/components/templates'
import { notifyToast } from '@/components/shared/toast'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import IconButton from '@/components/shared/icon-button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import ListToolbar from '@/components/shared/list-toolbar'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Notice from '@/components/shared/notice'
import { DataTable, TableHeadRow, Th, Tr, Td, NameCell } from '@/components/shared/table'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDotName, type FolderDotFolder } from '@/components/shared/folder-dot'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { exampleHref, loadTemplateExamples, type TemplateExample } from './examples'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import DetailPanel, { useDetailPanelUrl } from '@/components/shared/detail-panel'
import InlineEdit from '@/components/shared/inline-edit'
import ContextMenu, { type ContextMenuItem } from '@/components/shared/context-menu'
import { withViewTransition } from '@/components/shared/view-transition'
import { Tabs } from '@/components/shared/tabs'
import BroadcastAssetManager from '@/components/broadcasts/broadcast-asset-manager'
import StaffAssetList from './staff-asset-list'
import { RovingTbody } from '@/components/shared/row-roving'
import { useEscapeToClearSelection } from '@/components/shared/bulk-bar'
import { useDeferredDelete } from '@/lib/use-deferred-delete'
import {
  DELETE_UNUSED_DESCRIPTION,
  blockedDeleteDescription,
  createBlockedReason,
  failureOf,
  failureOfResponse,
  listView,
  messageTypeText,
  usageRows,
  type TemplatesFailure,
  type UsageDetail,
} from './words'
import styles from './list.module.css'

/** 一覧のタブ。message/question は同じテンプレートの束を中身で分ける。 */
type Section = 'message' | 'question' | BroadcastAssetKind

/** 絞り込み札。独立に切り替える（1通のみと複数通だけは片方）。 */
type ChipKey = 'single' | 'multiple' | 'variables' | 'unused'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  /** 最新の下書き本文。公開版だけのときは null。 */
  draftMessageContent?: string | null
  /** 置き場。未分類は null。 */
  folderId: string | null
  question: TemplateQuestion | null
  questionStatus: 'draft' | 'published'
  usageCount: number
  tapCount: number
  monthlySendCount: number | null
  totalSendCount: number | null
  /** 公開待ちの下書きがあるか。 */
  hasDraft?: boolean
  /** 最後に公開した日時。未公開は null。 */
  publishedAt?: string | null
  createdAt: string
  updatedAt: string
}

interface PendingDelete {
  item: Template
  /** 削除対象を選んだ時点のアカウント。切替後に古い対象を消さないために固定する。 */
  accountId: string | null
}

/** 「よく使う絞り込み」。一覧の手元のデータで数えられるものだけ。 */
const SAVED_FILTER_OPTIONS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'used', label: '使っている所がある' },
  { value: 'draft-changes', label: '未公開の変更あり' },
  { value: 'draft-only', label: '下書きだけ' },
]

/** 表示件数（決まり：ページ送りのある一覧は 10・20・50 件）。 */
const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10件表示' },
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
]

/** 削除できない窓に並べる行の数（残りは「ほか N か所」）。 */
const BLOCKED_ROWS_SHOWN = 2

/** 種類を選ぶ窓（`R9XUMr`）の6枚のカード。行き先は今ある作る画面のまま。 */
const KIND_CARDS: Array<{
  key: string
  title: string
  icon: typeof MessageSquare
  desc: string
  useFor: string
  cannot: string
  href: string
}> = [
  { key: 'message', title: 'メッセージ', icon: MessageSquare, desc: 'テキスト・カード型・画像。差し込みも使える', useFor: 'いちばんよく使う', cannot: 'できない：答えを集める（→ 質問・リサーチ）', href: '/templates/edit' },
  { key: 'card_message', title: 'カルーセル', icon: GalleryHorizontalEnd, desc: '横にめくるカードを最大10枚', useFor: '商品の紹介に', cannot: 'できない：1枚の画像を面に分ける（→ リッチ）', href: '/templates/carousel' },
  { key: 'rich_message', title: 'リッチメッセージ', icon: ImageIcon, desc: '1枚の画像を面に分けて、押すと動く', useFor: 'キャンペーンの告知に', cannot: 'できない：文字だけの本文（→ メッセージ）', href: '/templates/edit?kind=rich_message' },
  { key: 'question', title: '質問', icon: HelpCircle, desc: 'ボタンで答えてもらい、答えでタグなどを付ける', useFor: '好みを聞くときに', cannot: 'できない：何問も続けて聞く（→ リサーチ）', href: '/templates/questions/new' },
  { key: 'coupon', title: 'クーポン', icon: Ticket, desc: '期間・回数・抽選を決めて配る', useFor: '来店・購入のきっかけに', cannot: 'できない：本文を自由に組む（→ メッセージ）', href: '/templates/edit?kind=coupon' },
  { key: 'research', title: 'リサーチ', icon: ClipboardList, desc: 'いくつかの質問にまとめて答えてもらう', useFor: '満足度の調査に', cannot: 'できない：答えですぐタグを付ける（→ 質問）', href: '/templates/edit?kind=research' },
]

/** 検索欄と検索対象を、大小文字・全半角・空白の違いで外れない形へそろえる。 */
function normalizeTemplateSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim().replace(/\s+/gu, ' ')
}

/** M月D日（絵 v19Ivv は曜日を書かない）。時刻は title で見せる。 */
function formatMonthDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' }).format(date)
}

/** 一覧・検索は「いまの最新」を対象にする（下書きがあれば下書き）。 */
function latestContentOf(t: Template): string {
  return t.draftMessageContent ?? t.messageContent
}

/** 一覧の本文の抜粋。テキスト以外は中身が JSON なので見て分かる1行にする（画像は「画像 1枚」）。 */
function excerptOf(t: Template): string {
  if (t.messageType === 'image') return '画像 1枚'
  return contentExcerpt(t.messageType, latestContentOf(t), 60)
}

/** 今月送った数。数えられていないもの・一度も公開していない（送れない）ものは「—」（絵 v19Ivv の下書きだけの行）。 */
function sendCountText(t: Template): string {
  if (typeof t.monthlySendCount !== 'number') return '—'
  if (t.publishedAt == null && t.monthlySendCount === 0) return '—'
  return `${formatNumber(t.monthlySendCount)}通`
}

/** 公開の札（`v19Ivv`：公開中／未公開の変更／下書きだけ）。 */
function publishStateOf(t: Template): { label: string; tone: 'live' | 'changes' | 'draft' } {
  if (t.publishedAt == null) return { label: '下書きだけ', tone: 'draft' }
  if (t.hasDraft) return { label: '未公開の変更', tone: 'changes' }
  return { label: '公開中', tone: 'live' }
}

export default function TemplatesListV8() {
  usePageTitle('テンプレート')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  /*
   * 作成・編集・公開・削除は API が owner/admin で閉じている。
   * それ以外の人には押せない形で出す（閲覧は残す）。
   */
  const [localCanMutate] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  /* 役割はサーバ（/api/staff/me）で確かめる。答えが来るまでは手元の値で決める。 */
  const staffRole = useStaffRole()
  const canMutateTemplates = staffRole === null ? localCanMutate : canManageRole(staffRole)
  /* 1152 の板（`L7zA7C`）。フォルダの列は型が畳み、道具の段を2段にする。 */
  const narrow = useNarrowViewport()

  const [activeSection, setActiveSection] = useState<Section>('message')
  const [templates, setTemplates] = useState<Template[]>([])
  const [assetCounts, setAssetCounts] = useState<Partial<Record<BroadcastAssetKind, number>>>({})
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<TemplatesFailure | null>(null)
  /*
   * 検索語・フォルダ・札・絞り込み・件数・ページは URL に置く（動きの点検 5 番）。
   * テンプレートを開いて「戻る」と同じ一覧に戻る。
   */
  const [urlView, setUrlView] = useListUrlState({ q: '', folder: 'all', chips: '', view: '', size: '20', page: '1' })
  const templateQuery = urlView.q
  const setTemplateQuery = useCallback((next: string) => setUrlView({ q: next, page: '1' }), [setUrlView])
  const chips = useMemo<Record<ChipKey, boolean>>(() => {
    const on = new Set(urlView.chips ? urlView.chips.split(',') : [])
    return { single: on.has('single'), multiple: on.has('multiple'), variables: on.has('variables'), unused: on.has('unused') }
  }, [urlView.chips])
  const setChips = useCallback((update: Record<ChipKey, boolean> | ((current: Record<ChipKey, boolean>) => Record<ChipKey, boolean>)) => {
    const next = typeof update === 'function' ? update(chips) : update
    setUrlView({ chips: (Object.keys(next) as ChipKey[]).filter((key) => next[key]).join(','), page: '1' })
  }, [chips, setUrlView])
  const savedFilter = urlView.view
  const setSavedFilter = useCallback((update: string | ((current: string) => string)) => {
    setUrlView({ view: typeof update === 'function' ? update(savedFilter) : update, page: '1' })
  }, [savedFilter, setUrlView])
  const selectedCategory = urlView.folder
  const setSelectedCategory = useCallback((next: string) => setUrlView({ folder: next, page: '1' }), [setUrlView])
  const pageSize = [10, 20, 50].includes(Number(urlView.size)) ? Number(urlView.size) : 20
  const setPageSize = useCallback((next: number) => setUrlView({ size: String(next), page: '1' }), [setUrlView])
  const page = Math.max(1, Number.parseInt(urlView.page, 10) || 1)
  const setPage = useCallback((next: number) => setUrlView({ page: String(next) }), [setUrlView])

  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderError, setFolderError] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  /* 見本から作る（F-5）。窓を初めて開いたときに1回だけ読む。読めなければ段を出さない。 */
  const [examples, setExamples] = useState<TemplateExample[] | null>(null)
  const examplesRequested = useRef(false)
  useEffect(() => {
    if (!pickerOpen || examplesRequested.current) return
    examplesRequested.current = true
    let cancelled = false
    loadTemplateExamples()
      .then((items) => { if (!cancelled) setExamples(items) })
      .catch(() => {
        examplesRequested.current = false
        if (!cancelled) setExamples([])
      })
    return () => { cancelled = true }
  }, [pickerOpen])
  const [savedMenuOpen, setSavedMenuOpen] = useState(false)
  const savedAnchorRef = useRef<HTMLElement | null>(null)

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  /** 使っている所があるので削除できない窓（`Z0g3si`）。中身は usage 口で取る。 */
  const [blockedDelete, setBlockedDelete] = useState<PendingDelete | null>(null)
  const [blockedUsage, setBlockedUsage] = useState<UsageDetail | null>(null)
  const [blockedLoading, setBlockedLoading] = useState(false)
  const [blockedLoadError, setBlockedLoadError] = useState(false)

  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [moveDraft, setMoveDraft] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  /* 右から出る詳細パネル。URL（?row=）に今の行を残す。 */
  const [activeId, setActiveId] = useDetailPanelUrl('row')
  /* パネルを開いている1件の移動は、窓ではなくパネルの中で選ぶ。 */
  const [panelMove, setPanelMove] = useState(false)
  /* 右クリックされた行（「…」と同じ項目を出す）。 */
  const [contextId, setContextId] = useState<string | null>(null)

  const [duplicateTarget, setDuplicateTarget] = useState<Template | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')

  /** まとめて削除の確認。対象は「使っていない」ものだけ。 */
  const [pendingBulkDelete, setPendingBulkDelete] = useState<Template[] | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState('')

  const activeAccountRef = useRef<string | null>(selectedAccountId)
  const loadGenerationRef = useRef(0)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    // フォルダはアカウント単位。切り替えたら前のアカウントの帯も選択も残さない。
    setFolders([])
    setUnfiledCount(null)
    setFolderDialogOpen(false)
    setEditingFolder(null)
    setDeletingFolder(null)
    setFolderError('')
    setPendingDelete(null)
    setBlockedDelete(null)
    setBlockedUsage(null)
    setPendingBulkDelete(null)
    setMoveIds(null)
    setDuplicateTarget(null)
    setOpenMenuId(null)
    setSelectedIds(new Set())
  }, [selectedAccountId])
  // アカウントを替えたらフォルダとページを戻す（来た瞬間は URL のまま）。
  useOnAccountSwitch(selectedAccountId, () => setUrlView({ folder: 'all', page: '1' }))

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setTemplates([])
      setFailure(null)
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setLoading(true)
    setFailure(null)
    // アカウントを切り替えたとき、前のアカウントの行を残さない。
    setTemplates([])
    try {
      const res = await api.templates.list(undefined, accountId)
      if (activeAccountRef.current !== accountId || requestGeneration !== loadGenerationRef.current) return
      if (res.success) setTemplates(res.data as Template[])
      else setFailure(failureOfResponse())
    } catch (e) {
      if (activeAccountRef.current === accountId && requestGeneration === loadGenerationRef.current) {
        // 権限不足を「読み込めませんでした」に混ぜない。
        setFailure(failureOf(e))
      }
    } finally {
      if (activeAccountRef.current === accountId && requestGeneration === loadGenerationRef.current) {
        setLoading(false)
      }
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  /* 種類タブの件数は集計専用の口で取る。 */
  const loadAssetCounts = useCallback(async () => {
    const accountId = selectedAccountId
    if (!accountId) {
      setAssetCounts({})
      return
    }
    try {
      const result = await api.broadcastMessageAssets.counts({ accountId })
      if (activeAccountRef.current !== accountId) return
      if (result.success) setAssetCounts(result.data)
    } catch {
      /* 件数が取れなくても一覧は出す。黙って古い件数のままにする。 */
    }
  }, [selectedAccountId])

  useEffect(() => { void loadAssetCounts() }, [loadAssetCounts])

  /** フォルダを読み直す。並び順は API の displayOrder に従う。 */
  const loadFolders = useCallback(async () => {
    if (!selectedAccountId) {
      setFolders([])
      setUnfiledCount(null)
      return
    }
    const accountId = selectedAccountId
    setFolderError('')
    try {
      const res = await api.folders.list('template', accountId)
      if (activeAccountRef.current !== accountId) return
      if (res.success) {
        setFolders(res.data)
        setUnfiledCount(res.unfiledCount ?? null)
      } else setFolderError('フォルダを読み込めませんでした。')
    } catch {
      if (activeAccountRef.current === accountId) setFolderError('フォルダを読み込めませんでした。')
    }
  }, [selectedAccountId])

  useEffect(() => { void loadFolders() }, [loadFolders])

  /** 削除できない窓を開いたとき、使っている所の明細を取る。 */
  useEffect(() => {
    if (!blockedDelete) {
      setBlockedUsage(null)
      setBlockedLoadError(false)
      setBlockedLoading(false)
      return
    }
    let cancelled = false
    setBlockedLoading(true)
    setBlockedLoadError(false)
    api.templates.usages(blockedDelete.item.id).then((res) => {
      if (cancelled) return
      if (res.success && res.data) setBlockedUsage(res.data as UsageDetail)
      else setBlockedLoadError(true)
    }).catch(() => {
      if (!cancelled) setBlockedLoadError(true)
    }).finally(() => {
      if (!cancelled) setBlockedLoading(false)
    })
    return () => { cancelled = true }
  }, [blockedDelete])

  /* ===== 絞り込み ===== */
  const tabItems = useMemo(
    () => templates.filter((t) => (activeSection === 'question' ? Boolean(t.question) : !t.question)),
    [templates, activeSection],
  )

  /* 本文は長いので、templates が替わったときだけ検索索引を作る。 */
  const templateSearchIndex = useMemo(() => tabItems.map((template) => ({
    template,
    normalizedSearchText: [template.name, template.messageContent, template.draftMessageContent ?? '']
      .map(normalizeTemplateSearchText)
      .join('\0'),
  })), [tabItems])
  const normalizedTemplateQuery = useMemo(() => normalizeTemplateSearchText(templateQuery), [templateQuery])

  // 使われていないテンプレートは窓なしで消し、5秒は「元に戻す」で取り消せる（動きの点検 17 番）。
  const deferredDelete = useDeferredDelete()
  const filteredTemplates = useMemo(() => templateSearchIndex.flatMap(({ template: t, normalizedSearchText }) => {
    if (normalizedTemplateQuery && !normalizedSearchText.includes(normalizedTemplateQuery)) return []
    /* フォルダで絞る。`category` の文字列ではなく `folderId` で見る。 */
    if (selectedCategory === 'unfiled' && t.folderId !== null) return []
    if (selectedCategory !== 'all' && selectedCategory !== 'unfiled' && t.folderId !== selectedCategory) return []
    if (chips.unused && t.usageCount !== 0) return []
    if (chips.single && (t.question !== null || t.messageType === 'carousel')) return []
    const content = latestContentOf(t)
    if (chips.multiple && t.messageType !== 'carousel' && !content.includes('\n\n')) return []
    if (chips.variables && !content.includes('{{')) return []
    if (savedFilter === 'used' && !(t.usageCount > 0)) return []
    if (savedFilter === 'draft-changes' && !(t.hasDraft && t.publishedAt != null)) return []
    if (savedFilter === 'draft-only' && t.publishedAt != null) return []
    // 消して「元に戻す」を待っている行は出さない。
    if (deferredDelete.isHidden(t.id)) return []
    return [t]
  }), [normalizedTemplateQuery, selectedCategory, templateSearchIndex, chips, savedFilter, deferredDelete])

  const filterActive = Boolean(
    normalizedTemplateQuery
      || selectedCategory !== 'all'
      || chips.single
      || chips.multiple
      || chips.variables
      || chips.unused
      || savedFilter,
  )
  const clearFilters = () => {
    setUrlView({ q: '', folder: 'all', chips: '', view: '', page: '1' })
  }

  const toggleChip = (key: ChipKey) => {
    setChips((current) => {
      const next = { ...current, [key]: !current[key] }
      // 「1通のみ」と「複数通」は同時に選べない。
      if (key === 'single' && next.single) next.multiple = false
      if (key === 'multiple' && next.multiple) next.single = false
      return next
    })
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filteredTemplates.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const shownItems = filteredTemplates.slice((safePage - 1) * pageSize, safePage * pageSize)

  // 絞り込みや件数の変更でページが溢れたら戻す。
  // 読み終わってから。読み込み中（0件）に詰めると、URL から戻したページが 1 になる。
  useEffect(() => {
    if (!loading && page > pageCount) setPage(pageCount)
  }, [loading, page, pageCount, setPage])
  useListScrollMemory(!loading)

  const view = listView({ loading, failure, total: tabItems.length, matched: filteredTemplates.length })
  const createBlocked = createBlockedReason({ loading, failure })

  /* ===== 数の帯（このタブのテンプレートから） ===== */
  const ready = view === 'ready' || view === 'empty' || view === 'no-match'
  const draftChanges = tabItems.filter((t) => t.hasDraft && t.publishedAt != null).length
  const usageAllKnown = tabItems.every((t) => typeof t.usageCount === 'number')
  const usageTotal = usageAllKnown ? tabItems.reduce((sum, t) => sum + t.usageCount, 0) : null
  const monthlyAllKnown = tabItems.every((t) => typeof t.monthlySendCount === 'number')
  const monthlyTotal = monthlyAllKnown ? tabItems.reduce((sum, t) => sum + (t.monthlySendCount ?? 0), 0) : null
  const unusedCount = usageAllKnown ? tabItems.filter((t) => t.usageCount === 0).length : null
  const kpis = [
    {
      key: 'templates',
      title: 'テンプレート',
      icon: FileText,
      value: ready ? tabItems.length : null,
      unit: '件',
      detail: ready ? `未公開の変更 ${draftChanges}件` : '—',
    },
    {
      key: 'usage',
      title: '使っている所',
      icon: Link2,
      value: ready ? usageTotal : null,
      unit: 'か所',
      detail: ready ? (usageTotal === null ? '使っている所を確認できません' : '一斉配信・自動応答・シナリオなど') : '—',
    },
    {
      key: 'monthly',
      title: '今月送った数',
      icon: Send,
      value: ready ? monthlyTotal : null,
      unit: '通',
      detail: ready ? (monthlyTotal === null ? '送信数を確認できません' : 'このタブのテンプレートから') : '—',
    },
    {
      key: 'unused',
      title: '使っていない',
      icon: Mail,
      value: ready ? unusedCount : null,
      unit: '件',
      detail: ready ? (unusedCount === null ? '使っている所を確認できません' : '整理の候補') : '—',
    },
  ]

  /* ===== 選択 ===== */
  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const pageIds = shownItems.map((t) => t.id)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const toggleAllOnPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }
  const selectedCount = selectedIds.size
  // 選んでいる間は Esc で選択を外す（旧い一覧と同じ）。
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  useEscapeToClearSelection(selectedCount > 0, clearSelection)
  const selectedTemplates = templates.filter((t) => selectedIds.has(t.id))
  /** まとめて削除は「使っていない」ものだけ。 */
  const removableSelected = selectedTemplates.filter((t) => t.usageCount === 0)
  const usedSelectedCount = selectedTemplates.length - removableSelected.length

  /* ===== 操作 ===== */
  /** 行の編集先。質問とそうでないもので作る画面が分かれる。 */
  const editHref = (t: Template) =>
    t.question
      ? `/templates/questions/new?id=${encodeURIComponent(t.id)}`
      : `/templates/edit?id=${encodeURIComponent(t.id)}`
  const detailHref = (t: Template) => `/templates/detail?id=${encodeURIComponent(t.id)}`

  /** フォルダの並び順を入れ替える（隣と番号を交換）。 */
  const moveFolder = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.swapOrder(target.id, neighbor.id, selectedAccountId ?? undefined)
      if (!res.success) throw new Error(res.error)
      await loadFolders()
    } catch {
      setFolderError('並び順を変えられませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async () => {
    if (!deletingFolder) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(deletingFolder.id, selectedAccountId ?? undefined)
      if (!res.success) throw new Error(res.error ?? '削除できませんでした')
      setDeletingFolder(null)
      if (selectedCategory === deletingFolder.id) setSelectedCategory('all')
      await loadFolders()
    } catch {
      setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  /*
   * 使用中なら「使っている所」の窓へ。どこでも使われていない（0か所と分かっている）なら、
   * 確かめの窓を出さずに一覧から外し、5秒は「元に戻す」で取り消せる（動きの点検 17 番）。
   * 使っている数が分からないときは、今までどおり確かめの窓。
   */
  const handleDelete = (t: Template) => {
    setDeleteError('')
    if (t.usageCount > 0) {
      setBlockedDelete({ item: t, accountId: selectedAccountId })
      return
    }
    if (t.usageCount === 0) {
      if (activeId === t.id) setActiveId(null)
      setSelectedIds((current) => {
        if (!current.has(t.id)) return current
        const next = new Set(current)
        next.delete(t.id)
        return next
      })
      deferredDelete.schedule({
        ids: [t.id],
        message: `テンプレート「${t.name}」を削除しました`,
        commit: () => api.templates.delete(t.id),
        onCommitted: () => Promise.all([load(), loadFolders()]),
        failureMessage: 'テンプレートを削除できませんでした。もう一度お試しください。',
      })
      return
    }
    setPendingDelete({ item: t, accountId: selectedAccountId })
  }

  const confirmDelete = async () => {
    // 二度押しを受け付けない。切り替わった後も走らせない。
    if (!pendingDelete || deleting) return
    if (pendingDelete.accountId !== selectedAccountId) {
      setDeleteError('アカウントが切り替わりました。削除するテンプレートを選び直してください。')
      return
    }
    const target = pendingDelete.item
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.templates.delete(target.id)
      if (!res.success) throw new Error(res.error)
      setPendingDelete(null)
      // 件数（未分類・フォルダ別）はフォルダ側の集計が持つので両方読み直す。
      await Promise.all([load(), loadFolders()])
    } catch {
      setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /** フォルダへ移す（1件でもまとめてでも同じ窓）。 */
  const openMove = (ids: string[]) => {
    setPanelMove(ids.length === 1 && ids[0] === activeId)
    setMoveIds(ids)
    setMoveDraft('')
    setMoveError('')
  }
  /*
   * 押した瞬間に移した形を見せて窓を閉じ、裏で保存する（動きの点検・7）。
   * 1件でも失敗したら元に戻して知らせる（「もう一度」で同じ移動をやり直せる）。
   */
  const runMove = async () => {
    if (!moveIds) return
    const ids = moveIds
    const folderId = moveDraft === '' ? null : moveDraft
    const previous = templates
    const idSet = new Set(ids)
    setTemplates((current) => current.map((t) => (idSet.has(t.id) ? { ...t, folderId } : t)))
    setMoveIds(null)
    setPanelMove(false)
    setSelectedIds(new Set())
    setMoveError('')
    const send = async () => {
      let failed = 0
      for (const id of ids) {
        const result = await api.templates.update(id, { folderId })
        if (!result.success) failed += 1
      }
      return failed > 0 ? { success: false as const, error: `${failed}件` } : { success: true as const }
    }
    runOptimistic({
      request: send,
      revert: () => {
        setTemplates(previous)
        void Promise.all([load(), loadFolders()])
      },
      failureMessage: 'フォルダへ移せませんでした。状態を読み直したので、もう一度お試しください。',
      onSuccess: () => {
        notifyToast('フォルダへ移しました', { tone: 'success' })
        void loadFolders()
      },
    })
  }

  /* 複製。複製の口は無いので、同じ内容で「下書き」として新しく作る。 */
  const runDuplicate = async () => {
    if (!duplicateTarget) return
    setDuplicating(true)
    setDuplicateError('')
    const source = duplicateTarget
    try {
      const result = await api.templates.create({
        accountId: selectedAccountId ?? '',
        name: `${source.name}（コピー）`,
        category: source.category,
        messageType: source.messageType,
        messageContent: latestContentOf(source),
        question: source.question ?? null,
        questionStatus: 'draft',
        folderId: source.folderId,
      })
      if (!result.success) {
        setDuplicateError('複製できませんでした。状態を読み直してからお試しください。')
        return
      }
      setDuplicateTarget(null)
      notifyToast(`「${source.name}」をコピーしました（下書きで作られました）`, { tone: 'success' })
      await Promise.all([load(), loadFolders()])
    } catch (reason) {
      setDuplicateError(
        reason instanceof ApiError && reason.status === 403
          ? 'テンプレートを作るには権限が要ります。オーナーか管理者に頼んでください。'
          : '複製できませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setDuplicating(false)
    }
  }

  /** まとめて削除。使用中のものはここへ来ない（帯の側で弾く）。 */
  const runBulkDelete = async () => {
    if (!pendingBulkDelete) return
    setBulkDeleting(true)
    setBulkDeleteError('')
    try {
      let failed = 0
      for (const t of pendingBulkDelete) {
        const result = await api.templates.delete(t.id)
        if (!result.success) failed += 1
      }
      if (failed > 0) {
        setBulkDeleteError(`${failed}件を削除できませんでした。状態を読み直してからお試しください。`)
        await Promise.all([load(), loadFolders()])
        return
      }
      setPendingBulkDelete(null)
      setSelectedIds(new Set())
      notifyToast(`${pendingBulkDelete.length}件のテンプレートを削除しました`, { tone: 'success' })
      await Promise.all([load(), loadFolders()])
    } catch (reason) {
      setBulkDeleteError(
        reason instanceof ApiError && reason.status === 403
          ? 'テンプレートを削除するには権限が要ります。オーナーか管理者に頼んでください。'
          : '削除できませんでした。状態を読み直してからお試しください。',
      )
    } finally {
      setBulkDeleting(false)
    }
  }

  /* ===== 行の「…」（一斉配信で使う・複製・使っている所・削除） ===== */
  const rowMenuItems = (t: Template): ActionMenuItem[] => {
    // 閲覧のみには押せない項目を置かない（2026-10-06 オーナー決定）。見るだけの項目（使っている所・一斉配信で使う）は残す。
    const canMutate = canMutateTemplates
    return [
      ...(canMutate ? [{
        id: 'edit',
        label: '編集する',
        onSelect: () => withViewTransition(() => router.push(editHref(t))),
      }] : []),
      {
        id: 'usage',
        label: '使っている所を見る',
        external: true,
        onSelect: () => withViewTransition(() => router.push(detailHref(t))),
      },
      {
        id: 'broadcast',
        label: '一斉配信で使う',
        onSelect: () => window.location.assign(`/broadcasts/new?templateId=${encodeURIComponent(t.id)}`),
      },
      ...(canMutate ? [
        {
          id: 'duplicate',
          label: '複製する',
          icon: <Copy size={14} aria-hidden="true" />,
          onSelect: () => {
            setDuplicateError('')
            setDuplicateTarget(t)
          },
        },
        {
          id: 'move',
          label: 'フォルダへ移す',
          icon: <FolderIcon size={14} aria-hidden="true" />,
          onSelect: () => openMove([t.id]),
        },
        {
          id: 'delete',
          label: '削除する',
          tone: 'danger' as const,
          dividerBefore: true,
          onSelect: () => handleDelete(t),
        },
      ] : []),
    ]
  }

  /* 右から出る詳細パネルの今の行。一覧に無ければ閉じる。 */
  const activeTemplate = activeId ? (templates.find((t) => t.id === activeId) ?? null) : null
  const navItems = activeTemplate && shownItems.some((t) => t.id === activeTemplate.id) ? shownItems : templates
  const activeIndex = activeTemplate ? navItems.findIndex((t) => t.id === activeTemplate.id) : -1
  const activeFolderName = activeTemplate
    ? (activeTemplate.folderId === null
      ? '未分類'
      : (folders.find((f) => f.id === activeTemplate.folderId)?.name ?? null))
    : null

  /* 名前のその場の書き換え。Enter で保存・Esc でやめる。 */
  const renameTemplate = async (t: Template, next: string) => {
    const name = next.trim()
    if (!name || name === t.name) return
    const res = await api.templates.update(t.id, { name })
    if (!res.success) throw new Error(res.error ?? 'rename_failed')
    setTemplates((rows) => rows.map((row) => (row.id === t.id ? { ...row, name } : row)))
  }

  /* 右クリックは「…」と同じ項目。 */
  const contextTemplate = contextId ? (templates.find((t) => t.id === contextId) ?? null) : null
  const contextMenuItems: ContextMenuItem[] = contextTemplate
    ? rowMenuItems(contextTemplate).map((item) => ({
      id: item.id,
      label: item.label,
      danger: item.tone === 'danger',
      disabled: item.disabled,
      onSelect: () => item.onSelect(),
    }))
    : []

  /* ===== フォルダの列 ===== */
  /* 行の名前の前の丸は、左のフォルダの列と同じフォルダ（同じ色）を引く。未分類は色の無い輪。 */
  const folderDotOf = (t: { folderId: string | null }): FolderDotFolder | null => {
    if (!t.folderId) return null
    const folder = folders.find((f) => f.id === t.folderId)
    return folder ? { name: folder.name, color: folder.color } : null
  }
  const folderRows: FolderPanelRow[] = [
    { id: 'all', label: 'すべて', count: ready ? tabItems.length : null },
    ...folders.map((folder, index) => ({
      id: folder.id,
      label: folder.name,
      count: folder.itemCount ?? null,
      color: folder.color,
      qaOpen: canMutateTemplates && folder.name === '予約' ? 'CzndJ' : undefined,
      onEdit: canMutateTemplates ? () => setEditingFolder(folder) : undefined,
      onMoveUp: canMutateTemplates && index > 0 ? () => void moveFolder(index, -1) : undefined,
      onMoveDown: canMutateTemplates && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
      onDelete: canMutateTemplates ? () => setDeletingFolder(folder) : undefined,
      deleteNote: '削除しても、中のテンプレートは未分類に残ります。',
    })),
    { id: 'unfiled', label: '未分類', count: ready ? unfiledCount : null },
  ]
  const folderSelectOptions = [
    { value: 'all', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
    { value: 'unfiled', label: '未分類' },
  ]

  const openPicker = () => setPickerOpen(true)
  // 閲覧のみには押せない作るボタンを置かない（2026-10-06 オーナー決定）。権限以外の理由（createBlocked）は押せない形のまま。
  const createButton = (full: boolean) => !canMutateTemplates ? null : (
    <Button
      type="button"
      variant="primary"
      className={full ? 'v8-folder-create w-full' : undefined}
      disabled={createBlocked !== null}
      title={createBlocked ?? undefined}
      onClick={openPicker}
    >
      <Plus size={15} aria-hidden="true" />テンプレートを作る
    </Button>
  )

  const folderPanel = (
    <FolderPanel
      activeId={selectedCategory}
      onSelect={(id) => {
        setSelectedCategory(id)
        setPage(1)
      }}
      onAddFolder={canMutateTemplates ? () => setFolderDialogOpen(true) : undefined}
      addFolderLabel="フォルダを追加"
      rows={folderRows}
    >
      {/* 補助のデータ（フォルダ）だけ取れないときは、その場所に小さく1行だけ。 */}
      {folderError ? <p role="alert" className={styles.folderNote}>{folderError}</p> : null}
      <p className={styles.folderNote}>
        フォルダは種類のタブをまたいで使えます。消しても、中のテンプレートは未分類に残ります
      </p>
    </FolderPanel>
  )

  /* ===== 道具の段の部品（広い板と 1152 で同じものを並べ替える） ===== */
  const onSearch = (value: string) => {
    setTemplateQuery(clampSearchQuery(value))
    setPage(1)
  }
  const filterChips = (
    <div role="group" aria-label="中身で絞り込む" className={styles.chipGroup}>
      <FilterChip selected={chips.single} onChange={() => toggleChip('single')} title="1つのメッセージだけのテンプレート" icon={<MessageSquare size={13} aria-hidden="true" />}>
        1通のみ
      </FilterChip>
      <FilterChip selected={chips.multiple} onChange={() => toggleChip('multiple')} title="複数のメッセージに分かれるテンプレート" icon={<Layers size={13} aria-hidden="true" />}>
        複数通
      </FilterChip>
      <FilterChip selected={chips.variables} onChange={() => toggleChip('variables')} title="名前や情報を差し込むテンプレート" icon={<Braces size={13} aria-hidden="true" />}>
        差し込みあり
      </FilterChip>
      <FilterChip selected={chips.unused} onChange={() => toggleChip('unused')} title="どこからも使われていないテンプレート" icon={<Unlink size={13} aria-hidden="true" />}>
        使っていない
      </FilterChip>
    </div>
  )
  /* よく使う絞り込み（絵：栞の印＋文字のボタン。押すと選ぶメニュー）。1152 は印だけ。 */
  const savedLabel = SAVED_FILTER_OPTIONS.find((o) => o.value === savedFilter && o.value !== '')?.label
  const savedBox = (iconOnly: boolean) => (
    <Button
      type="button"
      variant="secondary"
      aria-label={iconOnly ? `よく使う絞り込み${savedLabel ? `：${savedLabel}` : ''}` : undefined}
      title={iconOnly ? (savedLabel ?? 'よく使う絞り込み') : undefined}
      aria-haspopup="menu"
      aria-expanded={savedMenuOpen}
      aria-pressed={savedFilter !== ''}
      onClick={(event) => {
        savedAnchorRef.current = event.currentTarget
        setSavedMenuOpen((current) => !current)
      }}
    >
      <Bookmark size={15} aria-hidden="true" />
      {iconOnly ? null : (savedLabel ?? 'よく使う絞り込み')}
    </Button>
  )
  const savedMenu = (
    <ActionMenu
      open={savedMenuOpen}
      onClose={() => setSavedMenuOpen(false)}
      anchorRef={savedAnchorRef}
      ariaLabel="よく使う絞り込み"
      items={SAVED_FILTER_OPTIONS.filter((o) => o.value !== '').map((o) => ({
        id: o.value,
        label: savedFilter === o.value ? `${o.label}（選択中・押すと外す）` : o.label,
        onSelect: () => {
          setSavedMenuOpen(false)
          setSavedFilter((current) => (current === o.value ? '' : o.value))
          setPage(1)
        },
      }))}
    />
  )
  const perPageBox = (
    <div className={styles.perPageBox}>
      <Select
        aria-label="1ページに出す件数"
        size="page-size"
        value={String(pageSize)}
        onChange={(value) => {
          setPageSize(Number(value))
          setPage(1)
        }}
        options={PAGE_SIZE_OPTIONS}
      />
    </div>
  )

  /* 1152 の板（L7zA7C）：1段目「作る・フォルダ・探す … 件数」、2段目「札・よく使う絞り込み（印だけ）」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      <div className={styles.narrowRow}>
        {createButton(false)}
        <div className={styles.narrowFolder}>
          <Select
            aria-label="フォルダ"
            value={selectedCategory}
            onChange={(value) => {
              setSelectedCategory(value)
              setPage(1)
            }}
            options={folderSelectOptions}
          />
        </div>
        <div className={styles.narrowSearch}>
          <SearchField
            aria-label="テンプレートを検索"
            placeholder="名前・本文で探す"
            value={templateQuery}
            onChange={onSearch}
            onClear={() => onSearch('')}
          />
        </div>
        <span className={styles.spacer} aria-hidden="true" />
        {perPageBox}
      </div>
      <div className={styles.narrowRow}>
        {filterChips}
        {savedBox(true)}
      </div>
    </div>
  )

  const wideToolbar = (
    <div className={styles.wideTools}>
      <ListToolbar
        search={{
          placeholder: '名前・本文・差し込みで探す',
          label: 'テンプレートを検索',
          value: templateQuery,
          onChange: onSearch,
        }}
        filters={filterChips}
        trailing={<>{savedBox(false)}{perPageBox}</>}
      />
    </div>
  )

  /* ===== 一覧の中身（`susGP`：読込中・読み込めない・空・0件を分ける） ===== */
  const sectionWord = activeSection === 'question' ? '質問のテンプレート' : 'メッセージのテンプレート'
  const listBody = accountLoading || view === 'loading' ? (
    <div className={styles.skeletonRows} aria-label="読み込み中" data-design-node="susGP">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonRow} aria-hidden="true">
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
        </div>
      ))}
    </div>
  ) : !selectedAccountId ? (
    <div className={styles.stateCard}>
      <span className={styles.stateIcon}>
        <FileText size={18} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>
        {accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
      </p>
    </div>
  ) : view === 'forbidden' || view === 'error' ? (
    <div className={styles.stateCard} data-design-node="susGP">
      <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
        <TriangleAlert size={18} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>
        {view === 'forbidden' ? (failure?.title ?? '見る権限がありません') : 'テンプレートを読み込めませんでした'}
      </p>
      <p className={styles.stateDesc}>
        {view === 'forbidden'
          ? (failure?.description ?? '')
          : '登録したテンプレートは消えていません。数の帯は「—」、道具はそのまま使えます（条件を変えてから試し直せる）。'}
      </p>
      {view === 'error' && (
        <Button type="button" onClick={() => void load()}>もう一度試す</Button>
      )}
    </div>
  ) : filteredTemplates.length === 0 ? (
    /* 修正案 D-2：空の一覧。 */
    <EmptyList
      data-design-node="susGP"
      icon={<FileText aria-hidden="true" />}
      title={`まだ${sectionWord}がありません`}
      description="よく送る文を保存しておくと、一斉配信・自動応答・シナリオから選べます。"
      create={{ label: '最初のテンプレートを作る', onClick: openPicker }}
      canCreate={canMutateTemplates}
      filtered={filterActive}
      onClearFilters={clearFilters}
      filteredDescription="「1通のみ」「差し込みあり」「使っていない」や検索を外すと、すべて出ます"
    />
  ) : (
    <>
      <ContextMenu
        label={contextTemplate ? `テンプレート「${contextTemplate.name}」の操作` : 'テンプレートの操作'}
        items={contextMenuItems}
        shouldOpen={(event) => Boolean((event.target as HTMLElement | null)?.closest?.('tr[data-row-id]'))}
      >
        <div className={styles.tableWrap}>
          <DataTable>
            <colgroup>
              <col className={styles.colSelect} />
              <col />
              <col className={styles.colKind} />
              <col className={styles.colPublish} />
              {!narrow && <col className={styles.colUsage} />}
              {!narrow && <col className={styles.colMonthly} />}
              {!narrow && <col className={styles.colUpdated} />}
              <col className={styles.colMenu} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th className={styles.selectCell} aria-label="選択">
                  {/* 閲覧のみ：まとめて変える操作が無いので、選ぶチェックを置かない（列の幅は残す） */}
                  {canMutateTemplates ? (
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && selectedCount > 0}
                      onCheckedChange={() => toggleAllOnPage()}
                      aria-label="このページのテンプレートをすべて選択"
                    />
                  ) : null}
                </Th>
                <Th className={styles.headCell}>テンプレート</Th>
                <Th className={styles.headCell}>種類</Th>
                <Th className={styles.headCell}>公開</Th>
                {!narrow && <Th className={styles.headCell}>使っている所</Th>}
                {!narrow && <Th className={styles.headCell}>今月送った数</Th>}
                {!narrow && <Th className={styles.headCell}>更新</Th>}
                <Th aria-label="操作" />
              </TableHeadRow>
            </thead>
            <RovingTbody>
              {shownItems.map((t) => {
                const publish = publishStateOf(t)
                const kindLabel = t.question ? 'question' : t.messageType
                const excerpt = excerptOf(t)
                return (
                  <Tr
                    interactive
                    key={t.id}
                    data-row-id={t.id}
                    className={styles.rowClick}
                    tabIndex={0}
                    onClick={() => setActiveId(t.id)}
                    onContextMenuCapture={() => setContextId(t.id)}
                    onKeyDown={(event) => {
                      // 行内のリンク・ボタンにフォーカスがあるときは行を開かない。
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setActiveId(t.id)
                      }
                    }}
                  >
                    <Td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                      {canMutateTemplates ? (
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onCheckedChange={() => toggleOne(t.id)}
                          aria-label={`「${t.name}」を選択`}
                        />
                      ) : null}
                    </Td>
                    <NameCell
                      name={
                        <div className={styles.dotLine}>
                          <FolderDotName folder={folderDotOf(t)}>
                            <Link href={detailHref(t)} title={t.name} className={styles.cellTitle} onClick={(event) => event.stopPropagation()}>
                              {t.name}
                            </Link>
                          </FolderDotName>
                        </div>
                      }
                      sub={<span className={narrow ? styles.cellSub : `${styles.cellSub} ${styles.dotIndent}`} title={excerpt}>{excerpt}</span>}
                    />
                    <Td>
                      <span className={styles.kindBadge}>{messageTypeText(kindLabel)}</span>
                    </Td>
                    <Td>
                      <span className={styles.publishPill} data-tone={publish.tone}>
                        <span className={styles.publishDot} aria-hidden="true" />
                        {publish.label}
                      </span>
                    </Td>
                    {!narrow && (
                      <Td>
                        {typeof t.usageCount !== 'number' ? (
                          <span className={styles.cellFaint}>使っている所を確認できません</span>
                        ) : t.usageCount === 0 ? (
                          <span className={styles.cellFaint}>なし</span>
                        ) : (
                          <Link href={detailHref(t)} className={styles.usageLink} onClick={(event) => event.stopPropagation()}>
                            {`${formatNumber(t.usageCount)}か所`}
                          </Link>
                        )}
                      </Td>
                    )}
                    {!narrow && (
                      <Td
                        className={styles.cellPlain}
                        title={typeof t.totalSendCount === 'number' ? `累計 ${formatNumber(t.totalSendCount)}通` : undefined}
                      >
                        {sendCountText(t)}
                      </Td>
                    )}
                    {!narrow && (
                      <Td className={styles.cellPlain} title={formatDateTime(t.updatedAt)}>
                        {formatMonthDay(t.updatedAt)}
                      </Td>
                    )}
                    <Td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                      {/* 横並びにして、メニューの位置の目印が行を1段増やさないようにする。 */}
                      <div className={styles.menuBox}>
                        <IconButton
                          title={`テンプレート「${t.name}」の操作`}
                          aria-label={`テンプレート「${t.name}」の操作`}
                          aria-expanded={openMenuId === t.id}
                          onClick={() => setOpenMenuId((current) => (current === t.id ? null : t.id))}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </IconButton>
                        <ActionMenu
                          open={openMenuId === t.id}
                          onClose={() => setOpenMenuId(null)}
                          ariaLabel={`テンプレート「${t.name}」の操作`}
                          items={rowMenuItems(t)}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </RovingTbody>
          </DataTable>
        </div>
      </ContextMenu>

      {/* まとめての帯（選ぶと表の下に出る）：フォルダへ移す・まとめて削除。 */}
      {canMutateTemplates && selectedCount > 0 ? (
        <div className={styles.bulkRow} role="region" aria-label="選択中のまとめ操作">
          <span className={styles.bulkCount}>{selectedCount}件を選択中</span>
          <Button
            type="button"
            variant="secondary"
            disabled={moving}
            onClick={() => openMove([...selectedIds])}
          >
            <FolderIcon size={13} aria-hidden="true" />
            フォルダへ移す
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={bulkDeleting || removableSelected.length === 0}
            title={
              usedSelectedCount > 0
                ? '使っているテンプレートが選ばれています。先に使用先を差し替えてください'
                : undefined
            }
            onClick={() => {
              setBulkDeleteError('')
              setPendingBulkDelete(removableSelected)
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            まとめて削除
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSelectedIds(new Set())}>
            選択を外す
          </Button>
        </div>
      ) : null}
    </>
  )

  /* ページ送りは型の pagination 枠へ。件数は部品の summary に入れる（絵：左に「26件中 1〜20件」、右に頁。帯の内側は部品の 10・20）。 */
  const showPager = view === 'ready' && filteredTemplates.length > 0
  const pagerSummary = `${formatNumber(filteredTemplates.length)}件中 ${(safePage - 1) * pageSize + 1}〜${Math.min(safePage * pageSize, filteredTemplates.length)}件`
  const listPager = !showPager ? null : pageCount > 1 ? (
    <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} summary={<span className={styles.pagerCount}>{pagerSummary}</span>} />
  ) : (
    <p className={styles.pagerSolo}>{pagerSummary}</p>
  )

  const isTemplateSection = activeSection === 'message' || activeSection === 'question'
  const switchSection = (next: Section) => {
    setActiveSection(next)
    setPage(1)
    setSelectedIds(new Set())
  }

  /* 種類のタブ（件数つき）。閲覧のみの帯（`hEDTK`）はタブの上。 */
  const tabs = (
    <>
      {!canMutateTemplates ? (
        <div className={styles.viewerBand} role="status" data-design-node="hEDTK">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      ) : null}
      <div className={styles.tabsBox}>
      <Tabs
        label="テンプレートの種類"
        items={[
          { label: 'メッセージ', count: loading ? undefined : templates.filter((t) => !t.question).length, current: activeSection === 'message', onClick: () => switchSection('message') },
          { label: 'カルーセル', count: assetCounts.card_message, current: activeSection === 'card_message', onClick: () => switchSection('card_message') },
          { label: 'リッチメッセージ', count: assetCounts.rich_message, current: activeSection === 'rich_message', onClick: () => switchSection('rich_message') },
          { label: '質問', count: loading ? undefined : templates.filter((t) => Boolean(t.question)).length, current: activeSection === 'question', onClick: () => switchSection('question') },
          { label: 'クーポン', count: assetCounts.coupon, current: activeSection === 'coupon', onClick: () => switchSection('coupon') },
          { label: 'リサーチ', count: assetCounts.research, current: activeSection === 'research', onClick: () => switchSection('research') },
        ]}
      />
      </div>
    </>
  )

  const blockedRows = blockedUsage ? usageRows(blockedUsage) : []
  const blockedTotal = blockedDelete ? Math.max(blockedDelete.item.usageCount, blockedRows.length) : 0

  const overlays = (
    <>
      {savedMenu}
      {/*
        種類を選ぶ窓（`R9XUMr`）：6つの種類（3つずつ2段）と「見本から作る」（F-5）、下に真ん中のキャンセル。
        窓の頭は絵の値（上と左右 24・題の行 24）、キャンセルは本文の続きに置く（絵は線なし・間 20）。
      */}
      <Dialog
        open={pickerOpen}
        title="どの種類を作りますか"
        designNode="R9XUMr"
        designWidth={840}
        designTop={200}
        designHeaderPadding="24px 24px 0"
        designHeaderHeight={48}
        onCancel={() => setPickerOpen(false)}
        footer={<></>}
      >
        <div className={styles.picker}>
          <div className={styles.pickerGrid}>
            {KIND_CARDS.map((card) => (
              <button
                key={card.key}
                type="button"
                className={styles.kindCard}
                onClick={() => {
                  setPickerOpen(false)
                  router.push(card.href)
                }}
              >
                <span className={styles.kindIcon}>
                  <card.icon size={16} aria-hidden="true" />
                </span>
                <span className={styles.kindTitle}>{card.title}</span>
                <span className={styles.kindDesc}>{card.desc}</span>
                <span className={styles.kindSpacer} aria-hidden="true" />
                <span className={styles.kindMeta}>
                  <span>{card.useFor}</span>
                  <span>{card.cannot}</span>
                </span>
              </button>
            ))}
          </div>
          {examples && examples.length > 0 ? (
            <section className={styles.examples} aria-label="見本から作る">
              <h3 className={styles.examplesTitle}>見本から作る</h3>
              <div className={styles.exampleRow}>
                {examples.slice(0, 4).map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    className={styles.exampleCard}
                    title={example.body}
                    onClick={() => {
                      setPickerOpen(false)
                      router.push(exampleHref(example))
                    }}
                  >
                    <span className={styles.exampleName}>{example.name}</span>
                    {/* 見本はどれも文字のメッセージ（口が返すのは名前と本文だけ）。 */}
                    <span className={styles.exampleKind}>メッセージ</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <div className={styles.pickerFooter}>
            <Button type="button" variant="secondary" onClick={() => setPickerOpen(false)}>
              キャンセル
            </Button>
          </div>
        </div>
      </Dialog>

      {/*
        削除の確認窓（`V6JFnd`：使っていないテンプレート）。
        危ないボタンは左端、キャンセルは真ん中（V8 の窓の決まり）。
      */}
      <Dialog
        open={pendingDelete !== null}
        title={`「${pendingDelete?.item.name ?? ''}」を削除する`}
        description={DELETE_UNUSED_DESCRIPTION}
        busy={deleting}
        error={deleteError}
        designNode="V6JFnd"
        onCancel={() => {
          if (deleting) return
          setPendingDelete(null)
          setDeleteError('')
        }}
        footer={
          <div className={styles.dangerFooter}>
            <span className={styles.footerLeft}>
              <Button
                type="button"
                variant="danger"
                disabled={deleting || (pendingDelete !== null && pendingDelete.accountId !== selectedAccountId)}
                busy={deleting}
                busyLabel="削除中…"
                onClick={() => void confirmDelete()}
              >
                削除する
              </Button>
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={deleting}
              onClick={() => {
                setPendingDelete(null)
                setDeleteError('')
              }}
            >
              キャンセル
            </Button>
            <span className={styles.footerRight} aria-hidden="true" />
          </div>
        }
      >
        <div className={styles.fullWidth}>
          <Notice tone="danger" message="削除は元に戻せません。" />
        </div>
        {pendingDelete !== null && pendingDelete.accountId !== selectedAccountId ? (
          <p className={styles.alertText} role="alert">
            アカウントが切り替わりました。削除するテンプレートを選び直してください。
          </p>
        ) : null}
      </Dialog>

      {/* まとめて削除の確認窓。対象は「使っていない」ものだけ。 */}
      <ConfirmDialog
        open={pendingBulkDelete !== null}
        title={`${pendingBulkDelete?.length ?? 0}件のテンプレートを削除しますか？`}
        description="どれも使われていないので、他の画面の動きは止まりません。すでに送ったメッセージは残ります。この操作は取り消せません。"
        confirmLabel="まとめて削除する"
        destructive
        busy={bulkDeleting}
        error={bulkDeleteError}
        onConfirm={() => void runBulkDelete()}
        onCancel={() => {
          if (bulkDeleting) return
          setPendingBulkDelete(null)
          setBulkDeleteError('')
        }}
      />

      {/*
        削除できない窓（`Z0g3si`：使っている所がある）。
        中身は usage 口で取り、差し替え先へのリンクを並べる。
      */}
      <Dialog
        open={blockedDelete !== null}
        title={`「${blockedDelete?.item.name ?? ''}」はまだ消せません`}
        description={blockedDelete ? blockedDeleteDescription(blockedDelete.item.usageCount) : undefined}
        designNode="Z0g3si"
        onCancel={() => {
          setBlockedDelete(null)
          setBlockedUsage(null)
        }}
        footer={
          <div className={styles.centerFooter}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBlockedDelete(null)
                setBlockedUsage(null)
              }}
            >
              閉じる
            </Button>
            {blockedDelete ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const target = blockedDelete.item
                  setBlockedDelete(null)
                  setBlockedUsage(null)
                  withViewTransition(() => router.push(detailHref(target)))
                }}
              >
                <List size={15} aria-hidden="true" />
                使っている所をすべて見る
              </Button>
            ) : null}
          </div>
        }
      >
        {blockedLoading ? (
          <p className={styles.faintText}>使用先を読み込んでいます…</p>
        ) : blockedLoadError ? (
          // 消してよいか分からないのに消させない。閉じて読み直すだけ。
          <p className={styles.alertText} role="alert">
            使っている所を確認できませんでした。閉じてから、もう一度お試しください。
          </p>
        ) : blockedUsage ? (
          <div className={styles.usageList}>
            <ul>
              {blockedRows.slice(0, BLOCKED_ROWS_SHOWN).map((row) => (
                <li key={row.key} className={styles.usageRow}>
                  <span className={styles.usageKind}>{row.kind}</span>
                  <span className={styles.usageName} title={row.status ? `${row.name}（${row.status}）` : row.name}>{row.name}</span>
                  {row.href ? (
                    <Link href={row.href} className={styles.usageOpen}>
                      <SquareArrowOutUpRight size={15} aria-hidden="true" />
                      開いて差し替える
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            {blockedTotal > BLOCKED_ROWS_SHOWN ? (
              <p className={styles.usageMore}>{`ほか ${blockedTotal - BLOCKED_ROWS_SHOWN} か所`}</p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {/* フォルダへ移すの窓。パネルで選ぶ1件のときは出さない。 */}
      <ConfirmDialog
        open={moveIds !== null && !panelMove}
        title={
          moveIds && moveIds.length === 1
            ? `「${templates.find((t) => t.id === moveIds[0])?.name ?? ''}」のフォルダを移す`
            : `${moveIds?.length ?? 0}件のテンプレートをフォルダへ移す`
        }
        description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
        confirmLabel={moving ? '移動中…' : '移動する'}
        busy={moving}
        error={moveError}
        onConfirm={() => void runMove()}
        onCancel={() => {
          if (moving) return
          setMoveIds(null)
          setMoveError('')
        }}
      >
        <div className={styles.moveBody}>
          <span className={styles.moveLabel}>移動先のフォルダ</span>
          <Select
            aria-label="移動先のフォルダ"
            size="full"
            value={moveDraft}
            onChange={(value) => setMoveDraft(value)}
            disabled={moving}
            options={[
              { value: '', label: '未分類' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
          />
        </div>
      </ConfirmDialog>

      {/* 複製の確認窓。コピーは下書きで作る（公開は別の操作）。 */}
      <ConfirmDialog
        open={duplicateTarget !== null}
        title={duplicateTarget ? `「${duplicateTarget.name}」を複製しますか？` : ''}
        description="同じ本文のテンプレートをもう1つ作ります。コピーは「下書き」で作られるので、確認してから公開してください。名前に「（コピー）」を付けます。"
        confirmLabel={duplicating ? '複製中…' : '複製する'}
        busy={duplicating}
        error={duplicateError}
        onConfirm={() => void runDuplicate()}
        onCancel={() => {
          if (duplicating) return
          setDuplicateTarget(null)
          setDuplicateError('')
        }}
      />

      {folderDialogOpen && (
        <FolderAddDialog
          kind="template"
          accountId={selectedAccountId}
          note="テンプレートを分けてしまう箱です。削除しても、中のテンプレートは未分類に残ります。"
          placeholder="例: 01_定期便"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => { setFolderDialogOpen(false); void loadFolders() }}
        />
      )}

      {editingFolder && (
        <FolderAddDialog
          kind="template"
          folder={editingFolder}
          accountId={selectedAccountId}
          note="テンプレートを分けてしまう箱です。削除しても、中のテンプレートは未分類に残ります。"
          placeholder="例: 01_定期便"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void loadFolders() }}
        />
      )}

      {/* フォルダを消す前に、中身がどうなるかを本文で読ませる。 */}
      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中のテンプレートは未分類に残ります。いまこのフォルダに入っているのは${
          deletingFolder ? templates.filter((t) => t.folderId === deletingFolder.id).length : 0
        }件です。`}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => { if (!folderBusy) { setDeletingFolder(null); setFolderError('') } }}
        onConfirm={() => void removeFolder()}
      />

      {/* 行の詳細パネル。一覧は左に見えたまま。 */}
      {activeTemplate && isTemplateSection ? (
        <DetailPanel
          open
          title={activeTemplate.name}
          description={activeFolderName ?? undefined}
          onClose={() => {
            setActiveId(null)
            setPanelMove(false)
          }}
          hasPrev={activeIndex > 0}
          hasNext={activeIndex >= 0 && activeIndex < navItems.length - 1}
          onPrev={() => setActiveId(navItems[activeIndex - 1]?.id ?? null)}
          onNext={() => setActiveId(navItems[activeIndex + 1]?.id ?? null)}
          footer={
            <div className={styles.panelActions}>
              <Button type="button" variant="primary" onClick={() => withViewTransition(() => router.push(detailHref(activeTemplate)))}>
                詳細を見る
              </Button>
              {/* 閲覧のみ：変えるボタンは置かない（2026-10-06 オーナー決定） */}
              {canMutateTemplates ? <>
                <Button type="button" variant="secondary" onClick={() => withViewTransition(() => router.push(editHref(activeTemplate)))}>
                  編集する
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDuplicateError('')
                    setDuplicateTarget(activeTemplate)
                  }}
                >
                  複製する
                </Button>
                <Button type="button" variant="secondary" onClick={() => openMove([activeTemplate.id])}>
                  フォルダへ移す
                </Button>
                <Button type="button" variant="danger" onClick={() => handleDelete(activeTemplate)}>
                  削除する
                </Button>
              </> : null}
            </div>
          }
        >
          <div className={styles.panelBody}>
            <p className={styles.panelLabel}>名前</p>
            {canMutateTemplates ? (
              <InlineEdit
                value={activeTemplate.name}
                label="テンプレートの名前"
                maxLength={100}
                onSave={(next) => renameTemplate(activeTemplate, next)}
              />
            ) : (
              // 閲覧のみ：鉛筆は置かず、名前だけを見せる。
              <p className={styles.panelText}>{activeTemplate.name}</p>
            )}
            <p className={styles.panelLabel}>中身の抜粋</p>
            <p className={styles.panelText}>
              {latestContentOf(activeTemplate).slice(0, 120)}
              {latestContentOf(activeTemplate).length > 120 ? '…' : ''}
            </p>
            <p className={styles.panelLabel}>公開</p>
            <p className={styles.panelText}>
              <span className={styles.publishPill} data-tone={publishStateOf(activeTemplate).tone}>
                <span className={styles.publishDot} aria-hidden="true" />
                {publishStateOf(activeTemplate).label}
              </span>
            </p>
            <p className={styles.panelLabel}>使っている所</p>
            <p className={styles.panelText}>
              {typeof activeTemplate.usageCount !== 'number'
                ? '使っている所を確認できません'
                : activeTemplate.usageCount === 0
                  ? 'なし'
                  : `${activeTemplate.usageCount}か所`}
            </p>
            {panelMove ? (
              <>
                <p className={styles.panelLabel}>移動先のフォルダ</p>
                <div className={styles.moveBody}>
                  <Select
                    aria-label="移動先のフォルダ"
                    size="full"
                    value={moveDraft}
                    onChange={(value) => setMoveDraft(value)}
                    disabled={moving}
                    options={[
                      { value: '', label: '未分類' },
                      ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                    ]}
                  />
                  <Button type="button" variant="primary" disabled={moving} busy={moving} onClick={() => void runMove()}>
                    {moving ? '移動中…' : '移動する'}
                  </Button>
                </div>
                {moveError ? <p className={styles.alertText} role="alert">{moveError}</p> : null}
              </>
            ) : null}
          </div>
        </DetailPanel>
      ) : null}
    </>
  )

  const heading = {
    title: 'テンプレート',
    description: '一斉配信・自動応答・シナリオなどで使う、メッセージのひな形です。直して公開すると、使っている所に反映されます。',
  }

  /* 資産タブ（カルーセル・リッチメッセージ・クーポン・リサーチ）。中身の管理は既存の部品のまま。 */
  if (!isTemplateSection) {
    return (
      <ListPage boardId={narrow ? 'L7zA7C' : 'v19Ivv'} headingSize="regular" {...heading} tabs={tabs} overlays={overlays}>
        <div className={styles.assetBody}>
          {canMutateTemplates ? (
            <BroadcastAssetManager kind={activeSection} onChanged={() => void loadAssetCounts()} />
          ) : (
            <>
              <p className={styles.faintText}>
                カルーセル・リッチメッセージ・クーポン・リサーチの作成・変更・削除はオーナーと管理者だけができます。一覧の閲覧はこのまま使えます。
              </p>
              <StaffAssetList kind={activeSection} />
            </>
          )}
        </div>
      </ListPage>
    )
  }

  return (
    <ListPage
      boardId={narrow ? 'L7zA7C' : 'v19Ivv'}
      headingSize="regular"
      {...heading}
      tabs={tabs}
      stats={
        /* 数の帯 4つ。並びと間は共有の帯に任せる。 */
        <KpiBand data-design="KPIs" className={styles.kpiStrip}>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="band"
              title={kpi.title}
              icon={<kpi.icon size={13} aria-hidden="true" />}
              value={kpi.value}
              unit={kpi.value == null ? '' : kpi.unit}
              detail={<span className={styles.kpiDetailWrap}>{kpi.detail}</span>}
            />
          ))}
        </KpiBand>
      }
      folders={<>{createButton(true) ?? <span className={styles.viewerCreateSpace} aria-hidden="true" />}{folderPanel}</>}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={listPager}
      overlays={overlays}
    >
      {listBody}
    </ListPage>
  )
}
