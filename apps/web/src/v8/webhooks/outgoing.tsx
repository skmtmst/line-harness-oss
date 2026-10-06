'use client'

/*
 * ★V8 外部連携「こちらから送る」の一覧（Pencil `ZSbFY`・1152 `AsfFB`・
 * 閲覧のみ `l5SRfT`・状態 `wWrpY`）。
 *
 * 型（ListPage）に、タブ・数の帯・左のフォルダの列（上に「送り先を作る」）・
 * 案内の帯・道具の段・表をはめる。データの口は v7 と同じ（一覧・集計・
 * 動かす/止める・試し送信・合言葉の作り直し・削除）。
 *
 * 絵と今の作りが合わない所は BEHAVIOR.md に書いた（フォルダへ入れる口が無い・
 * 「先月より」の集計が無い・複製の口が無い など）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bookmark, Inbox, LayoutTemplate, Pause, Play, Plus } from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { api, ApiError, type OutgoingWebhookOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { formatNumber } from '@/lib/format'
import { ListPage, ListPagePagination } from '@/components/templates'
import ListToolbar from '@/components/shared/list-toolbar'
import SearchField from '@/components/shared/search-field'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import FilterChip from '@/components/shared/filter-chip'
import PageSizeSelect from '@/components/ui/page-size-select'
import Pagination from '@/components/shared/pagination'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import ContextMenu from '@/components/shared/context-menu'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { notifyToast } from '@/components/shared/toast'
import { describeApiFailure } from '@/components/shared/api-error-message'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import {
  MANAGE_REASON,
  ViewerBand,
  WEBHOOKS_DESCRIPTION,
  WebhookBand,
  WebhookTabs,
  overviewBandCells,
  useWebhookOverview,
} from './shell'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'
import { eventLabel, isHttpsUrl, maskedUrl, payloadLabel, shortDateTime } from './words'
import styles from './outgoing.module.css'

type SavedFilter = '' | 'active' | 'paused' | 'failed'
type SortKey = 'volume' | 'name'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

function matchesQuery(item: OutgoingWebhookOverview, query: string): boolean {
  // v7 と同じ探し方：名前・URL・出来事の種類（大文字小文字を区別しない）。
  const q = query.trim().toLocaleLowerCase('ja-JP')
  if (!q) return true
  return [item.name, item.url, ...item.eventTypes].some((value) => value.toLocaleLowerCase('ja-JP').includes(q))
}

function isFailing(item: OutgoingWebhookOverview): boolean {
  const pending = item.deliverySummary.lastResult?.status === 'pending'
  return !pending && (item.deliverySummary.lastResult?.status === 'failed' || item.deliverySummary.failed > 0)
}

export default function WebhooksOutgoingV8() {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId, accounts } = useAccount()
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const narrow = useNarrowViewport()
  const staffRole = useStaffRole()
  /*
   * 送り先の変更（作る・動かす/止める・直す・合言葉・削除）は統括だけ（R32）。
   * 試し送信は管理者も使える。見るだけの担当者は中身の確認と検索だけ（l5SRfT）。
   */
  const canManage = staffRole === null || staffRole === 'owner'
  const canTest = canManage || staffRole === 'admin'

  const overview = useWebhookOverview()
  const { outgoing, outgoingStatus, summary, loadedAccountId, reload } = overview

  const [folders, setFolders] = useState<Folder[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<SavedFilter>('')
  /* 並びの部品は絵に無い。つなぎ先は名前で探すことが多いので、既定は名前順（送った回数順は「よく使う絞り込み」から）。 */
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)
  /* 右クリックされた行（「設定」と同じ中身を押した位置に出す。右クリックだけの操作は置かない）。 */
  const [ctxId, setCtxId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [optimisticActive, setOptimisticActive] = useState<Record<string, boolean>>({})
  const togglingRef = useRef<Set<string>>(new Set())
  const [togglingIds, setTogglingIds] = useState<string[]>([])

  const [testTarget, setTestTarget] = useState<OutgoingWebhookOverview | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testNotice, setTestNotice] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; accountId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [rotateTarget, setRotateTarget] = useState<{ id: string; name: string; activate: boolean; accountId: string } | null>(null)
  const [rotateSecret, setRotateSecret] = useState('')
  const [rotateError, setRotateError] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)

  /* フォルダの箱（kind=webhook）。送り先をフォルダへ入れる口はまだ無い（BEHAVIOR.md）。 */
  const loadFolders = async () => {
    try {
      const res = await api.folders.list('webhook', selectedAccountId ?? undefined)
      if (res.success) setFolders(res.data)
    } catch {
      // 箱が取れなくても一覧は出す。
    }
  }
  useEffect(() => { void loadFolders() }, [selectedAccountId]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayed = useMemo(() => outgoing.map((item) => (
    optimisticActive[item.id] === undefined ? item : { ...item, isActive: optimisticActive[item.id] }
  )), [outgoing, optimisticActive])

  const ready = outgoingStatus === 'ready' && Boolean(selectedAccountId)
  const activeCount = displayed.filter((item) => item.isActive).length
  const pausedCount = displayed.length - activeCount

  const filtered = useMemo(() => {
    const rows = displayed.filter((item) => {
      if (!matchesQuery(item, query)) return false
      // 送り先はまだフォルダへ入れられない（全件が未分類）。フォルダを選ぶと 0 件。
      if (folderFilter && folderFilter !== UNFILED) return false
      if (chip === 'active') return item.isActive
      if (chip === 'paused') return !item.isActive
      if (chip === 'failed') return item.deliverySummary.failed > 0
      return true
    })
    return [...rows].sort((a, b) => (sortKey === 'name'
      ? a.name.localeCompare(b.name, 'ja-JP')
      : b.deliverySummary.total - a.deliverySummary.total))
  }, [displayed, query, folderFilter, chip, sortKey])

  useEffect(() => { setPage(1) }, [query, folderFilter, chip, sortKey, pageSize, selectedAccountId])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const filterActive = Boolean(query || folderFilter || chip)
  const clearFilters = () => {
    setQuery('')
    setFolderFilter('')
    setChip('')
  }

  /* ===== 動かす・止める（押した瞬間に札を変え、裏で保存する） ===== */
  const handleToggle = async (item: OutgoingWebhookOverview, currentActive: boolean) => {
    const accountId = selectedAccountId
    if (!accountId || loadedAccountId !== accountId) {
      setError('LINEアカウントの一覧を読み直してください')
      return
    }
    if (togglingRef.current.has(item.id)) {
      notifyToast(`「${item.name}」：いま切り替えを送っています。返事が来るまでお待ちください。`)
      return
    }
    togglingRef.current.add(item.id)
    setTogglingIds((current) => [...current, item.id])
    setOptimisticActive((current) => ({ ...current, [item.id]: !currentActive }))
    const clear = () => setOptimisticActive((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    const fail = (message: string) => {
      clear()
      notifyToast(message, { tone: 'error', actionLabel: 'もう一度', onAction: () => { void handleToggle(item, currentActive) } })
    }
    try {
      const res = await api.webhooks.outgoing.update(item.id, accountId, { isActive: !currentActive })
      if (accountRef.current !== accountId) return
      if (!res.success) {
        fail(`「${item.name}」は切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。`)
        return
      }
      await reload()
      clear()
      notifyToast(`「${item.name}」を${!currentActive ? '動かしました' : '止めました'}。`, {
        actionLabel: '元に戻す',
        onAction: () => { void handleToggle(item, !currentActive) },
      })
    } catch (caught) {
      if (accountRef.current !== accountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      if (!forbidden) await reload().catch(() => {})
      fail(forbidden
        ? `「${item.name}」は統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。`
        : `「${item.name}」は切り替えの応答を受け取れませんでした。一覧の表示を確かめてください。変わっている可能性があります。`)
    } finally {
      togglingRef.current.delete(item.id)
      setTogglingIds((current) => current.filter((id) => id !== item.id))
    }
  }

  /* ===== 試しに送る ===== */
  const runTest = async (item: OutgoingWebhookOverview) => {
    const accountId = selectedAccountId
    if (!accountId || testingId !== null) return
    setTestTarget(null)
    setTestingId(item.id)
    setTestNotice(null)
    try {
      const response = await api.webhooks.outgoing.test(item.id, accountId)
      if (accountRef.current !== accountId) return
      if (response.success && response.data.delivered) {
        const status = response.data.responseStatus
        notifyToast(`「${item.name}」への試し送信が届きました${status === null ? '' : `(相手の応答 ${status})`}。`)
      } else {
        const status = response.success ? response.data.responseStatus : null
        setTestNotice(`「${item.name}」への試し送信は届きませんでした${status === null ? '' : `(相手の応答 ${status})`}。「やり取りの記録」タブで詳しく確認できます。`)
      }
    } catch {
      if (accountRef.current !== accountId) return
      setTestNotice(`「${item.name}」への試し送信に失敗しました。「やり取りの記録」タブで詳しく確認できます。`)
    } finally {
      setTestingId(null)
    }
  }

  /* ===== 削除 ===== */
  const askDelete = (item: OutgoingWebhookOverview) => {
    const accountId = selectedAccountId
    if (!accountId || loadedAccountId !== accountId) {
      setError('LINEアカウントの一覧を読み直してください')
      return
    }
    setDeleteError('')
    setDeleteTarget({ id: item.id, name: item.name, accountId })
  }
  const runDelete = async () => {
    if (!deleteTarget || deleting) return
    const accountId = deleteTarget.accountId
    if (accountId !== selectedAccountId || loadedAccountId !== accountId) {
      setDeleteError('LINEアカウントが切り替わりました。削除する送り先を選び直してください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.webhooks.outgoing.delete(deleteTarget.id, accountId)
      if (!res.success) throw new Error(res.error)
      if (accountRef.current !== accountId) return
      setDeleteTarget(null)
      await reload()
    } catch (caught) {
      if (accountRef.current !== accountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      setDeleteError(forbidden
        ? 'この送り先の削除は統括だけができます。必要なときは統括に頼んでください。'
        : 'この送り先を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* ===== 合言葉（秘密の鍵）を作り直す ===== */
  const runRotate = async (stepUpToken?: string) => {
    setRotateError('')
    const accountId = selectedAccountId
    if (!rotateTarget) return
    if (!accountId || loadedAccountId !== accountId || rotateTarget.accountId !== accountId) {
      setRotateTarget(null)
      setRotateSecret('')
      setError('LINEアカウントが切り替わりました。対象を選び直してください。')
      return
    }
    if (rotateSecret.length < MIN_SECRET_LENGTH) {
      setRotateError(`合言葉は${MIN_SECRET_LENGTH}文字以上にしてください`)
      return
    }
    try {
      const res = await api.webhooks.outgoing.update(
        rotateTarget.id, accountId,
        { secret: rotateSecret, isActive: rotateTarget.activate || undefined },
        stepUpToken,
      )
      if (accountRef.current !== accountId) return
      if (!res.success) {
        setRotateError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecret('')
      void reload()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: 'シークレットを更新する', retry: (token) => runRotate(token) })
        return
      }
      if (accountRef.current !== accountId) return
      setRotateError(describeApiFailure(caught, 'シークレットの更新', {
        forbidden: '合言葉の更新は統括だけができます。必要なときは統括に頼んでください。',
      }))
    }
  }

  /* ===== 行の「設定」（操作の一覧） ===== */
  const menuItemsFor = (item: OutgoingWebhookOverview): ActionMenuItem[] => {
    const canActivate = item.hasSecret && isHttpsUrl(item.url)
    const items: ActionMenuItem[] = []
    if (canManage) {
      items.push({ id: 'edit', label: '直す', onSelect: () => { setMenuId(null); router.push(`/webhooks/edit?id=${item.id}`) } })
      items.push({
        id: 'toggle',
        label: item.isActive ? '止める' : '動かす',
        icon: item.isActive ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />,
        disabled: !item.isActive && !canActivate,
        disabledReason: !item.isActive && !canActivate ? 'URLと合言葉を確かめてください' : undefined,
        onSelect: () => { setMenuId(null); void handleToggle(item, item.isActive) },
      })
      items.push({
        id: 'secret',
        label: '鍵を作り直す',
        onSelect: () => {
          setMenuId(null)
          setRotateError('')
          setRotateSecret('')
          setRotateTarget({ id: item.id, name: item.name, activate: isHttpsUrl(item.url) && !item.hasSecret, accountId: selectedAccountId ?? '' })
        },
      })
    }
    items.push({
      id: 'test',
      label: '試しに送る',
      disabled: !item.isActive,
      disabledReason: !item.isActive ? '止めている送り先には試し送信できません' : undefined,
      onSelect: () => { setMenuId(null); setTestTarget(item) },
    })
    if (canManage) {
      items.push({ id: 'delete', label: '削除する', tone: 'danger', dividerBefore: true, onSelect: () => { setMenuId(null); askDelete(item) } })
    }
    return items
  }

  /* ===== フォルダの列 ===== */
  const folderRows: FolderPanelRow[] = [
    { id: '', label: 'すべて', count: ready ? displayed.length : null, icon: <Inbox size={15} aria-hidden="true" /> },
    ...folders.map((folder) => ({ id: folder.id, label: folder.name, count: folder.itemCount ?? null, color: folder.color })),
    { id: UNFILED, label: '未分類', count: ready ? displayed.length : null },
  ]
  const folderSelect = (
    <Select
      aria-label="フォルダ"
      value={folderFilter}
      onChange={(value) => setFolderFilter(value)}
      options={[
        { value: '', label: 'フォルダ：すべて' },
        ...folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })),
        { value: UNFILED, label: 'フォルダ：未分類' },
      ]}
    />
  )
  /* 閲覧のみには押せない作るボタンを置かない（場所だけ空ける）。 */
  const createButton = canManage
    ? <Button variant="primary" href="/webhooks/new" className={styles.createButton}><Plus size={15} aria-hidden="true" />送り先を作る</Button>
    : <span className={styles.createSpace} aria-hidden="true" />

  /* ===== 道具の段 ===== */
  const chips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chips}>
      <FilterChip selected={chip === 'active'} onChange={(next) => setChip(next ? 'active' : '')} icon={<Pause size={13} aria-hidden="true" />}>
        {ready ? `動いている ${activeCount}` : '動いている'}
      </FilterChip>
      <FilterChip selected={chip === 'paused'} onChange={(next) => setChip(next ? 'paused' : '')} icon={<Play size={13} aria-hidden="true" />}>
        {ready ? `止めている ${pausedCount}` : '止めている'}
      </FilterChip>
    </div>
  )
  /* 絵に並びの部品は無い。並びは「よく使う絞り込み」の中で選ぶ（機能は残す）。 */
  const savedBox = (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select
        aria-label="よく使う絞り込み"
        value={chip}
        onChange={(value) => {
          if (value === 'sort-volume') setSortKey('volume')
          else if (value === 'sort-name') setSortKey('name')
          else setChip(value as SavedFilter)
        }}
        options={[
          { value: '', label: 'よく使う絞り込み' },
          { value: 'active', label: '動いているのみ' },
          { value: 'paused', label: '止めているのみ' },
          { value: 'failed', label: '失敗あり' },
          { value: sortKey === 'volume' ? 'sort-name' : 'sort-volume', label: sortKey === 'volume' ? '名前順に並べる' : '送った回数が多い順に並べる' },
        ]}
      />
    </div>
  )
  const perPage = <PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} label={null} />
  const notice = (
    <div className={styles.noticeRow}>
      <Notice tone="info">友だちの動きを、決めたタイミングでほかのシステムへ送ります。送るときは秘密の鍵を付けます。鍵は「…」から作り直せます。</Notice>
    </div>
  )
  const searchBox = (
    <SearchField
      value={query}
      onChange={(value) => setQuery(value)}
      onClear={() => setQuery('')}
      placeholder="つなぎ先で探す"
      aria-label="つなぎ先で探す"
    />
  )
  /* 1152 の板（AsfFB）：案内の帯 → 1段目「作る・フォルダ・探す」→ 2段目「札 … よく使う絞り込み・件数」。 */
  const narrowToolbar = (
    <div className={styles.narrowTools}>
      {notice}
      <div className={styles.narrowRow}>
        {createButton}
        <div className={styles.narrowFolder}>{folderSelect}</div>
        <div className={styles.narrowSearch}>{searchBox}</div>
      </div>
      <div className={styles.narrowRow}>
        {chips}
        <span className={styles.spacer} aria-hidden="true" />
        {savedBox}
        {perPage}
      </div>
    </div>
  )
  const wideToolbar = (
    <>
      {notice}
      <ListToolbar
        search={{ placeholder: 'つなぎ先で探す', label: 'つなぎ先で探す', width: 240, value: query, onChange: setQuery }}
        filters={chips}
        trailing={<>{savedBox}{perPage}</>}
      />
    </>
  )

  /* ===== 表 ===== */
  let listBody
  if (outgoingStatus === 'loading' && selectedAccountId) {
    listBody = (
      <div aria-busy="true" aria-label="送り先を読み込んでいます">
        <DelayedSkeleton
          loading
          skeleton={(
            <div aria-hidden="true">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className={styles.skeletonRow}>
                  <Skeleton className={styles.skeletonDot} />
                  <Skeleton className={styles.skeletonBar} />
                  <Skeleton className={styles.skeletonBar} />
                  <Skeleton className={styles.skeletonBar} />
                  <Skeleton className={styles.skeletonBar} />
                </div>
              ))}
            </div>
          )}
        />
      </div>
    )
  } else if (!selectedAccountId) {
    listBody = <ListState kind="empty" title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  } else if (outgoingStatus === 'error') {
    listBody = (
      <ListState
        kind="error"
        title="送り先を読み込めませんでした"
        description="登録内容は消えていません。通信の状態を確認して、もう一度お試しください。"
        action={<Button onClick={() => void reload()}>もう一度読み込む</Button>}
      />
    )
  } else if (displayed.length === 0) {
    listBody = (
      <ListState
        kind="empty"
        title="まだ、送り先はありません"
        description="送り先を作ると、友だちの動きをほかのシステムへ知らせられます"
        action={canManage ? <Button variant="primary" href="/webhooks/new"><Plus size={15} aria-hidden="true" />送り先を作る</Button> : undefined}
      />
    )
  } else if (visible.length === 0) {
    listBody = (
      <ListState
        kind="empty"
        title="条件に合う送り先はありません"
        description="検索や絞り込みの札を外すと、すべて出ます"
        action={filterActive ? <Button onClick={clearFilters}>条件を外す</Button> : undefined}
      />
    )
  } else {
    listBody = (
      <>
        <ContextMenu
          label="送り先の操作"
          items={(() => {
            const target = visible.find((item) => item.id === ctxId) ?? visible[0]
            return target ? menuItemsFor(target).map((menuItem) => ({
              id: menuItem.id,
              label: menuItem.label,
              danger: menuItem.tone === 'danger',
              disabled: menuItem.disabled,
              onSelect: () => menuItem.onSelect(),
            })) : []
          })()}
          shouldOpen={(event) => {
            const row = (event.target as HTMLElement).closest('tr[data-row-id]')
            if (!row) return false
            setCtxId(row.getAttribute('data-row-id'))
            return true
          }}
        >
        <div className={styles.tableWrap}>
          <DataTable className={styles.table}>
            <thead>
              <TableHeadRow className={styles.headRow} data-table-layout="columns">
                <Th className={styles.colName}>つなぎ先</Th>
                <Th className={styles.colWhen}>いつ送るか</Th>
                <Th className={styles.colPayload}>送るもの</Th>
                <Th className={styles.colCount}>この30日</Th>
                <Th className={styles.colState}>ようす</Th>
                <Th className={styles.colOps}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {visible.map((item) => {
                const toggling = togglingIds.includes(item.id)
                const failing = isFailing(item)
                const completedAt = item.deliverySummary.lastResult?.completedAt
                const when = eventLabel(item.eventTypes)
                const payload = payloadLabel(item.eventTypes)
                const menuItems = menuItemsFor(item)
                const showMenu = canManage || canTest
                const tone = toggling ? 'neutral' : failing ? 'danger' : item.isActive ? 'active' : 'neutral'
                const stateWord = toggling ? '切り替え中' : failing ? '失敗あり' : item.isActive ? '動いている' : '止めている'
                return (
                  <Tr key={item.id} className={styles.row} data-table-layout="columns" data-row-id={item.id}>
                    <Td className={styles.colName}>
                      {canManage ? (
                        <Link href={`/webhooks/edit?id=${item.id}`} className={styles.name} title={item.name}>{item.name}</Link>
                      ) : (
                        <span className={styles.name} title={item.name}>{item.name}</span>
                      )}
                      <span className={styles.sub} title={item.url}>{maskedUrl(item.url)}</span>
                    </Td>
                    <Td className={styles.colWhen}><span className={styles.cellText} title={when}>{when}</span></Td>
                    <Td className={styles.colPayload}><span className={styles.cellText} title={payload}>{payload}</span></Td>
                    <Td className={styles.colCount}>
                      <span className={styles.num}>{formatNumber(item.deliverySummary.total)}回</span>
                      <span className={styles.numSub}>
                        {item.deliverySummary.failed > 0
                          ? `失敗 ${formatNumber(item.deliverySummary.failed)}回`
                          : `送信中 ${formatNumber(item.deliverySummary.pending)}回`}
                      </span>
                    </Td>
                    <Td className={styles.colState}>
                      <span className={styles.pill} data-tone={tone}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {stateWord}
                      </span>
                      {completedAt
                        ? <span className={styles.sub}>最終 {shortDateTime(completedAt)}</span>
                        : item.isActive && !toggling ? <span className={styles.sub}>まだ送っていません</span> : null}
                    </Td>
                    <Td className={styles.colOps}>
                      <div className={styles.opsBox}>
                        {item.deliverySummary.canRetry && canManage
                          ? <Button href="/webhooks?tab=interactions">やり直す</Button>
                          : <Button href="/webhooks?tab=interactions">中身を見る</Button>}
                        {showMenu ? (
                          <>
                            <Button
                              aria-haspopup="menu"
                              aria-expanded={menuId === item.id}
                              aria-label={`「${item.name}」の設定`}
                              onClick={() => setMenuId((current) => (current === item.id ? null : item.id))}
                            >
                              設定
                            </Button>
                            <ActionMenu
                              open={menuId === item.id}
                              onClose={() => setMenuId(null)}
                              ariaLabel={`「${item.name}」の設定`}
                              items={menuItems}
                              note={canManage ? undefined : MANAGE_REASON}
                            />
                          </>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        </div>
        </ContextMenu>
        <p className={styles.footNote}>行の「設定」から 直す・止める・鍵を作り直す・試しに送る・削除。「中身を見る」で送った中身と返事を見られます。</p>
      </>
    )
  }

  const pager = ready && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>
        {(currentPage - 1) * pageSize + 1}〜{(currentPage - 1) * pageSize + visible.length} / {formatNumber(filtered.length)}件
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="送り先一覧のページ送り" />
    </ListPagePagination>
  ) : null

  return (
    <ListPage
      boardId={narrow ? 'AsfFB' : 'ZSbFY'}
      headingSize="regular"
      title="外部連携"
      description={WEBHOOKS_DESCRIPTION}
      actions={canManage ? <Button href="/webhooks?tab=notify"><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button> : undefined}
      tabs={<WebhookTabs active="outgoing" outgoingCount={overview.outgoingCount} incomingCount={overview.incomingCount} />}
      stats={<>
        {!canManage ? <ViewerBand /> : null}
        <WebhookBand
          cells={overviewBandCells({
            outgoing: ready ? displayed : null,
            incomingCount: overview.incomingCount,
            summary,
          })}
        />
      </>}
      folders={<>
        {createButton}
        <FolderPanel
          activeId={folderFilter}
          onSelect={(id) => setFolderFilter(id)}
          onAddFolder={canManage ? () => setFolderDialogOpen(true) : undefined}
          addFolderLabel="フォルダを追加"
          rows={folderRows}
        >
          {/* 閲覧のみには押せない「フォルダを追加」を置かない（場所だけ空ける）。 */}
          {canManage ? null : <span className={styles.addSpace} aria-hidden="true" />}
          <p className={styles.folderNote}>フォルダを消しても、中の送り先は未分類に残ります</p>
        </FolderPanel>
      </>}
      collapsedFolders={narrow ? undefined : <>{createButton}{folderSelect}</>}
      toolbar={narrow ? narrowToolbar : wideToolbar}
      pagination={pager}
      overlays={<>
        {folderDialogOpen ? (
          <FolderAddDialog
            kind="webhook"
            accountId={selectedAccountId}
            note="送り先を分けてしまう箱です。消しても、入っていた送り先は未分類として残ります。"
            placeholder="例: 顧客・会員"
            onClose={() => setFolderDialogOpen(false)}
            onAdded={() => void loadFolders()}
          />
        ) : null}
        <ConfirmDialog
          open={testTarget !== null}
          title="試し送信をします"
          description={testTarget ? `「${testTarget.name}」へ、試し用のデータを1回だけ送ります。実際の連携先へ届きます。` : ''}
          confirmLabel="この送り先へ送る"
          cancelLabel="キャンセル"
          busy={testingId !== null}
          onConfirm={() => { if (testTarget) void runTest(testTarget) }}
          onCancel={() => setTestTarget(null)}
        >
          {testTarget ? (
            <div className={styles.urlBox}>
              <p className={styles.urlLabel}>送り先のURL</p>
              <code className={styles.urlValue}>{testTarget.url}</code>
            </div>
          ) : null}
        </ConfirmDialog>
        <ConfirmDialog
          open={deleteTarget !== null}
          title={`送り先「${deleteTarget?.name ?? ''}」を削除しますか？`}
          description="この宛先への送信が止まり、これから起きる出来事は通知されなくなります。すでに送った記録は残ります。この操作は取り消せません。"
          confirmLabel="削除する"
          destructive
          busy={deleting}
          error={deleteError || undefined}
          onConfirm={() => void runDelete()}
          onCancel={() => {
            if (deleting) return
            setDeleteTarget(null)
            setDeleteError('')
          }}
        />
        <Dialog
          open={rotateTarget !== null}
          title={rotateTarget ? `「${rotateTarget.name}」の鍵を${rotateTarget.activate ? '設定して動かす' : '作り直す'}` : ''}
          description="新しい鍵（合言葉）を設定します。保存したあとは二度と全部は表示されません。前の鍵は24時間だけ使えるので、相手側の切り替え中も送信は止まりません。"
          error={rotateError || undefined}
          onCancel={() => { setRotateTarget(null); setRotateSecret('') }}
          onConfirm={() => void runRotate()}
          confirmLabel="保存する"
        >
          <div className={styles.secretRow}>
            <input
              value={rotateSecret}
              onChange={(event) => setRotateSecret(event.target.value)}
              className={styles.secretInput}
              placeholder="ランダムな英数字32文字以上"
              aria-label="新しい鍵"
              minLength={MIN_SECRET_LENGTH}
              autoFocus
            />
            <Button type="button" onClick={() => setRotateSecret(generateSecret())}>自動生成</Button>
          </div>
        </Dialog>
        {stepUp ? <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} /> : null}
      </>}
    >
      {error ? <div className={styles.errorRow}><Notice tone="danger" message={error} onClose={() => setError('')} /></div> : null}
      {testNotice ? <div className={styles.errorRow}><Notice tone="danger" message={testNotice} onClose={() => setTestNotice(null)} /></div> : null}
      {listBody}
    </ListPage>
  )
}
