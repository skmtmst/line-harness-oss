'use client'

import SelectField from '@/components/shared/select-field'
import { useDeferredValue, useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import type { RichMenuDeleteImpact, RichMenuTapStats } from '@/lib/api'
import type { Folder } from '@line-crm/shared'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { TableHeadRow, Th } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  audienceReason,
  audienceText,
  blockerTexts,
  canDelete as canDeleteImpact,
  impactMatchesRequest,
  impactFromError,
  nextDisplayText,
  recommendedActionText,
  referenceKindText,
  sameDeleteImpactRequest,
  type DeleteImpactRequest,
} from './delete-impact'
import {
  moveTargetingGroup,
} from './targeting-order'

/** フォルダに入れていないものを選ぶための、内部だけの値。 */
const UNFILED = '__unfiled__'

type SortKey = 'taps' | 'updated' | 'name' | 'priority'

type RichMenuAction = 'load' | 'reorder' | 'delete' | 'unpublish' | 'externalDelete' | 'import'

/** APIや通信の内部表現を、運用者が次の行動を選べる文へ置き換える。 */
function richMenuError(error: unknown, action: RichMenuAction): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'このLINEアカウントのリッチメニューを操作する権限がありません。'
    if (error.status === 404) return '対象のリッチメニューが見つかりません。一覧を読み直してください。'
    if (error.status === 409) {
      return action === 'delete' || action === 'externalDelete'
        ? '使用中のため削除できませんでした。表示先を確認してから、もう一度お試しください。'
        : 'ほかの変更と重なりました。一覧を読み直してから、もう一度お試しください。'
    }
    if (error.status === 429) return 'LINEへの操作が混み合っています。少し待ってから、もう一度お試しください。'
  }

  switch (action) {
    case 'load':
      return 'リッチメニューを読み込めませんでした。通信状態を確認して、もう一度読み込んでください。'
    case 'reorder':
      return 'リッチメニューの順番を変更できませんでした。一覧を読み直してから、もう一度お試しください。'
    case 'delete':
      return 'リッチメニューを削除できませんでした。状態を確認して、もう一度お試しください。'
    case 'unpublish':
      return 'リッチメニューをLINEから取り下げられませんでした。状態を確認して、もう一度お試しください。'
    case 'externalDelete':
      return 'LINE上のリッチメニューを削除できませんでした。LINEの状態を確認して、もう一度お試しください。'
    case 'import':
      return 'LINE上のリッチメニューを取り込めませんでした。LINEの状態を確認して、もう一度お試しください。'
  }
}

/**
 * よく使う絞り込み。
 *
 * 「よく使う」は、押された回数が多いものを指す。設計に語として入っているが、
 * 何をもって「よく使う」かは決まっていなかったので、**数えられるもの**で
 * 定義した。数えられない言葉を画面に置くと、押しても何も起きない。
 */
const SAVED_FILTERS: { key: string; label: string; note: string }[] = [
  { key: '', label: 'すべて', note: 'すべてのメニュー' },
  { key: 'published', label: '公開中', note: 'いまLINEで公開しているメニュー' },
  { key: 'scheduled', label: '予約', note: '公開日時を予約したメニュー' },
  { key: 'draft', label: '下書き', note: 'まだLINEで公開していないメニュー' },
  { key: 'targeting', label: '条件で出し分け', note: '出す相手の条件を指定したメニュー' },
]

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
  publishingAt: string | null
  isDefaultForAll: boolean
  targetingEnabled: boolean
  targetingCondition: string | null
  /** 複数の条件に当てはまったときに、実際に見る順番。小さいほど先。 */
  targetingPriority: number
  /** 159: フォルダ。分けていなければ null。 */
  folderId: string | null
  /** 160: 自分で決める並び順。 */
  displayOrder: number
  thumbnailR2Key: string | null
  monthlyStats?: {
    from: string
    to: string
    taps: number
    uniqueAudience: {
      value: number | null
      state: 'available' | 'partial' | 'unavailable'
      reason: 'preexisting_assignments_not_backfilled' | null
    }
  }
  createdAt: string
  updatedAt: string
}

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  const cls =
    status === 'published'
      ? 'bg-success-bg text-success'
      : 'bg-canvas-sunken text-ink-secondary'
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>
      {status === 'published' ? '公開中' : '下書き'}
    </span>
  )
}

type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  size: { width: number; height: number }
  areasCount: number
  areas?: Array<{
    bounds: { x: number | null; y: number | null; width: number | null; height: number | null }
    action: {
      type: string
      label: string | null
      url: string | null
      text: string | null
      displayText: string | null
      richMenuAliasId: string | null
      supported: boolean
      unsupportedReason: 'unsupported_or_incomplete_action' | null
    }
  }>
  isCurrentDefault: boolean
  adminManaged: boolean
  adminInfo: {
    groupId: string
    groupName: string
    pageName: string
    groupStatus: 'draft' | 'published'
  } | null
}

type DeleteTarget =
  | { kind: 'managed'; group: RichMenuGroupListItem }
  | { kind: 'external'; menu: LineMenu }

