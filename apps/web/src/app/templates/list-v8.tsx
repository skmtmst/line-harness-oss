'use client'

/*
 * ★V8 テンプレートの一覧（Pencil「★V8 画面の地図」のテンプレートの行：
 * 一覧 `v19Ivv`、作る種類を選ぶ窓 `R9XUMr`、削除できない窓 `Z0g3si`、
 * 削除の確認 `V6JFnd`、状態の板 `susGP`）。
 *
 * v7 の一覧（app/templates/page.tsx 内の TemplatesPageV7）とは別の部品として
 * 持つ。データの口は同じ。違いは置き場と見せ方だけ——
 * 「テンプレートを作る」は左のフォルダの列の上で、押すと種類を選ぶ窓が開く。
 * 行の右端は「…」（編集・使っている所を見る・一斉配信で使う・複製・
 * フォルダへ移す・削除）、行の左の □ を選ぶと表の下にまとめての帯
 * （フォルダへ移す・削除）。行を押すと詳細画面 `/templates/detail` へ
 * 移る（v7 の引き出しは V8 の詳細画面に置き換わる）。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Bot,
  ClipboardList,
  Copy,
  FileText,
  Folder as FolderIcon,
  GalleryHorizontalEnd,
  HelpCircle,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Search as SearchIcon,
  Send,
  Star,
  Ticket,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
} from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, type BroadcastAssetKind, type TemplateQuestion } from '@/lib/api'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { formatDateTime, formatDay, formatNumber } from '@/lib/format'
import { notifyToast } from '@/components/shared/toast'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Pagination from '@/components/shared/pagination'
import { runUndoable } from '@/lib/undoable'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { Tabs } from '@/components/shared/tabs'
import BroadcastAssetManager from '@/components/broadcasts/broadcast-asset-manager'
import StaffAssetList from './staff-asset-list'
import {
  createBlockedReason,
  failureOf,
  failureOfResponse,
  listView,
  type TemplatesFailure,
} from './list-state-kind'
import { templateDeleteDescription } from './template-delete-message'
import { messageTypeText } from './template-message-type'
import styles from './list-v8.module.css'

/** 一覧のタブ。message/question は同じテンプレートの束を中身で分ける。 */
type Section = 'message' | 'question' | BroadcastAssetKind

/** 絞り込み札。v7 の typeFilter と同じ4つ（排他ではなく独立に切り替える）。 */
type ChipKey = 'single' | 'multiple' | 'variables' | 'unused'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  /** R194: 最新の下書き本文。公開版だけのときは null。 */
  draftMessageContent?: string | null
  /** 置き場。未分類は null。一覧の口が返している。 */
  folderId: string | null
  question: TemplateQuestion | null
  questionStatus: 'draft' | 'published'
  usageCount: number
  /** 162: 選択肢が押された回数の合計。 */
  tapCount: number
  monthlySendCount: number | null
  totalSendCount: number | null
  /** 347: 公開待ちの下書きがあるか。 */
  hasDraft?: boolean
  /** 347: 最後に公開した日時。未公開はnull。 */
  publishedAt?: string | null
  createdAt: string
  updatedAt: string
}

/** 削除できない窓に出す「使っている所」の明細（`api.templates.usages` の返り）。 */
interface UsageDetail {
  autoReplies: Array<{ id: string; keyword: string; lineAccountId: string | null; templateVersion: number | null }>
  automations: Array<{ id: string; name: string; eventType: string }>
  scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number; templateVersion: number | null }>
  reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>
  richMenuAreas: Array<{ groupId: string; groupName: string; pageName: string; areaId: string; label: string | null }>
  trackedLinks: Array<{ id: string; name: string }>
  broadcasts: Array<{ broadcastId: string; title: string; status: string; scheduledAt: string | null; templateVersionNumber: number | null; referenceMode: 'fixed' | 'latest' }>
  reminderEnrollments?: Array<{ enrollmentId: string; reminderId: string; reminderName: string; versionNumber: number; enrollmentStatus: string; targetDate: string }>
}

interface PendingDelete {
  item: Template
  /** 削除対象を選んだ時点のアカウント。切替後に古い対象を消さないために固定する。 */
  accountId: string | null
}

/** 「よく使う絞り込み」の選ぶ欄。一覧の手元のデータで数えられるものだけ。 */
const SAVED_FILTER_OPTIONS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'used', label: '使っている所がある' },
  { value: 'draft-changes', label: '未公開の変更あり' },
  { value: 'draft-only', label: '下書きだけ' },
]

const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20件表示' },
  { value: '50', label: '50件表示' },
  { value: '100', label: '100件表示' },
]

