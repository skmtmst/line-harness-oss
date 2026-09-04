'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import type { RichMenuDeleteImpact, RichMenuTapStats } from '@/lib/api'
import type { Folder } from '@line-crm/shared'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Pagination from '@/components/shared/pagination'
import ConfirmDialog from '@/components/shared/confirm-dialog'
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
  compareTargetingGroups,
  moveTargetingGroup,
  orderTargetingGroups,
} from './targeting-order'

/** フォルダに入れていないものを選ぶための、内部だけの値。 */
const UNFILED = '__unfiled__'

type SortKey = 'taps' | 'updated' | 'name' | 'priority'

type RichMenuAction = 'load' | 'reorder' | 'delete' | 'externalDelete' | 'import'

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
  { key: 'used', label: 'よく使う', note: '今月1回以上押されたメニュー' },
  { key: 'published', label: '公開中のみ', note: 'LINE に登録済みのメニュー' },
  { key: 'draft', label: '下書きのみ', note: 'まだ LINE に登録していないメニュー' },
]

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
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
      {status === 'published' ? 'LINE 登録済み' : '下書き'}
    </span>
  )
}

type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  size: { width: number; height: number }
  areasCount: number
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
  const [publishedDeleteTarget, setPublishedDeleteTarget] =
    useState<RichMenuGroupListItem | null>(null)
  const [importTarget, setImportTarget] = useState<LineMenu | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedMenuName, setImportedMenuName] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    activeAccountRef.current = selectedAccount?.id ?? null
    importRequestGenerationRef.current += 1
    setGroups([])
    setExternal(null)
    setTapStats(null)
    setError(null)
    setExternalError(null)
    setApplyTo(null)
    setDeleteTarget(null)
    setPublishedDeleteTarget(null)
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
        api.richMenuGroups.list(accountId),
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
        setGroups(groupsRes.value.data)
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
  }, [selectedAccount?.id])

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
    setReorderBusy(true)
    try {
      // 古いデータは同じ優先番号を持つことがある。変更した2件だけを交換すると
      // 同順位が残るため、全件を0,1,2…へそろえる。displayOrder も同じ値へ寄せ、
      // 以前の「自分で決めた順」を読む場所とも食い違わせない。
      await Promise.all(
        reordered.map((item) =>
          api.richMenuGroups.update(item.id, {
            targetingPriority: item.priority,
            displayOrder: item.priority,
          }),
        ),
      )
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
    if (group.status === 'published') {
      setPublishedDeleteTarget(group)
      return
    }
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
    const action: RichMenuAction = deleteTarget.kind === 'managed' ? 'delete' : 'externalDelete'
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      if (deleteTarget.kind === 'managed') {
        const res = await api.richMenuGroups.delete(deleteTarget.group.id)
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
  const targetingCount = groups.filter((g) => g.targetingEnabled && g.targetingCondition).length
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

  const q = query.trim()
  const byQuery = !reordering && q
    ? groups.filter((g) => g.name.includes(q) || g.chatBarText.includes(q))
    : groups
  const inFolder = byQuery.filter((g) => {
    if (reordering) return true
    if (folderFilter === UNFILED) return !g.folderId
    if (folderFilter) return g.folderId === folderFilter
    return true
  })

  const inSaved = inFolder.filter((g) => {
    if (reordering) return true
    if (savedFilter === 'published') return g.status === 'published'
    if (savedFilter === 'draft') return g.status === 'draft'
    if (savedFilter === 'used') return (tapsByGroup.get(g.id) ?? 0) > 0
    return true
  })

  // 並び替えは元の配列を壊さないよう写してから。
  const sorted = [...inSaved].sort((a, b) => {
    switch (sortKey) {
      case 'taps':
        return (tapsByGroup.get(b.id) ?? 0) - (tapsByGroup.get(a.id) ?? 0)
      case 'name':
        return a.name.localeCompare(b.name, 'ja')
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt)
      case 'priority':
        // Worker が友だちへ出すメニューを選ぶ順番と同じ。
        return compareTargetingGroups(a, b)
    }
  })

  const priorityRankByGroup = new Map(
    orderTargetingGroups(groups)
      .map((group, index) => [group.id, index + 1]),
  )

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const shownGroups = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [folderFilter, pageSize, query, savedFilter, sortKey])

  return (
    <main data-design-node="GO8RQ" className="p-6 max-w-7xl mx-auto">
      <div
        data-design="KPIs"
        data-group-kpi-state={groupKpiState}
        className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">メニュー</p>
          <p className={`${groupKpiReady ? 'text-ink' : 'text-ink-faint'} mt-1 text-2xl font-bold tabular-nums`}>
            {groupKpiReady ? groups.length : '—'}
            {groupKpiReady && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {groupKpiReady
              ? `公開中 ${groups.filter((g) => g.status === 'published').length}`
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
        <Link
          href="/rich-menus/new"
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control inline-flex items-center gap-1 px-4 py-2 text-sm font-medium transition-colors"
        >
          メニューを作る
        </Link>
        <button
          onClick={() => setFolderDialogOpen(true)}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium transition-colors"
        >
          フォルダを追加
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メニュー名で検索"
          aria-label="メニュー名で検索"
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
          options={[{ value: '20', label: '20件' }, { value: '50', label: '50件' }, { value: '100', label: '100件' }]}
        />
        <button
          onClick={() => {
            // 並べ替え中は、実際の出し分け判定と同じ順番で全件を見せる。
            setSortKey('priority')
            setPage(1)
            setReordering((v) => !v)
          }}
          aria-pressed={reordering}
          className={`rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
            reordering
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
          }`}
        >
          {reordering ? '並び替えを終える' : '出す順番を変える'}
        </button>
      </div>

      <div className="bg-accent-soft text-ink-secondary mb-3 rounded-control px-3 py-2 text-xs leading-relaxed">
        <span className="font-semibold">出す順番：</span>
        上にあるメニューが優先されます。同じ友だちが複数の条件に当てはまるときは、
        いちばん上の1つだけが表示されます。
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
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
      </div>

      {!selectedAccount && (
        <div className="text-sm text-ink-faint">
          アカウントを選択してください。
        </div>
      )}

      {selectedAccount && loading && (
        <div className="text-sm text-ink-faint">読み込み中...</div>
      )}

      {selectedAccount && !loading && error && (
        <div className="bg-danger-bg border border-danger-bg text-danger text-sm p-3 rounded mb-4">
          <p>{error}</p>
          <button type="button" className="mt-2 underline" onClick={() => void reload()}>
            もう一度読み込む
          </button>
        </div>
      )}

      {/* LINE 公式アカウントの現状 (admin 管理外の rich menu も含む) */}
      {selectedAccount && !loading && external && (
        <ExternalSection
          accountId={selectedAccount.id}
          accountName={selectedAccount.displayName || selectedAccount.name}
          external={external}
          onDeleteExternal={handleDeleteExternal}
          onImport={handleImport}
        />
      )}
      {selectedAccount && !loading && externalError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded mb-6">
          {externalError}
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

      {/* Admin 管理メニュー見出し */}
      {selectedAccount && !loading && !error && (
        <h2 className="text-sm font-semibold text-ink-secondary mb-3">
          管理画面で作成・編集するメニュー
        </h2>
      )}

      {selectedAccount && !loading && !error && shownGroups.length === 0 && (
        <div className="bg-white border border-hairline rounded-lg shadow-sm p-12 text-center">
          <p className="text-ink-faint mb-4">
            まだリッチメニューが作成されていません。
          </p>
          <Link
            href="/rich-menus/new"
            className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 inline-flex items-center gap-1 rounded-control px-4 py-2 text-sm font-medium"
          >
            <span className="text-lg leading-none">+</span> 最初のメニューを作る
          </Link>
        </div>
      )}

      {selectedAccount && !loading && !error && (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <FolderPanel
            total={`${groups.length} 件`}
            activeId={folderFilter}
            onSelect={setFolderFilter}
            rows={[
              { id: '', label: 'すべて', count: groups.length },
              ...folders.map((f) => ({
                id: f.id,
                label: f.name,
                count: groups.filter((g) => g.folderId === f.id).length,
                color: f.color,
              })),
              {
                id: UNFILED,
                label: '未分類',
                count: groups.filter((g) => !g.folderId).length,
              },
            ]}
          >
            <p className="text-ink-faint text-xs leading-relaxed">
              フォルダを消しても、入っていたメニューは未分類として残ります。
            </p>
          </FolderPanel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shownGroups.map((g) => (
            <div
              key={g.id}
              className="bg-white border border-hairline rounded-lg shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <Link
                href={`/rich-menus/edit?id=${g.id}`}
                className="flex-1 hover:bg-canvas-sunken rounded-t-lg overflow-hidden"
              >
                {/* thumbnail */}
                <div
                  className="w-full bg-canvas-sunken border-b border-hairline"
                  style={{
                    aspectRatio: g.size === 'large' ? '2500 / 1686' : '2500 / 843',
                  }}
                >
                  {g.thumbnailR2Key ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)}
                      alt={g.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-ink-faint">
                      画像未設定
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h2 className="font-semibold text-ink truncate">{g.name}</h2>
                    <StatusBadge status={g.status} />
                  </div>
                  <p className="text-sm text-ink-faint truncate">
                    トーク表示: <span className="text-ink-secondary">{g.chatBarText}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <span className="whitespace-nowrap">
                      出す順番 {priorityRankByGroup.get(g.id) ?? '—'}番
                    </span>
                    <span className="whitespace-nowrap">
                      サイズ: {g.size === 'large' ? '2500×1686' : '2500×843'}
                    </span>
                    {tapStats && (
                      <span className="whitespace-nowrap">
                        今月 <span className="text-ink-secondary tabular-nums">
                          {tapsByGroup.get(g.id) ?? 0}
                        </span> 回
                      </span>
                    )}
                    {g.targetingEnabled && g.targetingCondition && (
                      <span className="text-accent font-medium whitespace-nowrap">条件で出し分け</span>
                    )}
                    {g.isDefaultForAll && (
                      <span className="text-blue-600 font-medium whitespace-nowrap">
                        ★ 全員のデフォルト
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              {reordering && (
                <div className="border-hairline bg-canvas-sunken flex items-center justify-between gap-2 border-t px-4 py-2">
                  <span className="text-ink-faint text-[11px]">
                    出す順番 {priorityRankByGroup.get(g.id) ?? '—'}番
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => void moveGroup(g, -1)}
                      disabled={reorderBusy}
                      className="border-hairline rounded-control hover:bg-canvas border px-2 py-0.5 text-xs disabled:opacity-40"
                      aria-label="上へ"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => void moveGroup(g, 1)}
                      disabled={reorderBusy}
                      className="border-hairline rounded-control hover:bg-canvas border px-2 py-0.5 text-xs disabled:opacity-40"
                      aria-label="下へ"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              )}
              <div className="border-t border-hairline px-4 py-2.5 flex justify-end gap-4 text-xs">
                {g.status === 'published' && (
                  <button
                    onClick={() => setApplyTo(g)}
                    className="text-accent font-medium hover:underline"
                  >
                    友だちに表示
                  </button>
                )}
                <Link
                  href={`/rich-menus/edit?id=${g.id}`}
                  className="text-ink-secondary hover:underline"
                >
                  編集
                </Link>
                <Link
                  href={`/rich-menus/connections?id=${encodeURIComponent(g.id)}`}
                  className="text-ink-secondary hover:underline"
                >
                  切替のつながりを見る
                </Link>
                <button
                  onClick={() => handleDelete(g)}
                  data-qa-open={g.status === 'published' ? 'szXsT-published' : 'szXsT'}
                  className="text-ink-faint hover:text-red-600 hover:underline"
                  title={g.status === 'published' ? 'LINE から取り下げてから削除' : '削除'}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {selectedAccount && !loading && !error && sorted.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-ink-faint text-xs">
            {(currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, sorted.length)}件 / 全{sorted.length}件
          </p>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
            ariaLabel="リッチメニューのページ送り"
          />
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
        open={publishedDeleteTarget !== null}
        designNode="szXsT"
        title={
          publishedDeleteTarget
            ? `「${publishedDeleteTarget.name}」は先にLINEから取り下げてください`
            : '先にLINEから取り下げてください'
        }
        description="LINEに登録中のリッチメニューは、管理画面だけから削除できません。いまは削除していません。"
        cancelLabel="閉じる"
        onCancel={() => setPublishedDeleteTarget(null)}
      >
        <ol className="space-y-2 text-sm text-ink-secondary">
          <li>
            <strong className="text-ink">次にすること：</strong>
            「編集」→「危険な操作」→「LINEから取り下げ」の順に進んでください。
          </li>
          <li>
            <strong className="text-ink">そのあと：</strong>
            一覧へ戻り、改めて「削除」を選んでください。
          </li>
          <li>
            <strong className="text-ink">いま残っているもの：</strong>
            LINE上の表示、管理画面の設定、これまでのタップ記録は変更していません。
          </li>
        </ol>
      </ConfirmDialog>

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
            ? '管理画面に保存したこのリッチメニューを削除します。LINEに登録中のメニューは、先に取り下げない限り削除できません。'
            : 'この管理画面外で作成されたリッチメニューを、LINE公式アカウントから削除します。'
        }
        confirmLabel={deleteTarget?.kind === 'external' ? 'LINEから削除' : '削除する'}
        destructive
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
        {...(deleteTarget?.kind === 'external' || canDeleteImpact({ impact, busy: deleteBusy })
          ? { onConfirm: () => void confirmDelete() }
          : {})}
      >
        {deleteTarget?.kind === 'managed' ? (
          <>
            <ul className="space-y-2 text-sm text-ink-secondary">
              <li>
                <strong className="text-ink">消えるもの：</strong>
                このリッチメニューの設定と画像
              </li>
              <li>
                <strong className="text-ink">残るもの：</strong>
                同じフォルダのほかのメニューと、これまでのタップ記録
              </li>
              <li>
                <strong className="text-danger">元に戻せません。</strong>
              </li>
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

function ExternalSection({
  accountId,
  accountName,
  external,
  onDeleteExternal,
  onImport,
}: {
  accountId: string
  accountName: string
  external: { currentDefault: string | null; lineMenus: LineMenu[] }
  onDeleteExternal: (menu: LineMenu) => void
  onImport: (menu: LineMenu) => void
}) {
  const { currentDefault, lineMenus } = external
  const sortedMenus = [...lineMenus].sort((a, b) => {
    // 現在のデフォルトを先頭、次に admin 管理外、最後に admin 管理
    if (a.isCurrentDefault) return -1
    if (b.isCurrentDefault) return 1
    if (a.adminManaged !== b.adminManaged) return a.adminManaged ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  const currentDefaultMenu = lineMenus.find((m) => m.isCurrentDefault) ?? null
  const unmanagedCount = lineMenus.filter((m) => !m.adminManaged).length

  return (
    <section className="mb-8 bg-white border border-hairline rounded-lg shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-ink">
          LINE 公式アカウントの現状
        </h2>
        <span className="text-xs text-ink-faint truncate">{accountName}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-700 font-medium mb-0.5">
            現在の「全員のデフォルト」
          </div>
          {currentDefaultMenu ? (
            <div>
              <div className="font-medium text-ink truncate">
                {currentDefaultMenu.name}
              </div>
              {currentDefaultMenu.adminInfo ? (
                <div className="text-xs text-ink-secondary truncate">
                  管理画面: {currentDefaultMenu.adminInfo.groupName}
                </div>
              ) : (
                <div className="text-xs text-amber-700">管理画面外で設定</div>
              )}
            </div>
          ) : (
            <div className="text-ink-faint text-xs">設定なし</div>
          )}
          {currentDefault && (
            <div className="text-[10px] text-ink-faint font-mono mt-1 truncate">
              {currentDefault}
            </div>
          )}
        </div>
        <div className="bg-canvas-sunken border border-hairline rounded-lg p-3">
          <div className="text-xs text-ink-secondary font-medium mb-0.5">
            LINE 上に登録されているメニュー
          </div>
          <div className="font-medium text-ink">{lineMenus.length} 個</div>
          {unmanagedCount > 0 && (
            <div className="text-xs text-amber-700">
              うち {unmanagedCount} 個が管理画面外
            </div>
          )}
        </div>
      </div>

      {lineMenus.length === 0 ? (
        <div className="text-xs text-ink-faint py-3">
          LINE 公式アカウントにはまだ rich menu が登録されていません。
        </div>
      ) : (
        <div className="border border-hairline rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-canvas-sunken">
              <tr className="text-left text-xs font-medium text-ink-secondary">
                <th className="px-3 py-2 w-[88px]">画像</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">サイズ</th>
                <th className="px-3 py-2">管理状態</th>
                <th className="px-3 py-2 w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMenus.map((m) => (
                <tr key={m.richMenuId} className="text-ink-secondary">
                  <td className="px-3 py-2.5">
                    <div
                      className="w-20 bg-canvas-sunken rounded overflow-hidden"
                      style={{
                        aspectRatio:
                          m.size.width === 2500 && m.size.height === 1686
                            ? '2500 / 1686'
                            : m.size.width === 2500 && m.size.height === 843
                              ? '2500 / 843'
                              : `${m.size.width} / ${m.size.height}`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={api.richMenuGroups.externalImageUrl(m.richMenuId, accountId)}
                        alt={m.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      {m.isCurrentDefault && (
                        <span
                          className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded"
                          title="LINE 公式アカウントの全員のデフォルト"
                        >
                          DEFAULT
                        </span>
                      )}
                      <span className="font-medium truncate max-w-[180px]">{m.name}</span>
                    </div>
                    <div className="text-[11px] text-ink-faint truncate max-w-[200px]">
                      {m.chatBarText}
                    </div>
                    <div className="text-[10px] text-ink-faint font-mono truncate max-w-[280px]">
                      {m.richMenuId}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-secondary whitespace-nowrap">
                    {m.size.width}×{m.size.height}
                    <div className="text-[10px] text-ink-faint">{m.areasCount} エリア</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {m.adminManaged && m.adminInfo ? (
                      <Link
                        href={`/rich-menus/edit?id=${m.adminInfo.groupId}`}
                        className="text-ink-secondary hover:underline"
                      >
                        管理画面 → {m.adminInfo.groupName}
                        <span className="text-ink-faint ml-1">({m.adminInfo.pageName})</span>
                      </Link>
                    ) : (
                      <span
                        className="text-amber-700 font-medium"
                        title="LINE 公式マネージャー、または旧 MCP/CLI から作成された可能性"
                      >
                        管理画面外
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {!m.adminManaged && (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => onImport(m)}
                          data-qa-open="TL7tp"
                          className="text-accent text-xs font-medium hover:underline"
                          title="管理画面に取り込んで以後 UI で操作可能にする"
                        >
                          管理画面に取り込む
                        </button>
                        <button
                          onClick={() => onDeleteExternal(m)}
                          className="text-xs text-ink-faint hover:text-red-600 hover:underline"
                          title="LINE から削除 (管理画面外メニューのみ)"
                        >
                          LINE から削除
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