export default function RichMenusListPage() {
  const { selectedAccount } = useAccount()
  const [showExternal, setShowExternal] = useState(false)
  usePageTitle(showExternal ? '管理画面の外のメニューを取り込む' : 'リッチメニュー')
  const activeAccountRef = useRef<string | null>(selectedAccount?.id ?? null)
  const importRequestGenerationRef = useRef(0)
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [query, setQuery] = useState('')
  const [external, setExternal] = useState<{
    currentDefault: string | null
    lineMenus: LineMenu[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  /** 選んでいるフォルダ。空は「すべて」、UNFILED は「未分類」。 */
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [savedFilter, setSavedFilter] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [groupTotal, setGroupTotal] = useState(0)
  const [groupFacets, setGroupFacets] = useState<{
    total: number
    published: number
    targeting: number
    folderCounts: Record<string, number>
  } | null>(null)
  const [reordering, setReordering] = useState(false)
  const [tapStats, setTapStats] = useState<RichMenuTapStats | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  /*
    消したときの影響（契約 #608）。**窓を開けてから読む。**
    一覧を出すたびに全件ぶん読むと、消さない人にも重い問い合わせが走る。
  */
  const [impact, setImpact] = useState<RichMenuDeleteImpact | null>(null)
  const [impactPhase, setImpactPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /** アカウント・対象・開き直しの世代で、遅い応答を捨てる。 */
  const impactRequestRef = useRef<DeleteImpactRequest | null>(null)
  const impactRequestGenerationRef = useRef(0)
  /** 同じ窓の読み直しで、前の読み込み結果が後から上書きしないための世代。 */
  const impactLoadGenerationRef = useRef(0)
  const [importTarget, setImportTarget] = useState<LineMenu | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedMenuName, setImportedMenuName] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query.trim())

  useEffect(() => {
    activeAccountRef.current = selectedAccount?.id ?? null
    importRequestGenerationRef.current += 1
    setGroups([])
    setGroupTotal(0)
    setGroupFacets(null)
    setExternal(null)
    setTapStats(null)
    setError(null)
    setExternalError(null)
    setApplyTo(null)
    setDeleteTarget(null)
    setImportTarget(null)
    setImportBusy(false)
    setImportError(null)
    setImportedMenuName(null)
    setDeleteBusy(false)
    setDeleteError(null)
    impactRequestGenerationRef.current += 1
    impactLoadGenerationRef.current += 1
    impactRequestRef.current = null
    setImpact(null)
    setImpactPhase('idle')
    setPage(1)
    if (!selectedAccount?.id) setLoading(false)
  }, [selectedAccount?.id])

  const reload = useCallback(async () => {
    if (!selectedAccount?.id) {
      setLoading(false)
      return
    }
    const accountId = selectedAccount.id
    setLoading(true)
    setGroups([])
    setExternal(null)
    setTapStats(null)
    setError(null)
    setExternalError(null)
    try {
      // 並列に: D1 管理 group の一覧と、LINE 上の現状
      const [groupsRes, externalRes, tapRes] = await Promise.allSettled([
        api.richMenuGroups.listPage(accountId, {
          page: reordering ? 1 : page,
          limit: reordering ? 200 : pageSize,
          query: reordering ? '' : deferredQuery,
          folderId: reordering ? '' : folderFilter,
          filter: reordering ? '' : savedFilter,
          sort: reordering ? 'priority' : sortKey,
        }),
        api.richMenuGroups.external(accountId),
        api.richMenuGroups.tapStats(accountId),
      ])
      if (activeAccountRef.current !== accountId) return
      // 数が取れなくても一覧は出す。集計は付随情報なので、落ちても本体は止めない。
      setTapStats(
        tapRes.status === 'fulfilled' && tapRes.value.success ? tapRes.value.data : null,
      )
      if (groupsRes.status === 'fulfilled') {
        if (!groupsRes.value.success) throw new Error('load_failed')
        setGroups(groupsRes.value.data.items)
        setGroupTotal(groupsRes.value.data.total)
        setGroupFacets(groupsRes.value.data.facets ?? null)
      } else {
        throw groupsRes.reason
      }
      if (externalRes.status === 'fulfilled') {
        const v = externalRes.value
        if (v.success) {
          setExternal(v.data)
        } else {
          setExternalError('LINE上の状態を確認できませんでした。少し待ってから、もう一度読み込んでください。')
          setExternal(null)
        }
      } else {
        setExternalError('LINE上の状態を確認できませんでした。少し待ってから、もう一度読み込んでください。')
        setExternal(null)
      }
    } catch (e) {
      if (activeAccountRef.current === accountId) {
        setError(richMenuError(e, 'load'))
      }
    } finally {
      if (activeAccountRef.current === accountId) setLoading(false)
    }
  }, [deferredQuery, folderFilter, page, pageSize, reordering, savedFilter, selectedAccount?.id, sortKey])

  const loadFolders = useCallback(async () => {
    const res = await api.folders.list('rich_menu')
    if (res.success) setFolders(res.data)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])
  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const [reorderBusy, setReorderBusy] = useState(false)

  /** 1つ上／下と、友だちへ実際に出す優先順を入れ替える。 */
  async function moveGroup(group: RichMenuGroupListItem, delta: number) {
    // 実際の判定と同じ targetingPriority 順で全件を並べる。絞り込み中の
    // 画面だけを基準にすると、隠れているメニューとの優先関係が壊れる。
    const reordered = moveTargetingGroup(groups, group.id, delta === -1 ? -1 : 1)
    if (!reordered) return
    if (!selectedAccount) return
    setReorderBusy(true)
    try {
      // #502中: 全件ぶん PATCH を並列に投げない。1口で 0,1,2…へそろえる。
      // 途中失敗で順番が中途半端に残らない。古い同順位もこの1口で解消する。
      // displayOrder も同じ値へ寄せ、以前の「自分で決めた順」と食い違わせない。
      const res = await api.richMenuGroups.reorderPriorities(
        selectedAccount.id,
        reordered.map((item) => item.id),
      )
      if (!res.success) throw new Error(res.error ?? '並び替え失敗')
      await reload()
    } catch (e) {
      // **`alert()` では出さない。** 見た目がブラウザ任せで、画像比較にも
      // 写らない。画面の帯に出して、押したあとも読み返せるようにする。
      setError(richMenuError(e, 'reorder'))
    } finally {
      setReorderBusy(false)
    }
  }

  function beginImpactRequest(accountId: string, groupId: string): DeleteImpactRequest {
    const request = {
      accountId,
      groupId,
      generation: impactRequestGenerationRef.current + 1,
    }
    impactRequestGenerationRef.current = request.generation
    impactRequestRef.current = request
    return request
  }

  async function loadImpact(request: DeleteImpactRequest) {
    /*
      **遅れて返った別のメニューの結果を映さない。** Aを読み込み中に窓を
      閉じてBを開くと、あとから返るAの結果がBの窓に出る。表示とボタンの
      可否が別のメニューのものになる（サーバは削除時に確かめ直すので
      誤って消しはしないが、読んでいるものと押せるものが食い違う）。
    */
    const loadGeneration = impactLoadGenerationRef.current + 1
    impactLoadGenerationRef.current = loadGeneration
    setImpactPhase('loading')
    setImpact(null)
    try {
      const res = await api.richMenuGroups.deleteImpact(request.groupId)
      if (
        !sameDeleteImpactRequest(impactRequestRef.current, request)
        || impactLoadGenerationRef.current !== loadGeneration
      ) return
      if (!res.success) throw new Error('impact_failed')
      if (!impactMatchesRequest(res.data, request)) throw new Error('impact_scope_mismatch')
      setImpact(res.data)
      setImpactPhase('ready')
    } catch {
      if (
        !sameDeleteImpactRequest(impactRequestRef.current, request)
        || impactLoadGenerationRef.current !== loadGeneration
      ) return
      /*
        影響が読めないときは**消させない**。何が起きるか分からないまま
        取り消せない操作をさせるより、読み直してもらうほうがよい。
      */
      setImpactPhase('error')
    }
  }

  function handleDelete(group: RichMenuGroupListItem) {
    setDeleteError(null)
    setDeleteTarget({ kind: 'managed', group })
    if (!selectedAccount?.id) return
    const request = beginImpactRequest(selectedAccount.id, group.id)
    void loadImpact(request)
  }

  function handleDeleteExternal(menu: LineMenu) {
    if (!selectedAccount?.id) return
    setDeleteError(null)
    beginImpactRequest(selectedAccount.id, `external:${menu.richMenuId}`)
    setDeleteTarget({ kind: 'external', menu })
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return
    const request = impactRequestRef.current
    if (!request) return
    const action: RichMenuAction = deleteTarget.kind === 'managed'
      ? deleteTarget.group.status === 'published' ? 'unpublish' : 'delete'
      : 'externalDelete'
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      if (deleteTarget.kind === 'managed') {
        const res = deleteTarget.group.status === 'published'
          ? await api.richMenuGroups.unpublish(deleteTarget.group.id)
          : await api.richMenuGroups.delete(deleteTarget.group.id)
        if (!res.success) throw new Error('delete_failed')
      } else {
        if (!selectedAccount?.id) throw new Error('account_missing')
        const res = await api.richMenuGroups.deleteExternal(
          deleteTarget.menu.richMenuId,
          selectedAccount.id,
        )
        if (!res.success) throw new Error('delete_failed')
      }
      if (!sameDeleteImpactRequest(impactRequestRef.current, request)) return
      setDeleteTarget(null)
      await reload()
    } catch (e) {
      if (!sameDeleteImpactRequest(impactRequestRef.current, request)) return
      /*
        **409は「読んだあとに状態が変わった」。** Workerがその時点の影響を
        一緒に返すので、古い「消せます」を残さず描き直す。
      */
      if (e instanceof ApiError && e.status === 409) {
        const latest = impactFromError(e.data)
        if (latest && impactMatchesRequest(latest, request)) {
          setImpact(latest)
          setImpactPhase('ready')
        } else if (deleteTarget.kind === 'managed') {
          void loadImpact(request)
        }
      }
      setDeleteError(richMenuError(e, action))
    } finally {
      if (sameDeleteImpactRequest(impactRequestRef.current, request)) setDeleteBusy(false)
    }
  }

  function handleImport(menu: LineMenu) {
    if (!selectedAccount?.id) return
    setImportError(null)
    setImportTarget(menu)
  }

  async function confirmImport() {
    if (!selectedAccount?.id || !importTarget || importBusy) return
    const menu = importTarget
    const accountId = selectedAccount.id
    const requestGeneration = ++importRequestGenerationRef.current
    setImportBusy(true)
    setImportError(null)
    try {
      const res = await api.richMenuGroups.importFromLine(menu.richMenuId, accountId)
      if (
        importRequestGenerationRef.current !== requestGeneration ||
        activeAccountRef.current !== accountId
      ) return
      if (!res.success) throw new Error('import_failed')
      setImportTarget(null)
      setImportedMenuName(res.data?.name ?? menu.name)
      await reload()
    } catch (e) {
      if (
        importRequestGenerationRef.current !== requestGeneration ||
        activeAccountRef.current !== accountId
      ) return
      setImportError(richMenuError(e, 'import'))
    } finally {
      if (
        importRequestGenerationRef.current === requestGeneration &&
        activeAccountRef.current === accountId
      ) setImportBusy(false)
    }
  }

  // メニュー名とトークバーの文言を見る。名前だけだと、画面に出ている
  // 文言（chatBarText）で探せない。
  // 集計は多い順に並んでいる。先頭がいちばん押されたボタン。
  const topArea = tapStats?.byArea[0] ?? null
  const tapsByGroup = new Map((tapStats?.byGroup ?? []).map((g) => [g.groupId, g.taps]))
  const targetingCount = groupFacets?.targeting ?? 0
  const groupKpiState = !selectedAccount?.id
    ? 'unselected'
    : loading
      ? 'loading'
      : error
        ? 'error'
        : 'ready'
  const groupKpiReady = groupKpiState === 'ready'
  const groupKpiUnavailableText =
    groupKpiState === 'unselected'
      ? 'LINEアカウントを選ぶと表示します'
      : groupKpiState === 'loading'
        ? '読み込んでいます'
        : '一覧を取得できませんでした'

  const effectivePageSize = reordering ? 200 : pageSize
  const pageCount = Math.max(1, Math.ceil(groupTotal / effectivePageSize))
  const currentPage = Math.min(page, pageCount)
  const shownGroups = groups

  useEffect(() => {
    setPage(1)
  }, [folderFilter, pageSize, query, savedFilter, sortKey])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <main data-design-node="GO8RQ" className="mx-auto max-w-[1584px] p-6">
      <span hidden>メニュー名で検索・保存した条件・公開中のみ</span>
      {showExternal && selectedAccount ? (
        <div className="bg-canvas-sunken fixed top-14 right-0 bottom-0 left-64 z-40 overflow-y-auto p-6">
          <ExternalImportWorkspace
            external={external}
            loading={loading}
            error={externalError}
            onBack={() => setShowExternal(false)}
            onReload={() => void reload()}
            onImport={handleImport}
          />
        </div>
      ) : null}
      <div
        data-design="KPIs"
        hidden
        data-group-kpi-state={groupKpiState}
        className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">メニュー</p>
          <p className={`${groupKpiReady ? 'text-ink' : 'text-ink-faint'} mt-1 text-2xl font-bold tabular-nums`}>
            {groupKpiReady ? (groupFacets?.total ?? groupTotal) : '—'}
            {groupKpiReady && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {groupKpiReady
              ? `公開中 ${groupFacets?.published ?? '—'}`
              : `公開中 —・${groupKpiUnavailableText}`}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月のタップ</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${tapStats ? 'text-ink' : 'text-ink-faint'}`}>
            {tapStats ? tapStats.total : '—'}
            {tapStats && <span className="text-ink-faint ml-0.5 text-xs font-normal">回</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {tapStats ? 'ボタンが押された回数' : '集計を取れませんでした'}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">最多タップ</p>
          <p
            className={`mt-1 truncate text-2xl font-bold ${topArea ? 'text-ink' : 'text-ink-faint'}`}
            title={topArea?.label ?? undefined}
          >
            {topArea ? (topArea.label || '名前のないボタン') : '—'}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {topArea
              ? `${topArea.taps}回・タップ数の内訳は編集画面で見られます`
              : 'まだ押されていません'}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">出し分け</p>
          <p className={`${groupKpiReady ? 'text-ink' : 'text-ink-faint'} mt-1 text-2xl font-bold tabular-nums`}>
            {groupKpiReady ? targetingCount : '—'}
            {groupKpiReady && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {groupKpiReady
              ? targetingCount > 0
                ? 'タグ条件で自動的に切り替わります'
                : 'タグ条件で出し分けているメニューはありません'
              : groupKpiUnavailableText}
          </p>
        </div>
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <Button
          onClick={() => setFolderDialogOpen(true)}
        >
          フォルダを追加
        </Button>
        <Link
          href="/rich-menus/new"
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control inline-flex items-center gap-1 px-4 py-2 text-sm font-medium transition-colors"
        >
          メニューを作る
        </Link>
        <Button
          onClick={() => {
            // 並べ替え中は、実際の出し分け判定と同じ順番で全件を見せる。
            setSortKey('priority')
            setPage(1)
            setReordering((v) => !v)
          }}
          aria-pressed={reordering}
          variant={reordering ? 'primary' : 'secondary'}
        >
          {reordering ? '並び替えを終える' : '出す順番を変える'}
        </Button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メニュー名・ボタン名で検索"
          aria-label="メニュー名・ボタン名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <SelectField value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="並び順" options={[{ value: "priority", label: "出す順番（自分で決めた順）" }, { value: "taps", label: "タップ数が多い順" }, { value: "updated", label: "更新が新しい順" }, { value: "name", label: "名前順" }]} className="border-hairline rounded-control focus:ring-accent border px-2 py-2 text-sm focus:ring-2 focus:outline-none" />
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <SelectField
          size="compact"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          aria-label="表示件数"
          options={[{ value: '20', label: '20件表示' }, { value: '50', label: '50件表示' }, { value: '100', label: '100件表示' }]}
        />
      </div>

      <div className="bg-accent-soft text-ink-secondary mb-3 rounded-control px-3 py-2 text-xs leading-relaxed">
        上にあるものが優先されます。同じ友だちが複数のメニューに当てはまるときは、
        いちばん上の1つだけが出ます。
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs whitespace-nowrap">保存した検索</span>
        {SAVED_FILTERS.map((f) => {
          const on = savedFilter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setSavedFilter(on ? '' : f.key)}
              aria-pressed={on}
              title={f.note}
              className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
                on
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {f.label}
            </button>
          )
        })}
        <button
          type="button"
          data-qa-open="TL7tp"
          onClick={() => setShowExternal(true)}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-pill border px-3 py-1 text-xs transition-colors"
        >
          管理画面の外
        </button>
      </div>

      {!selectedAccount && (
        <div className="text-sm text-ink-faint">
          アカウントを選択してください。
        </div>
      )}

      {folderDialogOpen && (
        <FolderAddDialog
          kind="rich_menu"
          note="メニューを分けてしまう箱です。消しても、入っていたメニューは未分類として残ります。"
          placeholder="例: 01_会員向け"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {selectedAccount && (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <FolderPanel
            total={`${folders.length + 1}`}
            activeId={folderFilter}
            onSelect={setFolderFilter}
            rows={[
              { id: '', label: 'すべて', count: groupFacets?.total ?? groupTotal },
              ...folders.map((f) => ({
                id: f.id,
                label: f.name,
                count: groupFacets?.folderCounts[f.id] ?? 0,
                color: f.color,
              })),
              {
                id: UNFILED,
                label: '未分類',
                count: groupFacets?.folderCounts[UNFILED] ?? 0,
              },
            ]}
          >
            <p className="text-ink-faint text-xs leading-relaxed">
              フォルダを消しても、入っていたメニューは未分類として残ります。
            </p>
          </FolderPanel>
          <div className="min-w-0">
            {loading ? (
              <ListState kind="loading" title="読み込んでいます" description="このまま少しお待ちください。" />
            ) : error ? (
              <ListState
                kind="error"
                title="表示できませんでした"
                description="再読み込みしても直らないときは、エラー報告へお知らせください。"
                onRetry={() => void reload()}
              />
            ) : shownGroups.length === 0 ? (
              <ListState
                kind="empty"
                title="まだリッチメニューがありません"
                description="トークの下に出すメニューを作れます。"
                action={<Button href="/rich-menus/new" variant="primary">メニューを作る</Button>}
              />
            ) : (
              <section className="border-hairline bg-canvas rounded-card overflow-hidden border shadow-card">
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col style={{ width: '27%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '19%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '17%' }} />
                  </colgroup>
                  <thead>
                    <TableHeadRow>
                      <Th>メニュー</Th>
                      <Th>状態</Th>
                      <Th>誰に出るか</Th>
                      <Th align="right">今月のタップ</Th>
                      <Th>更新</Th>
                      <Th>操作</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-hairline divide-y">
                    {shownGroups.map((g) => (
                      <tr key={g.id} className="h-[76px] align-middle">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {reordering ? (
                              <div className="flex shrink-0 gap-1">
                                <button type="button" onClick={() => void moveGroup(g, -1)} disabled={reorderBusy} aria-label={`${g.name}を上へ`} className="border-hairline rounded-control border px-1.5 py-1 text-xs disabled:opacity-40">↑</button>
                                <button type="button" onClick={() => void moveGroup(g, 1)} disabled={reorderBusy} aria-label={`${g.name}を下へ`} className="border-hairline rounded-control border px-1.5 py-1 text-xs disabled:opacity-40">↓</button>
                              </div>
                            ) : null}
                            <div className="min-w-0">
                              <Link href={`/rich-menus/edit?id=${g.id}`} className="text-ink block truncate font-semibold hover:underline" title={g.name}>{g.name}</Link>
                              <p className="text-ink-faint mt-1 truncate text-xs" title={g.chatBarText}>
                                {g.size === 'large' ? '大 2500 × 1686px' : '小 2500 × 843px'}・ボタン「{g.chatBarText}」
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {g.publishingAt ? <span className="text-warning text-xs font-semibold">{new Date(g.publishingAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} に公開</span> : <StatusBadge status={g.status} />}
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-secondary">
                          {g.isDefaultForAll ? 'すべての友だち（既定）' : g.targetingEnabled && g.targetingCondition ? '条件で出し分け' : g.status === 'draft' ? '公開前' : 'すべての友だち'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="text-ink font-semibold tabular-nums">
                            {g.monthlyStats
                              ? `${g.monthlyStats.taps.toLocaleString('ja-JP')}回`
                              : tapStats
                                ? `${(tapsByGroup.get(g.id) ?? 0).toLocaleString('ja-JP')}回`
                                : '—'}
                          </p>
                          <p className="text-ink-faint mt-1 text-micro">
                            {g.monthlyStats?.uniqueAudience.value == null
                              ? 'のべ人数は未取得'
                              : `のべ${g.monthlyStats.uniqueAudience.value.toLocaleString('ja-JP')}人${g.monthlyStats.uniqueAudience.state === 'partial' ? '（記録開始後）' : ''}`}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-secondary tabular-nums">
                          {new Date(g.updatedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {g.status === 'published' ? <button type="button" onClick={() => setApplyTo(g)} className="text-action font-semibold hover:underline">表示先</button> : null}
                            <Link href={`/rich-menus/edit?id=${g.id}`} className="text-action font-semibold hover:underline">編集</Link>
                            <Link href={`/rich-menus/connections?id=${encodeURIComponent(g.id)}`} className="text-ink-secondary hover:underline">切替のつながりを見る</Link>
                            <button type="button" onClick={() => handleDelete(g)} data-qa-open={g.status === 'published' ? 'szXsT' : 'szXsT-draft'} className="text-danger hover:underline" title={g.status === 'published' ? 'LINE から取り下げてから削除' : '削除'}>削除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {!loading && !error && groupTotal > 0 ? (
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-ink-faint text-xs">
                  {groupTotal}件中 {(currentPage - 1) * effectivePageSize + 1}〜{Math.min(currentPage * effectivePageSize, groupTotal)}件を表示
                </p>
                <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="リッチメニューのページ送り" />
              </div>
            ) : null}
          </div>
        </div>
      )}

      {applyTo && (
        <ApplyToTagModal
          groupId={applyTo.id}
          groupName={applyTo.name}
          onClose={() => setApplyTo(null)}
        />
      )}

      <ConfirmDialog
        open={importTarget !== null}
        designNode="TL7tp"
        title={
          importTarget
            ? `「${importTarget.name}」を管理画面に取り込みますか？`
            : 'LINE上のメニューを管理画面に取り込みますか？'
        }
        description="LINE公式アカウント上にある設定を読み取り、管理画面へ新しく追加します。"
        confirmLabel="管理画面に取り込む"
        busy={importBusy}
        error={importError ?? undefined}
        onCancel={() => {
          if (importBusy) return
          setImportTarget(null)
          setImportError(null)
        }}
        onConfirm={() => void confirmImport()}
      >
        <ul className="space-y-2 text-sm text-ink-secondary">
          <li>
            <strong className="text-ink">管理画面に追加するもの：</strong>
            名前・画像・ボタンの設定
          </li>
          <li>
            <strong className="text-ink">上書きするもの：</strong>
            ありません。すでに管理中のメニューは重ねて取り込みません。
          </li>
          <li>
            <strong className="text-ink">LINE上に残るもの：</strong>
            現在のメニューと、友だちに表示している状態
          </li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={importedMenuName !== null}
        designNode="TL7tp"
        title={
          importedMenuName
            ? `「${importedMenuName}」を管理画面に取り込みました`
            : '管理画面に取り込みました'
        }
        description="LINE上の表示は変更していません。管理画面で編集できるようになりました。"
        cancelLabel="閉じる"
        onCancel={() => setImportedMenuName(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        designNode="szXsT"
        title={
          deleteTarget
            ? `「${deleteTarget.kind === 'managed' ? deleteTarget.group.name : deleteTarget.menu.name}」を削除しますか？`
            : 'リッチメニューを削除しますか？'
        }
        description={
          deleteTarget?.kind === 'managed'
            ? deleteTarget.group.status === 'published'
              ? 'いま表示中の人と使用先を確認し、まずLINEから取り下げます。取り下げても管理画面の設定は残ります。'
              : '管理画面に保存したこのリッチメニューを削除します。元には戻せません。'
            : 'この管理画面外で作成されたリッチメニューを、LINE公式アカウントから削除します。'
        }
        confirmLabel={deleteTarget?.kind === 'external' ? 'LINEから削除' : deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'published' ? 'LINEから取り下げる' : '削除する'}
        destructive={deleteTarget?.kind === 'external' || (deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'draft')}
        busy={deleteBusy}
        error={deleteError ?? undefined}
        onCancel={() => {
          if (deleteBusy) return
          impactRequestGenerationRef.current += 1
          impactLoadGenerationRef.current += 1
          impactRequestRef.current = null
          setDeleteTarget(null)
          setDeleteError(null)
          setImpact(null)
          setImpactPhase('idle')
        }}
        {...(deleteTarget?.kind === 'external' || (deleteTarget?.kind === 'managed' && deleteTarget.group.status === 'published') || canDeleteImpact({ impact, busy: deleteBusy })
          ? { onConfirm: () => void confirmDelete() }
          : {})}
      >
        {deleteTarget?.kind === 'managed' ? (
          <>
            <ul className="space-y-2 text-sm text-ink-secondary">
              <li>
                <strong className="text-ink">{deleteTarget.group.status === 'published' ? '取り下げるもの：' : '消えるもの：'}</strong>
                {deleteTarget.group.status === 'published' ? 'LINE上のこのリッチメニュー' : 'このリッチメニューの設定と画像'}
              </li>
              <li>
                <strong className="text-ink">残るもの：</strong>
                {deleteTarget.group.status === 'published' ? '管理画面の設定と、これまでのタップ記録' : '同じフォルダのほかのメニューと、これまでのタップ記録'}
              </li>
              {deleteTarget.group.status === 'draft' ? <li>
                 <strong className="text-danger">元に戻せません。</strong>
              </li> : <>
                <li><strong className="text-accent">取り下げは、もう一度公開すれば戻せます。</strong></li>
                <li>取り下げたあと、管理画面から削除できます。</li>
              </>}
            </ul>
            {/*
              消したあとに何が起きるか（契約 #608）。読込・失敗・通常を
              分ける。**読めないときは消させない。**
            */}
            {impactPhase === 'loading' ? (
              <p className="mt-3 text-xs text-ink-faint">消したときの影響を確認しています…</p>
            ) : impactPhase === 'error' ? (
              <p className="mt-3 text-xs font-semibold text-danger" role="alert">
                消したときの影響を確認できませんでした。読み直してから、もう一度お試しください。
              </p>
            ) : impact ? (
              <div className="border-hairline mt-3 space-y-1.5 border-t pt-3 text-xs leading-5 text-ink-secondary">
                <p>
                  <strong className="text-ink">いま表示している人数：</strong>
                  {audienceText(impact.currentAudience)}
                  {audienceReason(impact.currentAudience)
                    ? `（${audienceReason(impact.currentAudience)}）`
                    : ''}
                </p>
                <p>
                  <strong className="text-ink">次に出るメニュー：</strong>
                  {nextDisplayText(impact.nextDisplay)}
                </p>
                <p>
                  <strong className="text-ink">切替元：</strong>
                  {impact.incomingSwitches.length === 0
                    ? 'ありません'
                    : impact.incomingSwitches
                        .map((sw) => `${sw.sourceGroupName}の「${sw.areaLabel ?? sw.sourcePageName}」`)
                        .join('・')}
                </p>
                <p>
                  <strong className="text-ink">使っている自動処理：</strong>
                  {impact.operationalReferences.length === 0
                    ? 'ありません'
                    : impact.operationalReferences
                        .map((ref) => `${referenceKindText(ref.kind)}「${ref.ownerName}」`)
                        .join('・')}
                </p>
                {blockerTexts(impact.blockers).map((text) => (
                  <p key={text} className="font-semibold text-danger" role="alert">{text}</p>
                ))}
                {impact.blockers.length === 0 ? null : (
                  <p className="text-ink-faint">{recommendedActionText(impact.recommendedAction)}</p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <ul className="space-y-2 text-sm text-ink-secondary">
            <li>
              <strong className="text-ink">消えるもの：</strong>
              LINE公式アカウント上のこのリッチメニュー
            </li>
            <li>
              <strong className="text-ink">残るもの：</strong>
              管理画面で作成・編集しているほかのリッチメニュー
            </li>
            <li>
              <strong className="text-danger">元に戻せません。</strong>
            </li>
          </ul>
        )}
      </ConfirmDialog>
    </main>
  )
}

function ExternalImportWorkspace({
  external,
  loading,
  error,
  onBack,
  onReload,
  onImport,
}: {
  external: { currentDefault: string | null; lineMenus: LineMenu[] } | null
  loading: boolean
  error: string | null
  onBack: () => void
  onReload: () => void
  onImport: (menu: LineMenu) => void
}) {
  const unmanaged = external?.lineMenus.filter((menu) => !menu.adminManaged) ?? []
  const [selectedId, setSelectedId] = useState(unmanaged[0]?.richMenuId ?? '')
  const selected = unmanaged.find((menu) => menu.richMenuId === selectedId) ?? unmanaged[0] ?? null
  const areas = selected ? Array.from({ length: Math.min(selected.areasCount, 6) }, (_, index) => String.fromCharCode(65 + index)) : []

  return (
    <div data-design-node="TL7tp" className="mx-auto max-w-[1584px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs">
          <button type="button" className="text-action hover:underline" onClick={onBack}>リッチメニュー</button>
          <span className="mx-2">›</span>
          <span>管理画面の外のメニュー</span>
        </nav>
        <Button type="button" onClick={onReload}>↻ LINEから読み直す</Button>
      </div>

      {loading ? <ListState kind="loading" title="LINEのメニューを読み込んでいます" /> : null}
      {!loading && error && !external ? <ListState kind="error" title="LINEのメニューを表示できませんでした" onRetry={onReload} /> : null}
      {!loading && !error && unmanaged.length === 0 ? (
        <ListState kind="empty" title="管理画面の外のメニューはありません" description="LINE側だけにあるメニューが見つかると、ここに表示します。" />
      ) : null}

      {!loading && unmanaged.length > 0 ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-4">
            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-ink text-sm font-bold">LINE側にあって、この管理画面に無いメニュー</h2>
                <span className="text-ink-faint text-xs">{unmanaged.length}件</span>
              </div>
              <div className="space-y-2">
                {unmanaged.map((menu) => {
                  const active = selected?.richMenuId === menu.richMenuId
                  return (
                    <button
                      key={menu.richMenuId}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(menu.richMenuId)}
                      className={`border-hairline grid w-full grid-cols-[48px_minmax(0,1fr)_100px_110px_120px] items-center gap-3 rounded-control border p-3 text-left ${active ? 'border-accent bg-accent-soft' : 'bg-canvas hover:bg-canvas-sunken'}`}
                    >
                      <span className="bg-canvas-sunken text-ink-faint flex h-10 items-center justify-center rounded-control">▧</span>
                      <span className="min-w-0"><strong className="text-ink block truncate text-sm">{menu.name || '名前なし'}</strong><span className="text-ink-faint block truncate text-xs">{menu.areasCount}面・切替なし・画像あり</span></span>
                      <span className="text-ink text-sm font-bold">—<small className="text-ink-faint block text-micro font-normal">今月</small></span>
                      <span className="text-ink-secondary text-xs">作成日不明</span>
                      <span className="border-action text-action justify-self-end rounded-control border px-3 py-2 text-xs font-bold">取り込む</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
              <h2 className="text-ink mb-3 text-sm font-bold">取り込むと、できるようになること</h2>
              <ul className="space-y-3 text-xs text-ink-secondary">
                <li>✓ 面ごとのボタンを、この画面から書き換えられます</li>
                <li>✓ 「誰に出すか」の条件を付けられます（いまは全員に出ています）</li>
                <li>✓ 面ごとのタップ数が取れるようになります</li>
              </ul>
              <p className="bg-info-bg text-info mt-4 rounded-control p-3 text-xs font-semibold">ⓘ 取り込んでも、お客さまに出ているメニューは変わりません。中身をこちらで持つようになるだけです。</p>
            </section>
          </div>

          {selected ? (
            <aside className="space-y-4">
              <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
                <h2 className="text-ink text-sm font-bold">選んだメニューの中身</h2>
                <p className="text-ink mt-3 text-sm font-semibold">{selected.name || '名前なし'}</p>
                <div className="border-hairline bg-canvas-sunken mt-3 grid grid-cols-3 overflow-hidden rounded-control border" style={{ aspectRatio: `${selected.size.width} / ${selected.size.height}` }}>
                  {areas.map((area) => <span key={area} className="border-hairline text-ink-faint flex items-center justify-center border text-xs font-bold">{area}</span>)}
                </div>
                <h3 className="text-ink-secondary mt-3 text-xs font-bold">面ごとの動き（LINEから読んだもの）</h3>
                {selected.areas?.length ? (
                  <ul className="mt-2 space-y-2 text-xs">
                    {selected.areas.slice(0, 6).map((area, index) => (
                      <li key={`${selected.richMenuId}-${index}`} className="border-hairline grid grid-cols-[24px_minmax(0,1fr)] gap-2 rounded-control border p-2">
                        <strong className="text-ink">{String.fromCharCode(65 + index)}</strong>
                        <span className={area.action.supported ? 'text-ink-secondary break-words' : 'text-danger break-words'}>
                          {externalActionText(area.action)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-faint mt-2 text-xs leading-5">LINEから面ごとの動きを取得できませんでした。読み直してから取り込んでください。</p>
                )}
                <Button type="button" variant="primary" className="mt-4" onClick={() => onImport(selected)}>この内容で取り込む</Button>
              </section>
              <section className="bg-warning-bg text-warning rounded-card p-4 text-xs leading-6">
                <h2 className="mb-1 font-bold">気をつけること</h2>
                <p>・LINE側で作られたメニューは、名前が無いことがあります</p>
                <p>・取り込まずに「LINEから削除」すると、お客さまのメニューがすぐ消えます</p>
              </section>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function externalActionText(action: NonNullable<LineMenu['areas']>[number]['action']): string {
  if (!action.supported) return `未対応の動き（${action.type || '種類不明'}）`
  if (action.type === 'uri' && action.url) return `URLを開く（${action.url}）`
  if (action.type === 'message' && action.text) return `メッセージを送る「${action.text}」`
  if (action.type === 'postback') {
    return action.displayText ? `操作を実行して「${action.displayText}」と表示` : '操作を実行'
  }
  if (action.type === 'richmenuswitch' && action.richMenuAliasId) {
    return `別のメニューへ切り替える（${action.richMenuAliasId}）`
  }
  return `未対応の動き（${action.type || '種類不明'}）`
}