const NO_MANAGE_NOTE =
  'テンプレートの作成・変更・削除はオーナーと管理者だけができます。一覧と中身の閲覧はこのまま使えます。'

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
  {
    key: 'message',
    title: 'メッセージ',
    icon: MessageSquare,
    desc: 'テキスト・カード型・画像。差し込みも使える',
    useFor: 'いちばんよく使う',
    cannot: 'できない：答えを集める（→ 質問・リサーチ）',
    href: '/templates/edit',
  },
  {
    key: 'card_message',
    title: 'カルーセル',
    icon: GalleryHorizontalEnd,
    desc: '横にめくるカードを最大10枚',
    useFor: '商品の紹介に',
    cannot: 'できない：1枚の画像を面に分ける（→ リッチメッセージ）',
    href: '/templates/carousel',
  },
  {
    key: 'rich_message',
    title: 'リッチメッセージ',
    icon: ImageIcon,
    desc: '1枚の画像を面に分けて、押すと動く',
    useFor: 'キャンペーンの告知に',
    cannot: 'できない：文字だけの本文（→ メッセージ）',
    href: '/templates/edit?kind=rich_message',
  },
  {
    key: 'question',
    title: '質問',
    icon: HelpCircle,
    desc: 'ボタンで答えてもらい、答えでタグなどを付ける',
    useFor: '好みを聞くときに',
    cannot: 'できない：何問も続けて聞く（→ リサーチ）',
    href: '/templates/questions/new',
  },
  {
    key: 'coupon',
    title: 'クーポン',
    icon: Ticket,
    desc: '期間・回数・抽選を決めて配る',
    useFor: '来店・購入のきっかけに',
    cannot: 'できない：本文を自由に組む（→ メッセージ）',
    href: '/templates/edit?kind=coupon',
  },
  {
    key: 'research',
    title: 'リサーチ',
    icon: ClipboardList,
    desc: 'いくつかの質問にまとめて答えてもらう',
    useFor: '満足度調査に',
    cannot: 'できない：答えごとにタグを付ける（→ 質問）',
    href: '/templates/edit?kind=research',
  },
]

/** 検索欄と検索対象を、大小文字・全半角・空白の違いで外れない形へそろえる（v7 page.tsx と同じ）。 */
function normalizeTemplateSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim().replace(/\s+/gu, ' ')
}

/** M月D日（曜）。時刻は title で見せる。 */
function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return formatDay(date)
}

/** 一覧・検索は「いまの最新」を対象にする（R194：下書きがあれば下書き）。 */
function latestContentOf(t: Template): string {
  return t.draftMessageContent ?? t.messageContent
}

/** 公開の札（`v19Ivv`：公開中／未公開の変更／下書きだけ）。 */
function publishStateOf(t: Template): { label: string; className: string } {
  if (t.publishedAt == null) {
    return { label: '下書きだけ', className: styles.publishPillDraftOnly }
  }
  if (t.hasDraft) {
    return { label: '未公開の変更', className: styles.publishPillDraftChanges }
  }
  return { label: '公開中', className: styles.publishPillLive }
}

/** 一斉配信の状態の札。予約済みは待っている途中、送信済みは終わり。 */
function broadcastStatusText(status: string): string {
  if (status === 'scheduled') return '予約済み'
  if (status === 'sending') return '送信中'
  if (status === 'sent') return '送信済み'
  return '下書き'
}

/** 「使っている所」の明細を、開ける画面への行へ並べる（v7 の差し替え先リストと同じ分け方）。 */
function usageRows(detail: UsageDetail) {
  return [
    ...detail.scenarioSteps.map((usage) => ({
      key: `scenario-${usage.stepId}`,
      href: `/scenarios/detail?id=${usage.scenarioId}`,
      label: `シナリオ「${usage.scenarioName}」${usage.stepOrder}通目`,
      icon: Workflow,
    })),
    ...detail.autoReplies.map((usage) => ({
      key: `auto-reply-${usage.id}`,
      href: `/auto-replies/edit?id=${usage.id}`,
      label: `自動応答「${usage.keyword}」の返信`,
      icon: MessageSquare,
    })),
    ...detail.automations.map((usage) => ({
      key: `automation-${usage.id}`,
      // 旧形式のオートメーション表の設定で、開ける画面が無い。
      href: null as string | null,
      label: usage.eventType === 'inbox_favorite'
        ? '受信箱の「よく使う」（担当3人が登録）'
        : `オートメーション「${usage.name}」（旧形式・画面からは開けません）`,
      icon: usage.eventType === 'inbox_favorite' ? Star : Bot,
    })),
    ...detail.reminderSteps.map((usage) => ({
      key: `reminder-${usage.stepId}`,
      href: `/reminders/edit?id=${usage.reminderId}`,
      label: `リマインダ「${usage.reminderName}」`,
      icon: Workflow,
    })),
    // R347: 旧公開版に固定された登録は版と状態を出す。消すと本文が控えに変わる。
    ...(detail.reminderEnrollments ?? []).map((usage) => ({
      key: `reminder-enrollment-${usage.enrollmentId}`,
      href: `/reminders/detail?id=${usage.reminderId}`,
      label: `リマインダ「${usage.reminderName}」第${usage.versionNumber}版（${usage.enrollmentStatus === 'cancelled' ? '取消ずみ' : '送信待ち'}）`,
      icon: Workflow,
    })),
    ...detail.richMenuAreas.map((usage) => ({
      key: `rich-menu-${usage.areaId}`,
      href: `/rich-menus/edit?id=${usage.groupId}`,
      label: `リッチメニュー「${usage.groupName}」${usage.pageName}`,
      icon: Star,
    })),
    ...detail.trackedLinks.map((usage) => ({
      key: `tracked-link-${usage.id}`,
      href: `/inflow-links/detail?id=${usage.id}`,
      label: `流入リンク「${usage.name}」`,
      icon: Workflow,
    })),
    // 467: 一斉配信の参照は送った時の版のまま固定される。先へ行って差し替える。
    ...(detail.broadcasts ?? []).map((usage) => ({
      key: `broadcast-${usage.broadcastId}`,
      href: `/broadcasts/detail?id=${usage.broadcastId}`,
      label: `一斉配信「${usage.title}」（${broadcastStatusText(usage.status)}）`,
      icon: Send,
    })),
  ]
}

export default function TemplatesListV8() {
  usePageTitle('テンプレート')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  /*
   * N-144: 作成・編集・公開・削除は API が requireRole('owner','admin') で
   * 閉じている。staff へ操作を見せると押しても 403 になるだけなので、
   * 押せない形で出す（閲覧は残す）。
   */
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const [activeSection, setActiveSection] = useState<Section>('message')
  const [templates, setTemplates] = useState<Template[]>([])
  const [assetCounts, setAssetCounts] = useState<Partial<Record<BroadcastAssetKind, number>>>({})
  const [loading, setLoading] = useState(true)
  /** 一覧を読み込めなかった理由。取得失敗と権限不足を分ける。 */
  const [failure, setFailure] = useState<TemplatesFailure | null>(null)
  const [templateQuery, setTemplateQuery] = useState('')
  const [chips, setChips] = useState<Record<ChipKey, boolean>>({
    single: false,
    multiple: false,
    variables: false,
    unused: false,
  })
  const [savedFilter, setSavedFilter] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

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

  const [moveError, setMoveError] = useState('')

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
    // フォルダはアカウント単位。切り替えたら前のアカウントの帯も選択も残さない（N-147）。
    setFolders([])
    setUnfiledCount(null)
    setSelectedCategory('all')
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
    setPage(1)
  }, [selectedAccountId])

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
      if (res.success) {
        setTemplates(res.data as Template[])
      } else {
        setFailure(failureOfResponse())
      }
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

  /* PERF-04: 種類タブの件数は集計専用の口で取る（v7 と同じ）。 */
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

  /** フォルダを読み直す。並び順は API の displayOrder に従う。アカウント単位。 */
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
      if (res.success && res.data) {
        setBlockedUsage(res.data as UsageDetail)
      } else {
        setBlockedLoadError(true)
      }
    }).catch(() => {
      if (cancelled) return
      setBlockedLoadError(true)
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

  /*
   * 本文は最大5万字あり、一覧はページングされていない。入力のたびに全本文を
   * NFKC変換すると重いので、templates が替わったときだけ検索索引を作る
   * （v7 と同じ判断）。
   */
  const templateSearchIndex = useMemo(() => tabItems.map((template) => ({
    template,
    normalizedSearchText: [template.name, template.messageContent, template.draftMessageContent ?? '']
      .map(normalizeTemplateSearchText)
      .join('\0'),
  })), [tabItems])
  const normalizedTemplateQuery = useMemo(
    () => normalizeTemplateSearchText(templateQuery),
    [templateQuery],
  )

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
    return [t]
  }), [normalizedTemplateQuery, selectedCategory, templateSearchIndex, chips, savedFilter])

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
    setTemplateQuery('')
    setSelectedCategory('all')
    setChips({ single: false, multiple: false, variables: false, unused: false })
    setSavedFilter('')
    setPage(1)
  }

  const toggleChip = (key: ChipKey) => {
    setChips((current) => {
      const next = { ...current, [key]: !current[key] }
      // 「1通のみ」と「複数通」は同時に選べない（どちらかに絞る札）。
      if (key === 'single' && next.single) next.multiple = false
      if (key === 'multiple' && next.multiple) next.single = false
      return next
    })
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filteredTemplates.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const shownItems = filteredTemplates.slice((safePage - 1) * pageSize, safePage * pageSize)

  // 絞り込みや件数の変更でページが溢れたら先頭へ戻す。
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  // 一覧に何を出すか。**読込中・取得失敗・権限不足・空・0件を混ぜない。**
  const view = listView({
    loading,
    failure,
    total: tabItems.length,
    matched: filteredTemplates.length,
  })
  const createBlocked = createBlockedReason({ loading, failure })

  /* ===== 数の帯（このタブのテンプレートから） ===== */
  const ready = view === 'ready' || view === 'empty' || view === 'no-match'
  const draftChanges = tabItems.filter((t) => t.hasDraft && t.publishedAt != null).length
  const usageAllKnown = tabItems.every((t) => typeof t.usageCount === 'number')
  const usageTotal = usageAllKnown ? tabItems.reduce((sum, t) => sum + t.usageCount, 0) : null
  const monthlyAllKnown = tabItems.every((t) => typeof t.monthlySendCount === 'number')
  const monthlyTotal = monthlyAllKnown
    ? tabItems.reduce((sum, t) => sum + (t.monthlySendCount ?? 0), 0)
    : null
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
      icon: Workflow,
      value: ready ? usageTotal : null,
      unit: 'か所',
      detail: ready
        ? usageTotal === null
          ? '使っている所を確認できません'
          : '一斉配信・自動応答・シナリオなど'
        : '—',
    },
    {
      key: 'monthly',
      title: '今月送った数',
      icon: Send,
      value: ready ? monthlyTotal : null,
      unit: '通',
      detail: ready
        ? monthlyTotal === null
          ? '送信数を確認できません'
          : 'このタブのテンプレートから'
        : '—',
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
  const selectedTemplates = templates.filter((t) => selectedIds.has(t.id))
  /** まとめて削除は「使っていない」ものだけ。使用中が混ざると止める。 */
  const removableSelected = selectedTemplates.filter((t) => t.usageCount === 0)
  const usedSelectedCount = selectedTemplates.length - removableSelected.length

  /* ===== 操作 ===== */

  /** 行の編集先。質問とそうでないもので作る画面が分かれる（v7 と同じ分岐）。 */
  const editHref = (t: Template) =>
    t.question
      ? `/templates/questions/new?id=${encodeURIComponent(t.id)}`
      : `/templates/edit?id=${encodeURIComponent(t.id)}`
  const detailHref = (t: Template) => `/templates/detail?id=${encodeURIComponent(t.id)}`

  /**
   * 並び順を入れ替える（フォルダ）。隣と番号を交換するのは v7 と同じ。
   */
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

  // 押しただけでは消さない。窓を開くだけ。使用中なら「使っている所」の窓へ。
  const handleDelete = (t: Template) => {
    setDeleteError('')
    if (t.usageCount > 0) {
      setBlockedDelete({ item: t, accountId: selectedAccountId })
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
      // R195: 件数（未分類・フォルダ別）はフォルダ側の集計が持つので両方読み直す。
      await Promise.all([load(), loadFolders()])
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /** フォルダへ移す（1件でもまとめてでも同じ窓）。 */
  const openMove = (ids: string[]) => {
    setMoveIds(ids)
    setMoveDraft('')
    setMoveError('')
  }
  /*
   * フォルダへ移す（1件でもまとめてでも同じ窓）。窓を閉じた瞬間に画面へ
   * 映し、保存は5秒後に送る。「元に戻す」で止めたら送らない。
   */
  const runMove = () => {
    if (!moveIds) return
    const targetIds = moveIds
    const targetFolderId = moveDraft === '' ? null : moveDraft
    const previousFolders = new Map(templates.map((t) => [t.id, t.folderId]))
    const folderName = targetFolderId === null
      ? '未分類'
      : (folders.find((f) => f.id === targetFolderId)?.name ?? 'フォルダ')
    setTemplates((rows) =>
      rows.map((t) => (targetIds.includes(t.id) ? { ...t, folderId: targetFolderId } : t)),
    )
    setMoveIds(null)
    setSelectedIds(new Set())
    setMoveError('')
    const restore = () => {
      setTemplates((rows) =>
        rows.map((t) => (previousFolders.has(t.id) ? { ...t, folderId: previousFolders.get(t.id) ?? null } : t)),
      )
    }
    runUndoable({
      message: `${targetIds.length}件を「${folderName}」へ移しました`,
      commit: async () => {
        for (const id of targetIds) {
          const result = await api.templates.update(id, { folderId: targetFolderId })
          if (!result.success) throw new Error(result.error ?? 'move_failed')
        }
      },
      undo: restore,
      onCommitError: () => {
        restore()
        void Promise.all([load(), loadFolders()])
      },
      failureMessage: 'フォルダへ移せませんでした。元のフォルダに戻しています。',
      onCommitted: () => {
        void Promise.all([load(), loadFolders()])
      },
    })
  }

  /*
   * 複製（行の「…」→「複製する」）。複製の口は無いので、同じ内容で新しく作る。
   * コピーは「下書き」で作る（公開は別の操作）。最新の本文（下書きがあれば
   * 下書き）を写す。
   */
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

  /* ===== 行の「…」 ===== */
  const rowMenuItems = (t: Template): ActionMenuItem[] => {
    const readonly = !canMutateTemplates
    const items: ActionMenuItem[] = [
      {
        id: 'edit',
        label: '編集する',
        disabled: readonly,
        disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
        onSelect: () => router.push(editHref(t)),
      },
      {
        id: 'usage',
        label: '使っている所を見る',
        external: true,
        onSelect: () => router.push(detailHref(t)),
      },
      {
        id: 'broadcast',
        label: '一斉配信で使う',
        onSelect: () =>
          window.location.assign(`/broadcasts/new?templateId=${encodeURIComponent(t.id)}`),
      },
      {
        id: 'duplicate',
        label: '複製する',
        icon: <Copy size={14} aria-hidden="true" />,
        disabled: readonly,
        disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
        onSelect: () => {
          setDuplicateError('')
          setDuplicateTarget(t)
        },
      },
      {
        id: 'move',
        label: 'フォルダへ移す',
        icon: <FolderIcon size={14} aria-hidden="true" />,
        disabled: readonly,
        disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
        onSelect: () => openMove([t.id]),
      },
    ]
    items.push({
      id: 'delete',
      label: '削除する',
      tone: 'danger',
      dividerBefore: true,
      disabled: readonly,
      disabledReason: readonly ? NO_MANAGE_NOTE : undefined,
      onSelect: () => handleDelete(t),
    })
    return items
  }

  /* ===== フォルダの列 ===== */
  const folderRows: FolderPanelRow[] = [
    {
      id: 'all',
      label: 'すべて',
      count: view === 'ready' || view === 'empty' || view === 'no-match' ? tabItems.length : null,
    },
    ...folders.map((folder, index) => ({
      id: folder.id,
      label: folder.name,
      // フォルダ件数は API(itemCount) をそのまま出す。来ないときは null。
      count: folder.itemCount ?? null,
      color: folder.color,
      qaOpen: canMutateTemplates && folder.name === '予約' ? 'CzndJ' : undefined,
      onEdit: canMutateTemplates ? () => setEditingFolder(folder) : undefined,
      // 端の行には口を出さない。押せない矢印を置かない。
      onMoveUp: canMutateTemplates && index > 0 ? () => void moveFolder(index, -1) : undefined,
      onMoveDown: canMutateTemplates && index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
      onDelete: canMutateTemplates ? () => setDeletingFolder(folder) : undefined,
      deleteNote: '削除しても、中のテンプレートは未分類に残ります。',
    })),
    {
      id: 'unfiled',
      label: '未分類',
      count: view === 'ready' || view === 'empty' || view === 'no-match' ? unfiledCount : null,
    },
  ]
  const folderSelectOptions = [
    { value: 'all', label: 'フォルダ：すべて' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
    { value: 'unfiled', label: '未分類' },
  ]

  const openPicker = () => setPickerOpen(true)
  const createButton = (className?: string) => (
    <Button
      type="button"
      variant="primary"
      className={className}
      disabled={!canMutateTemplates || createBlocked !== null}
      title={
        !canMutateTemplates ? NO_MANAGE_NOTE : createBlocked ?? undefined
      }
      onClick={openPicker}
    >
      ＋ テンプレートを作る
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
      addFolderDisabled={!canMutateTemplates}
      addFolderTitle={!canMutateTemplates ? NO_MANAGE_NOTE : undefined}
      rows={folderRows}
    >
      {/*
        補助のデータ（フォルダ）だけ取れないときは、その場所に小さく1行だけ。
        赤字にしない。一覧は普通に出す。
      */}
      {folderError ? <p role="alert" className={styles.folderNote}>{folderError}</p> : null}
      <p className={styles.folderNote}>
        フォルダは種類のタブをまたいで使えます。消しても、中のテンプレートは未分類に残ります。
      </p>
    </FolderPanel>
  )

  /* ===== 一覧の中身（`susGP`：読込中・読み込めない・空・0件を分ける） ===== */
  const sectionWord = activeSection === 'question' ? '質問のテンプレート' : 'メッセージのテンプレート'
  /* 見出しは本物と骨組みで同じものを出す（二重に書かない）。 */
  const templateTableColumns = (
    <colgroup>
      <col style={{ width: 40 }} />
      <col />
      <col style={{ width: 104 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 96 }} />
      <col style={{ width: 96 }} />
      <col style={{ width: 84 }} />
      <col style={{ width: 44 }} />
    </colgroup>
  )
  const templateTableHead = (
    <thead>
      <tr>
        <th className={styles.selectCell} aria-label="選択">
          <Checkbox
            checked={allOnPageSelected}
            indeterminate={!allOnPageSelected && selectedCount > 0}
            onCheckedChange={() => toggleAllOnPage()}
            aria-label="このページのテンプレートをすべて選択"
          />
        </th>
        <th>テンプレート</th>
        <th>種類</th>
        <th>公開</th>
        <th>使っている所</th>
        <th>今月送った数</th>
        <th>更新</th>
        <th aria-label="操作" />
      </tr>
    </thead>
  )
  /* 出来上がりの表と同じ幅・高さの骨組み。入れ替わってもガタつかない。 */
  const tableSkeleton = (
    <div className={styles.tableWrap} aria-hidden="true">
      <table className={styles.table}>
        {templateTableColumns}
        {templateTableHead}
        <tbody>
          {[0, 1, 2, 3, 4].map((i) => (
            <tr key={i}>
              <td><Skeleton width={18} height={18} /></td>
              <td>
                <span className="block">
                  <Skeleton width="70%" height={14} />
                </span>
                <span className="mt-1 block">
                  <Skeleton width="100%" height={12} />
                </span>
              </td>
              <td><Skeleton width={64} height={22} /></td>
              <td><Skeleton width={72} height={22} /></td>
              <td><Skeleton width="100%" height={14} /></td>
              <td><Skeleton width={56} height={14} /></td>
              <td><Skeleton width="100%" height={14} /></td>
              <td><Skeleton width={20} height={20} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const listLoading = (accountLoading || view === 'loading') && templates.length === 0 && view !== 'error' && view !== 'forbidden'
  const listBody = listLoading ? (
    <DelayedSkeleton loading skeleton={tableSkeleton} />
  ) : !selectedAccountId ? (
    <div className={styles.stateCard}>
      <span className={styles.stateIcon}>
        <FileText size={18} aria-hidden="true" />
      </span>
      <p className={styles.stateTitle}>
        {accounts.length > 0
          ? '上のバーでLINE公式アカウントを選んでください'
          : 'LINE公式アカウントが登録されていません'}
      </p>
    </div>
  ) : view === 'forbidden' || view === 'error' ? (
    <div className={styles.stateCard}>
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
    filterActive ? (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <SearchIcon size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>条件に合うテンプレートはありません</p>
        <p className={styles.stateDesc}>
          「1通のみ」「差し込みあり」「使っていない」や検索を外すと、すべて出ます。
        </p>
        <Button type="button" variant="secondary" onClick={clearFilters}>
          <X size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
          条件を外す
        </Button>
      </div>
    ) : (
      <div className={styles.stateCard}>
        <span className={styles.stateIcon}>
          <FileText size={18} aria-hidden="true" />
        </span>
        <p className={styles.stateTitle}>まだ{sectionWord}はありません</p>
        <p className={styles.stateDesc}>
          よく送る文を保存しておくと、一斉配信・自動応答・シナリオから選べます。
        </p>
        {canMutateTemplates ? (
          <Button type="button" variant="primary" onClick={openPicker}>
            ＋ テンプレートを作る
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled title={NO_MANAGE_NOTE}>
            ＋ テンプレートを作る
          </Button>
        )}
      </div>
    )
  ) : (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          {templateTableColumns}
          {templateTableHead}
          <tbody>
            {shownItems.map((t) => {
              const publish = publishStateOf(t)
              const kindLabel = t.question ? 'question' : t.messageType
              return (
                <tr
                  key={t.id}
                  className={styles.rowClick}
                  tabIndex={0}
                  onClick={() => router.push(detailHref(t))}
                  onKeyDown={(event) => {
                    // 行内のリンク・ボタンにフォーカスがあるときは行を開かない。
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      router.push(detailHref(t))
                    }
                  }}
                >
                  <td className={styles.selectCell} onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(t.id)}
                      onCheckedChange={() => toggleOne(t.id)}
                      aria-label={`「${t.name}」を選択`}
                    />
                  </td>
                  <td>
                    <Link
                      href={detailHref(t)}
                      title={t.name}
                      className={styles.cellTitle}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {t.name}
                    </Link>
                    {/* R194: 抜粋は最新（下書きがあれば下書き）。 */}
                    <p className={styles.cellSub}>
                      {latestContentOf(t).slice(0, 60)}
                      {latestContentOf(t).length > 60 ? '…' : ''}
                    </p>
                  </td>
                  <td>
                    <span className={styles.kindBadge}>{messageTypeText(kindLabel)}</span>
                  </td>
                  <td>
                    <span className={`${styles.publishPill} ${publish.className}`}>
                      {publish.label}
                    </span>
                  </td>
                  <td>
                    {typeof t.usageCount !== 'number' ? (
                      <span className={styles.usageNone}>使っている所を確認できません</span>
                    ) : t.usageCount === 0 ? (
                      <span className={styles.usageNone}>なし</span>
                    ) : (
                      <Link
                        href={detailHref(t)}
                        className={styles.usageLink}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {formatNumber(t.usageCount)}か所
                      </Link>
                    )}
                  </td>
                  <td className={styles.countCell}>
                    {typeof t.monthlySendCount === 'number' ? (
                      <span
                        className={styles.countMain}
                        title={
                          typeof t.totalSendCount === 'number'
                            ? `累計 ${formatNumber(t.totalSendCount)}通`
                            : undefined
                        }
                      >
                        {formatNumber(t.monthlySendCount)}<span className={styles.kpiUnit}>通</span>
                      </span>
                    ) : (
                      <span className={styles.usageNone}>—</span>
                    )}
                  </td>
                  <td className={styles.dateCell} title={formatDateTime(t.updatedAt)}>
                    {formatDate(t.updatedAt)}
                  </td>
                  <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.menuButton}
                      title={`テンプレート「${t.name}」の操作`}
                      aria-expanded={openMenuId === t.id}
                      onClick={() => setOpenMenuId((current) => (current === t.id ? null : t.id))}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    <ActionMenu
                      open={openMenuId === t.id}
                      onClose={() => setOpenMenuId(null)}
                      ariaLabel={`テンプレート「${t.name}」の操作`}
                      items={rowMenuItems(t)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* まとめての帯（選ぶと表の下に出る）：フォルダへ移す・削除。 */}
      {selectedCount > 0 ? (
        <div className={styles.bulkRow} role="region" aria-label="選択中のまとめ操作">
          <span className={styles.bulkCount}>{selectedCount}件を選択中</span>
          <Button
            type="button"
            variant="secondary"
            disabled={!canMutateTemplates}
            title={!canMutateTemplates ? NO_MANAGE_NOTE : undefined}
            onClick={() => openMove([...selectedIds])}
          >
            <FolderIcon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            フォルダへ移す
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canMutateTemplates || bulkDeleting || removableSelected.length === 0}
            title={
              !canMutateTemplates
                ? NO_MANAGE_NOTE
                : usedSelectedCount > 0
                  ? '使っているテンプレートが選ばれています。先に使用先を差し替えてください'
                  : undefined
            }
            onClick={() => {
              setBulkDeleteError('')
              setPendingBulkDelete(removableSelected)
            }}
          >
            <Trash2 size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            まとめて削除
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSelectedIds(new Set())}>
            選択を外す
          </Button>
        </div>
      ) : null}

      <p className={styles.footNote}>
        □ で選ぶと、下に「フォルダへ移す・まとめて削除」の帯が出ます。行を押すと詳細。「…」に 編集・使っている所・一斉配信・複製・削除。「公開」の札は 公開中・未公開の変更・下書きだけ の3つです。
      </p>

      <div className={styles.pagerRow}>
        <span className={styles.pagerCount}>
          {filteredTemplates.length === 0 ? 0 : (safePage - 1) * pageSize + 1}〜{Math.min(safePage * pageSize, filteredTemplates.length)} / {formatNumber(filteredTemplates.length)}件
        </span>
        {pageCount > 1 ? (
          <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} />
        ) : null}
      </div>
    </>
  )

  const isTemplateSection = activeSection === 'message' || activeSection === 'question'

  return (
    <div className={styles.board}>
      {/*
        骨格の印（data-design）は v7 の page.tsx 側が担う。ここへ別の節名を
        足すと、設計と画面の対を調べる design-structure の検査が
        V7＋V8 の和集合で見えてしまい、どちらの設計とも一致しなくなる。
      */}
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>テンプレート</h2>
          <p className={styles.headDescription}>
            一斉配信・自動応答・シナリオなどで使う、メッセージのひな形です。直して公開すると、使っている所に反映されます。
          </p>
        </div>
      </div>

      {/* 種類のタブ（件数つき）。資産タブはそれぞれの素材一覧を出す。 */}
      <Tabs
        label="テンプレートの種類"
        items={[
          {
            label: 'メッセージ',
            count: loading ? undefined : templates.filter((t) => !t.question).length,
            current: activeSection === 'message',
            onClick: () => { setActiveSection('message'); setPage(1); setSelectedIds(new Set()) },
          },
          {
            label: 'カルーセル',
            count: assetCounts.card_message,
            current: activeSection === 'card_message',
            onClick: () => setActiveSection('card_message'),
          },
          {
            label: 'リッチメッセージ',
            count: assetCounts.rich_message,
            current: activeSection === 'rich_message',
            onClick: () => setActiveSection('rich_message'),
          },
          {
            label: '質問',
            count: loading ? undefined : templates.filter((t) => Boolean(t.question)).length,
            current: activeSection === 'question',
            onClick: () => { setActiveSection('question'); setPage(1); setSelectedIds(new Set()) },
          },
          {
            label: 'クーポン',
            count: assetCounts.coupon,
            current: activeSection === 'coupon',
            onClick: () => setActiveSection('coupon'),
          },
          {
            label: 'リサーチ',
            count: assetCounts.research,
            current: activeSection === 'research',
            onClick: () => setActiveSection('research'),
          },
        ]}
      />

      {isTemplateSection ? (
        <>
          {/* 数の帯 4つ（このタブのテンプレートから）。 */}
          <div className={styles.kpis}>
            {kpis.map((kpi) => (
              <div key={kpi.key} className={styles.kpi}>
                <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
                <p className={styles.kpiValue}>
                  {kpi.value === null ? '—' : formatNumber(kpi.value)}
                  <span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span>
                </p>
                <p className={styles.kpiDetail}>{kpi.detail}</p>
              </div>
            ))}
          </div>

          <div className={styles.split}>
            {/* 左のフォルダの列。いちばん上は「テンプレートを作る」。 */}
            <div className={styles.folderCol}>
              {createButton('v8-folder-create')}
              {folderPanel}
            </div>

            <div className={styles.listCol}>
              {/* 道具の段：検索・札 4 つ・よく使う絞り込み・件数。
                  狭い板では「作る」とフォルダ選びがここへ畳まれる。 */}
              <div className={styles.toolbar}>
                {createButton(styles.toolbarCreate)}
                <div className={styles.folderSelectWrap}>
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
                <div className={styles.searchWrap}>
                  <SearchField
                    aria-label="テンプレートを検索"
                    placeholder="名前・本文・差し込みで探す"
                    value={templateQuery}
                    onChange={(value) => {
                      setTemplateQuery(clampSearchQuery(value))
                      setPage(1)
                    }}
                    onClear={() => setTemplateQuery('')}
                  />
                </div>
                <FilterChip
                  selected={chips.single}
                  onChange={() => toggleChip('single')}
                  title="1つのメッセージだけのテンプレート"
                >
                  1通のみ
                </FilterChip>
                <FilterChip
                  selected={chips.multiple}
                  onChange={() => toggleChip('multiple')}
                  title="複数のメッセージに分かれるテンプレート"
                >
                  複数通
                </FilterChip>
                <FilterChip
                  selected={chips.variables}
                  onChange={() => toggleChip('variables')}
                  title="名前や情報を差し込むテンプレート"
                >
                  {'{}'} 差し込みあり
                </FilterChip>
                <FilterChip
                  selected={chips.unused}
                  onChange={() => toggleChip('unused')}
                  title="どこからも使われていないテンプレート"
                >
                  使っていない
                </FilterChip>
                <span className={styles.toolbarSpacer} />
                <Select
                  aria-label="よく使う絞り込み"
                  value={savedFilter}
                  onChange={(value) => {
                    setSavedFilter(value)
                    setPage(1)
                  }}
                  options={SAVED_FILTER_OPTIONS}
                />
                <Select
                  aria-label="1ページに出す件数"
                  value={String(pageSize)}
                  onChange={(value) => {
                    setPageSize(Number(value))
                    setPage(1)
                  }}
                  options={PAGE_SIZE_OPTIONS}
                />
              </div>

              <div aria-busy={listLoading || undefined}>
                {listBody}
              </div>
            </div>
          </div>
        </>
      ) : canMutateTemplates ? (
        /*
         * 資産タブ（カルーセル・リッチメッセージ・クーポン・リサーチ）。
         * 中身の管理は既存の部品のまま。タブと数の帯の骨格だけ V8 に載せる。
         */
        <BroadcastAssetManager kind={activeSection} onChanged={() => void loadAssetCounts()} />
      ) : (
        <div>
          <p className="text-ink-faint text-xs mb-3">
            カルーセル・リッチメッセージ・クーポン・リサーチの作成・変更・削除はオーナーと管理者だけができます。一覧の閲覧はこのまま使えます。
          </p>
          <StaffAssetList kind={activeSection} />
        </div>
      )}

      {/* 種類を選ぶ窓（`R9XUMr`）。見本は足さない（仕様：新機能のため後で提案）。 */}
      <Dialog
        open={pickerOpen}
        title="どの種類を作りますか"
        designNode="R9XUMr"
        onCancel={() => setPickerOpen(false)}
        footer={
          <div className={styles.pickerFooter}>
            <Button type="button" variant="secondary" onClick={() => setPickerOpen(false)}>
              キャンセル
            </Button>
          </div>
        }
      >
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
              <p className={styles.kindTitle}>{card.title}</p>
              <p className={styles.kindDesc}>{card.desc}</p>
              <span className={styles.kindMeta}>
                <span className={styles.kindMetaLine}>{card.useFor}</span>
                <span className={styles.kindMetaLine}>{card.cannot}</span>
              </span>
            </button>
          ))}
        </div>
      </Dialog>

      {/* 削除の確認窓（`V6JFnd`：使っていないテンプレート）。 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`テンプレート「${pendingDelete?.item.name ?? ''}」を削除しますか？`}
        description={templateDeleteDescription(pendingDelete?.item.usageCount ?? 0)}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deleting) return
          setPendingDelete(null)
          setDeleteError('')
        }}
      >
        {pendingDelete !== null && pendingDelete.accountId !== selectedAccountId ? (
          <p className="text-danger text-sm leading-relaxed" role="alert">
            アカウントが切り替わりました。削除するテンプレートを選び直してください。
          </p>
        ) : null}
      </ConfirmDialog>

      {/* まとめて削除の確認窓。対象は「使っていない」ものだけ（使用中は帯の側で弾く）。 */}
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
        tone="destructive"
        title={`テンプレート「${blockedDelete?.item.name ?? ''}」は削除できません`}
        description="先に使用先を1か所ずつ開いて、別のテンプレートへ差し替えてください。差し替えが終わるまで、このテンプレートは一覧に残ります。"
        designNode="Z0g3si"
        titleIcon={<TriangleAlert size={22} />}
        onCancel={() => {
          setBlockedDelete(null)
          setBlockedUsage(null)
        }}
        footer={
          <div className={styles.pickerFooter}>
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
          </div>
        }
      >
        {blockedLoading ? (
          <p className="text-ink-faint text-xs">使用先を読み込んでいます…</p>
        ) : blockedLoadError ? (
          // 消してよいか分からないのに消させない。読み直しだけ置く。
          <p className="text-danger text-xs" role="alert">
            使っている所を確認できませんでした。閉じてから、もう一度お試しください。
          </p>
        ) : blockedUsage ? (
          <ul className={styles.usageList}>
            {usageRows(blockedUsage).map(({ key, label, href, icon: Icon }) => (
              <li key={key}>
                {href ? (
                  <Link href={href} className={styles.usageItem}>
                    <Icon size={15} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{label}</span>
                    <ArrowRight size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
                  </Link>
                ) : (
                  <span className={styles.usageItemStatic}>
                    <Icon size={15} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{label}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Dialog>

      {/* フォルダへ移すの窓。1件でもまとめてでも同じ形。 */}
      <ConfirmDialog
        open={moveIds !== null}
        title={
          moveIds && moveIds.length === 1
            ? `「${templates.find((t) => t.id === moveIds[0])?.name ?? ''}」のフォルダを移す`
            : `${moveIds?.length ?? 0}件のテンプレートをフォルダへ移す`
        }
        description="移動先のフォルダを選んでください。「未分類」を選ぶとフォルダから外れます。"
        confirmLabel="移動する"
        error={moveError}
        onConfirm={() => runMove()}
        onCancel={() => {
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

      {/*
        フォルダを消す前に、中身がどうなるかを本文で読ませる
        （「中のテンプレートは未分類に残ります」）。
      */}
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
    </div>
  )
}
