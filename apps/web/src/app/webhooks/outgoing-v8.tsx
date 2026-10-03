'use client'

/*
 * ★V8-B 外部連携の一覧（こちらから送る）（Pencil「★V8-B 画面の地図」の
 * 外部連携の行：一覧 `ZSbFY`、状態 `wWrpY`、1152 `AsfFB`、
 * 閲覧のみ `l5SRfT`）。
 *
 * v7 の一覧（`page.tsx` の WebhooksPageInner＋`webhook-overviews.tsx` の
 * OutgoingOverview）とは別の部品として持つ。データの口（一覧・集計・
 * 開始と停止・試し送信・合言葉・削除）は同じ。違いは置き場と見せ方——
 * タブに件数、数の帯は白い板の左右いっぱい・区切り線、表は「つなぎ先・
 * いつ送るか・送るもの・この30日・ようす・操作（見る／やり直す＋設定）」。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - フォルダの列：送り先にフォルダの口が無いので置かない。
 *   作るボタンは一覧の上の左（v7 と同じ置き場所）。
 * - 帯の「先月より+210」：先月の集計の口が無いので「成功 N回」と出す。
 * - 帯の「失敗」：失敗したやり取りの件数（`summary.failed`）を出す。
 * - ようすの2行目：最後の送達日時が無い行は「—」。
 *   「止めた日」は止めた日時の口が無いので出さない。
 * - 行の「…」改め「設定」の中身：今ある操作だけ（動かす・止める・直す・
 *   合言葉を作り直す・削除する・試しに送る）。複製は口が無いので足さない。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox, Link2, Send, Webhook } from 'lucide-react'
import MergedTabs from '@/components/layout/merged-tabs'
import { api, ApiError, type OutgoingWebhookOverview } from '@/lib/api'
import type { WebhookInteractionSummary } from '@line-crm/shared'
import { describeApiFailure } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import ListRange from '@/components/ui/list-range'
import PageSizeSelect from '@/components/ui/page-size-select'
import SortSelect from '@/components/ui/sort-select'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { notifyToast } from '@/components/shared/toast'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { formatDateTime, formatNumber } from '@/lib/format'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import styles from './outgoing-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'
type OutgoingFilter = 'all' | 'active' | 'paused' | 'failed'
type OutgoingSort = 'volume' | 'name'

const EVENT_LABEL: Record<string, string> = {
  'conversion.confirmed': '注文が確定したとき',
  'friend.added': '友だちが追加されたとき',
  'form.submitted': 'フォームが送られたとき',
  'booking.created': '予約が入ったとき',
  '*': 'すべての出来事',
}

const PAYLOAD_LABEL: Record<string, string> = {
  'conversion.confirmed': '注文番号・金額・お客様名',
  'friend.added': '名前・追加日・流入元',
  'form.submitted': '回答のすべて',
  'booking.created': '予約日時・メニュー・担当',
  '*': '選んだ出来事の項目',
}

function firstEventLabel(item: OutgoingWebhookOverview): string {
  const first = item.eventTypes[0]
  if (!first) return 'まだ決めていません'
  const label = EVENT_LABEL[first] ?? first
  return item.eventTypes.length > 1 ? `${label} ほか${item.eventTypes.length - 1}件` : label
}

function payloadLabel(item: OutgoingWebhookOverview): string {
  const first = item.eventTypes[0]
  return first ? PAYLOAD_LABEL[first] ?? '選んだ出来事の項目' : 'まだ決めていません'
}

/** URLの値やqueryを一覧へ出さず、相手を見分けられる範囲だけ残す。 */
function maskedUrl(value: string): string {
  try {
    const url = new URL(value)
    const firstPath = url.pathname.split('/').filter(Boolean)[0]
    return `${url.origin}${firstPath ? `/${firstPath}` : ''}/•••`
  } catch {
    return 'URLを確かめてください'
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function matchesOutgoing(item: OutgoingWebhookOverview, filter: OutgoingFilter, query: string): boolean {
  const q = query.trim()
  if (q && !`${item.name} ${firstEventLabel(item)} ${payloadLabel(item)}`.includes(q)) return false
  switch (filter) {
    case 'active': return item.isActive
    case 'paused': return !item.isActive
    case 'failed': return item.deliverySummary.failed > 0
    default: return true
  }
}

export type V8KpiCell = {
  key: string
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  sub: string
}

/*
 * 数の帯の4マス。口の形のまま（無い数は「—」。0にしない）。
 * 先月の集計は口に無いので、今月送ったの下は「成功 N回」と出す。
 */
export function outgoingKpiCells(args: {
  items: OutgoingWebhookOverview[] | null
  incomingCount: number | null
  summary: WebhookInteractionSummary | null
}): V8KpiCell[] {
  const { items, incomingCount, summary } = args
  const active = items === null ? null : items.filter((item) => item.isActive).length
  const paused = items === null ? null : items.length - (active ?? 0)
  const sent = summary?.outgoing ?? null
  const sentSuccess = summary ? Math.max(0, summary.outgoing - summary.failed) : null
  const failed = summary?.failed ?? null
  const received = summary?.incoming ?? null
  const num = (value: number | null) => (value === null ? '—' : formatNumber(value))
  return [
    {
      key: 'destinations', icon: <Send size={14} />, label: '送り先',
      value: items === null ? '—' : num(items.length), unit: '件',
      sub: active === null || paused === null ? ' ' : `動いている ${active}・止めている ${paused}`,
    },
    {
      key: 'sent', icon: <Inbox size={14} />, label: '今月送った',
      value: num(sent), unit: '回',
      sub: sentSuccess === null ? ' ' : `成功 ${num(sentSuccess)}回`,
    },
    {
      key: 'failed', icon: <Webhook size={14} />, label: '失敗',
      value: num(failed), unit: '件',
      sub: failed === null ? ' ' : '「やり取りの記録」からやり直せます',
    },
    {
      key: 'incoming', icon: <Link2 size={14} />, label: '受け取り',
      value: incomingCount === null ? '—' : num(incomingCount), unit: '件',
      sub: received === null ? ' ' : `今月 ${num(received)}回`,
    },
  ]
}

/*
 * V8 のタブの並び（`ZSbFY`）。件数は読めたときだけ付ける。
 * 見本の 9 は見本データ（受け取る5＋送る4）から数える。
 */
function v8Tabs(args: { outgoing: number | null; incoming: number | null }) {
  const count = (n: number | null) => (n === null ? '' : ` ${n}`)
  return [
    { key: 'outgoing', label: `こちらから送る${count(args.outgoing)}` },
    { key: 'incoming', label: `こちらで受け取る${count(args.incoming)}` },
    { key: 'api-tokens', label: 'API接続' },
    { key: 'sheets', label: 'Google Sheets' },
    { key: 'interactions', label: 'やり取りの記録' },
    { key: 'notify', label: '見本 9' },
  ]
}

export function WebhooksV8Head({ activeTab, outgoingCount, incomingCount }: {
  activeTab: string
  outgoingCount: number | null
  incomingCount: number | null
}) {
  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>外部連携</h1>
          <p className={styles.headDescription}>ほかのシステムと、友だちの動きをやり取りします。送る・受け取る・API・Google Sheets をここで決めます。</p>
        </div>
        <Button variant="secondary" href="/webhooks?tab=notify">見本から作る</Button>
      </div>
      <MergedTabs basePath="/webhooks" paramName="tab" tabs={v8Tabs({ outgoing: outgoingCount, incoming: incomingCount })} active={activeTab} />
    </>
  )
}

/*
 * V8 の帯ぶんの読み出し（送り先の一覧・受け取り数・やり取りの集計）。
 * API接続・Sheets・見本タブで使い回す。
 */
export function useV8BandData() {
  const { selectedAccountId } = useAccount()
  const [outgoingItems, setOutgoingItems] = useState<OutgoingWebhookOverview[] | null>(null)
  const [incomingCount, setIncomingCount] = useState<number | null>(null)
  const [summary, setSummary] = useState<WebhookInteractionSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    setOutgoingItems(null)
    setIncomingCount(null)
    setSummary(null)
    if (!selectedAccountId) return () => { cancelled = true }
    void Promise.allSettled([
      api.webhooks.outgoing.list(selectedAccountId),
      api.webhooks.incoming.list(selectedAccountId),
      api.webhooks.interactions.list(selectedAccountId, { periodDays: 30, page: 1, limit: 1 }),
    ]).then(([outgoingResult, incomingResult, interactionsResult]) => {
      if (cancelled) return
      if (outgoingResult.status === 'fulfilled' && outgoingResult.value.success) {
        setOutgoingItems(outgoingResult.value.data)
      }
      if (incomingResult.status === 'fulfilled' && incomingResult.value.success) {
        setIncomingCount(incomingResult.value.data.length)
      }
      if (interactionsResult.status === 'fulfilled' && interactionsResult.value.success && interactionsResult.value.data?.summary) {
        setSummary(interactionsResult.value.data.summary)
      }
    })
    return () => { cancelled = true }
  }, [selectedAccountId])

  return { outgoingItems, incomingCount, summary }
}

export function WebhooksV8Band({ cells, label }: {
  cells: V8KpiCell[]
  label?: string
}) {
  return (
    <section className={styles.kpiBand} aria-label={label ?? '外部連携の数の帯'}>
      {cells.map((cell) => (
        <div className={styles.kpiCell} key={cell.key}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiIcon} aria-hidden="true">{cell.icon}</span>
            <span className={styles.kpiLabel}>{cell.label}</span>
          </div>
          <p className={styles.kpiValue}>{cell.value}<span className={styles.kpiUnit}>{cell.unit}</span></p>
          <p className={styles.kpiSub}>{cell.sub}</p>
        </div>
      ))}
    </section>
  )
}

export default function OutgoingV8Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <OutgoingV8Inner />
    </Suspense>
  )
}

function OutgoingV8Inner() {
  usePageTitle('外部連携')
  const { selectedAccountId, accounts } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const togglingIdsRef = useRef<Set<string>>(new Set())

  const [outgoing, setOutgoing] = useState<OutgoingWebhookOverview[]>([])
  const [outgoingStatus, setOutgoingStatus] = useState<LoadStatus>('loading')
  const [incomingCount, setIncomingCount] = useState<number | null>(null)
  const [summary, setSummary] = useState<WebhookInteractionSummary | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<LoadStatus>('loading')
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [staffRole, setStaffRole] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OutgoingFilter>('all')
  const [sort, setSort] = useState<OutgoingSort>('volume')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)

  const [togglingKeys, setTogglingKeys] = useState<string[]>([])
  const [toggleFailures, setToggleFailures] = useState<Record<string, string>>({})
  const [toggleBusyNotices, setToggleBusyNotices] = useState<Record<string, string>>({})

  const [testingId, setTestingId] = useState<string | null>(null)
  const [testTarget, setTestTarget] = useState<OutgoingWebhookOverview | null>(null)
  const [testNotice, setTestNotice] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; accountId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [rotateTarget, setRotateTarget] = useState<{ id: string; name: string; activate: boolean; accountId: string } | null>(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const rotateModalRef = useOverlayFocus(!!rotateTarget, () => {
    setRotateTarget(null)
    setRotateSecretValue('')
  })

  /*
   * 送り先の変更（開始・停止・直す・合言葉・削除）は統括だけ（R32）。
   * 試し送信と失敗のやり直しは管理者も使える。見るだけの担当者は
   * 中身の確認と検索だけ（`l5SRfT`）。
   */
  const canManage = staffRole === null || staffRole === 'owner'
  const canTest = canManage || staffRole === 'admin'
  const manageReason = '統括だけが変更できます。必要なときは統括に頼んでください。'

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    const requestAccountId = selectedAccountId
    setOutgoing([])
    setIncomingCount(null)
    setSummary(null)
    setLoadedAccountId(null)
    setError('')
    if (!requestAccountId) {
      setOutgoingStatus('ready')
      setSummaryStatus('ready')
      return
    }
    setOutgoingStatus('loading')
    setSummaryStatus('loading')
    const [incomingResult, outgoingResult, interactionsResult] = await Promise.allSettled([
      api.webhooks.incoming.list(requestAccountId),
      api.webhooks.outgoing.list(requestAccountId),
      api.webhooks.interactions.list(requestAccountId, { periodDays: 30, page: 1, limit: 1 }),
    ])
    if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) return
    if (outgoingResult.status === 'fulfilled' && outgoingResult.value.success) {
      setOutgoing(outgoingResult.value.data)
      setOutgoingStatus('ready')
    } else {
      setOutgoing([])
      setOutgoingStatus('error')
    }
    if (incomingResult.status === 'fulfilled' && incomingResult.value.success) {
      setIncomingCount(incomingResult.value.data.length)
    }
    if (interactionsResult.status === 'fulfilled' && interactionsResult.value.success && interactionsResult.value.data?.summary) {
      setSummary(interactionsResult.value.data.summary)
      setSummaryStatus('ready')
    } else {
      setSummary(null)
      setSummaryStatus('error')
    }
    setLoadedAccountId(requestAccountId)
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const beginToggle = (key: string) => {
    togglingIdsRef.current.add(key)
    setTogglingKeys((current) => (current.includes(key) ? current : [...current, key]))
    setToggleFailures((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const endToggle = (key: string) => {
    togglingIdsRef.current.delete(key)
    setTogglingKeys((current) => current.filter((item) => item !== key))
    setToggleBusyNotices((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    const key = `outgoing:${id}`
    if (togglingIdsRef.current.has(key)) {
      const name = outgoing.find((item) => item.id === id)?.name ?? 'この送り先'
      setToggleBusyNotices((current) => ({ ...current, [key]: name }))
      return
    }
    beginToggle(key)
    try {
      const res = await api.webhooks.outgoing.update(id, requestAccountId, { isActive: !currentActive })
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        const name = outgoing.find((item) => item.id === id)?.name ?? 'この送り先'
        setToggleFailures((current) => ({ ...current, [key]: `「${name}」は切り替えできませんでした。状態は変わっていません。確かめてから、もう一度お試しください。` }))
        return
      }
      if (selectedAccountIdRef.current === requestAccountId) await load()
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      const name = outgoing.find((item) => item.id === id)?.name ?? 'この送り先'
      if (!forbidden) await load().catch(() => {})
      setToggleFailures((current) => ({
        ...current,
        [key]: forbidden
          ? `「${name}」は統括だけが切り替えできます。必要なときは統括に頼んでください。状態は変わっていません。`
          : `「${name}」は切り替えの応答を受け取れませんでした。一覧の表示を確かめてください。変わっている可能性があります。`,
      }))
    } finally {
      endToggle(key)
    }
  }

  const runTest = async (item: OutgoingWebhookOverview) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || testingId !== null) return
    setTestTarget(null)
    setTestingId(item.id)
    setTestNotice(null)
    try {
      const response = await api.webhooks.outgoing.test(item.id, requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (response.success && response.data.delivered) {
        const status = response.data.responseStatus
        notifyToast(`「${item.name}」への試し送信が届きました${status === null ? '' : `(相手の応答 ${status})`}。`)
      } else {
        const status = response.success ? response.data.responseStatus : null
        setTestNotice(`「${item.name}」への試し送信は届きませんでした${status === null ? '' : `(相手の応答 ${status})`}。「やり取りの記録」タブで詳しく確認できます。`)
      }
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setTestNotice(`「${item.name}」への試し送信に失敗しました。「やり取りの記録」タブで詳しく確認できます。`)
    } finally {
      setTestingId(null)
    }
  }

  const askDelete = (item: OutgoingWebhookOverview) => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    setDeleteError('')
    setDeleteTarget({ id: item.id, name: item.name, accountId: requestAccountId })
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return
    const requestAccountId = deleteTarget.accountId
    if (requestAccountId !== selectedAccountId || loadedAccountId !== requestAccountId) {
      setDeleteError('LINEアカウントが切り替わりました。削除する送り先を選び直してください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.webhooks.outgoing.delete(deleteTarget.id, requestAccountId)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountIdRef.current !== requestAccountId) return
      setDeleteTarget(null)
      await load()
    } catch (caught) {
      if (selectedAccountIdRef.current !== requestAccountId) return
      const forbidden = caught instanceof ApiError && caught.status === 403
      setDeleteError(forbidden
        ? 'この送り先の削除は統括だけができます。必要なときは統括に頼んでください。'
        : 'この送り先を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const handleRotateSubmit = async (e: React.FormEvent, stepUpToken?: string) => {
    e.preventDefault()
    setError('')
    const requestAccountId = selectedAccountId
    if (!requestAccountId || loadedAccountId !== requestAccountId) {
      return setError('LINEアカウントの一覧を読み直してください')
    }
    if (!rotateTarget) return
    if (rotateTarget.accountId !== requestAccountId) {
      setRotateTarget(null)
      setRotateSecretValue('')
      setError('LINEアカウントが切り替わりました。対象を選び直してください。')
      return
    }
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const res = await api.webhooks.outgoing.update(
        rotateTarget.id, requestAccountId,
        { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined },
        stepUpToken,
      )
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      void load()
    } catch (caught) {
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'webhook.secret', action: 'シークレットを更新する', retry: (token) => handleRotateSubmit(e, token) })
        return
      }
      if (selectedAccountIdRef.current !== requestAccountId) return
      setError(describeApiFailure(caught, 'シークレットの更新', {
        forbidden: '合言葉の更新は統括だけができます。必要なときは統括に頼んでください。',
      }))
    }
  }

  const filtered = useMemo(() => {
    const rows = outgoing.filter((item) => matchesOutgoing(item, filter, query))
    return [...rows].sort((a, b) => (sort === 'name'
      ? a.name.localeCompare(b.name, 'ja-JP')
      : b.deliverySummary.total - a.deliverySummary.total))
  }, [outgoing, filter, query, sort])

  useEffect(() => {
    setPage(1)
  }, [filter, query, sort, pageSize, selectedAccountId])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const clearFilters = () => {
    setQuery('')
    setFilter('all')
    setPage(1)
  }

  const readyCounts = outgoingStatus === 'ready'
  const activeCount = outgoing.filter((item) => item.isActive).length
  const pausedCount = outgoing.length - activeCount

  const listBody = (() => {
    if (outgoingStatus === 'loading') return <ListState kind="loading" title="送り先を読み込んでいます" />
    if (!selectedAccountId) {
      return (
        <ListState
          kind="empty"
          title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'}
        />
      )
    }
    if (outgoingStatus === 'error') {
      return (
        <ListState
          kind="error"
          title="送り先を読み込めませんでした"
          description="登録内容は消えていません。通信の状態を確認して、もう一度お試しください。"
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      )
    }
    if (outgoing.length === 0) {
      return (
        <ListState
          kind="empty"
          title="まだ、送り先はありません"
          description="送り先を作ると、友だちの動きをほかのシステムへ知らせられます。"
          action={canManage
            ? <Button variant="primary" href="/webhooks/new">＋ 送り先を作る</Button>
            : <Button variant="primary" disabled title={manageReason}>＋ 送り先を作る</Button>}
        />
      )
    }
    if (visible.length === 0) {
      return (
        <ListState
          kind="empty"
          title="条件に合う送り先はありません"
          description="検索や絞り込みを外すと、すべて出ます。"
          action={<Button onClick={clearFilters}>条件を外す</Button>}
        />
      )
    }
    return <OutgoingV8Table items={visible} canManage={canManage} canTest={canTest} manageReason={manageReason} menuId={menuId} setMenuId={setMenuId} togglingKeys={togglingKeys} testingId={testingId} onToggle={(id, active) => void handleToggle(id, active)} onRotate={(item) => { setRotateTarget({ id: item.id, name: item.name, activate: isHttpsUrl(item.url) && !item.hasSecret, accountId: selectedAccountId ?? '' }); setRotateSecretValue('') }} onDelete={askDelete} onTest={(item) => { setMenuId(null); setTestTarget(item) }} />
  })()

  return (
    <div className={styles.board} data-design-node="ZSbFY">
      <WebhooksV8Head activeTab="outgoing" outgoingCount={readyCounts ? outgoing.length : null} incomingCount={incomingCount} />
      <WebhooksV8Band cells={outgoingKpiCells({ items: outgoingStatus === 'ready' ? outgoing : null, incomingCount, summary: summaryStatus === 'ready' ? summary : null })} />

      <Notice tone="info">
        友だちの動きを、決めたタイミングでほかのシステムへ送ります。送るときは秘密の鍵を付けます。鍵は「設定」から作り直せます。
      </Notice>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {Object.entries(toggleFailures).map(([key, message]) => (
        <Notice key={key} tone="danger">{message}</Notice>
      ))}
      {Object.entries(toggleBusyNotices).map(([key, name]) => (
        <Notice key={key} tone="warn">「{name}」を送る設定：いま切り替えを送っています。返事が来るまでお待ちください。</Notice>
      ))}
      {testNotice ? <Notice tone="danger" message={testNotice} onClose={() => setTestNotice(null)} /> : null}

      <div className={styles.main}>
        <div className={styles.createRow}>
          {canManage
            ? <Button variant="primary" href="/webhooks/new">＋ 送り先を作る</Button>
            : <Button variant="primary" disabled title={manageReason}>＋ 送り先を作る</Button>}
          {canManage ? null : <p className={styles.guidance}>送り先の作成は統括だけができます。必要なときは統括に頼んでください。</p>}
        </div>

        <div className={styles.toolbar}>
          <span className={styles.searchWrap}>
            <SearchField
              value={query}
              onChange={(value) => setQuery(value)}
              onClear={() => setQuery('')}
              placeholder="つなぎ先を探す"
              aria-label="つなぎ先を探す"
            />
          </span>
          <FilterChip selected={filter === 'active'} onChange={(next) => setFilter(next ? 'active' : 'all')}>動いている{readyCounts ? ` ${activeCount}` : ''}</FilterChip>
          <FilterChip selected={filter === 'paused'} onChange={(next) => setFilter(next ? 'paused' : 'all')}>止めている{readyCounts ? ` ${pausedCount}` : ''}</FilterChip>
          <span className={styles.toolbarRight}>
            <Select
              aria-label="よく使う絞り込み"
              value={filter}
              onChange={(value) => { setFilter(value as OutgoingFilter); setPage(1) }}
              options={[
                { value: 'all', label: 'よく使う絞り込み' },
                { value: 'active', label: '動いているのみ' },
                { value: 'paused', label: '止めているのみ' },
                { value: 'failed', label: '失敗あり' },
              ]}
            />
            <SortSelect
              value={sort}
              onChange={(value) => setSort(value as OutgoingSort)}
              options={[{ value: 'volume', label: '送った回数が多い順' }, { value: 'name', label: '名前順' }]}
            />
            <PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 20, 50]} />
          </span>
        </div>

        {listBody}

        {outgoingStatus === 'ready' && filtered.length > 0 ? (
          <div className={styles.pagerRow}>
            <span className={styles.rangeText}>
              <ListRange total={filtered.length} first={(currentPage - 1) * pageSize + 1} last={(currentPage - 1) * pageSize + visible.length} />
            </span>
            <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} ariaLabel="送り先一覧のページ送り" />
          </div>
        ) : null}
        <p className={styles.footNote}>行の「設定」から 動かす・止める・直す・合言葉を作り直す・削除する・試しに送る。</p>
      </div>

      <ConfirmDialog
        open={testTarget !== null}
        title="試し送信をします"
        description={testTarget ? `「${testTarget.name}」へ、試し用のデータを1回だけ送ります。実際の連携先へ届きます。` : ''}
        confirmLabel="この送り先へ送る"
        cancelLabel="キャンセル"
        busy={testingId !== null}
        onConfirm={() => {
          if (testTarget) void runTest(testTarget)
        }}
        onCancel={() => setTestTarget(null)}
      >
        {testTarget ? (
          <div className="bg-canvas-sunken rounded-control p-3">
            <p className="text-ink-faint text-xs">送り先のURL</p>
            <code className="text-ink mt-1 block break-all text-sm">{testTarget.url}</code>
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`送信Webhook「${deleteTarget?.name ?? ''}」を削除しますか？`}
        description="この宛先への送信が止まり、これから起きる出来事は通知されなくなります。すでに送った記録は残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError || undefined}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (deleting) return
          setDeleteTarget(null)
          setDeleteError('')
        }}
      />

      {rotateTarget && (
        <div ref={rotateModalRef} className="fixed inset-0 bg-scrim flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => void handleRotateSubmit(e)} role="dialog" aria-modal="true" aria-labelledby="webhook-v8-rotate-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 id="webhook-v8-rotate-title" className="text-lg font-semibold text-ink">
                「{rotateTarget.name}」の合言葉を{rotateTarget.activate ? '設定して有効化' : '作り直す'}
              </h2>
            </div>
            <p className="text-sm text-ink-secondary mb-4">
              新しい合言葉を設定します。
              <strong className="text-danger">設定後は今回限り画面に表示されません。</strong>
              保存後も前の合言葉は24時間だけ使えるので、相手側の切り替え中も送信は止まりません。
            </p>
            <div className="flex gap-2 mb-4">
              <input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 border border-hairline rounded-control px-3 py-2 text-sm font-mono"
                placeholder="ランダムな英数字32文字以上"
                required
                minLength={MIN_SECRET_LENGTH}
                autoFocus
              />
              <Button type="button" onClick={() => setRotateSecretValue(generateSecret())}>
                自動生成
              </Button>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
              >
                キャンセル
              </Button>
              <Button type="submit" variant="primary">
                保存する
              </Button>
            </div>
          </form>
        </div>
      )}
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </div>
  )
}

function OutgoingV8Table({ items, canManage, canTest, manageReason, menuId, setMenuId, togglingKeys, testingId, onToggle, onRotate, onDelete, onTest }: {
  items: OutgoingWebhookOverview[]
  canManage: boolean
  canTest: boolean
  manageReason: string
  menuId: string | null
  setMenuId: (id: string | null) => void
  togglingKeys: string[]
  testingId: string | null
  onToggle: (id: string, active: boolean) => void
  onRotate: (item: OutgoingWebhookOverview) => void
  onDelete: (item: OutgoingWebhookOverview) => void
  onTest: (item: OutgoingWebhookOverview) => void
}) {
  const router = useRouter()
  const onEdit = (id: string) => router.push(`/webhooks/edit?id=${id}`)
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">つなぎ先</th>
            <th scope="col">いつ送るか</th>
            <th scope="col">送るもの</th>
            <th scope="col" style={{ textAlign: 'right' }}>この30日</th>
            <th scope="col">ようす</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const toggling = togglingKeys.includes(`outgoing:${item.id}`)
            const pending = item.deliverySummary.lastResult?.status === 'pending'
            const failed = !pending && (item.deliverySummary.lastResult?.status === 'failed' || item.deliverySummary.failed > 0)
            const completedAt = item.deliverySummary.lastResult?.completedAt
            const canActivate = item.hasSecret && isHttpsUrl(item.url)
            const menuItems: ActionMenuItem[] = []
            if (canManage) {
              menuItems.push({
                id: 'toggle',
                label: item.isActive ? '止める' : '動かす',
                onSelect: () => { setMenuId(null); onToggle(item.id, item.isActive) },
                disabled: !item.isActive && !canActivate,
                disabledReason: !item.isActive && !canActivate ? 'URLと合言葉を確かめてください' : undefined,
              })
              menuItems.push({ id: 'edit', label: '編集', external: true, onSelect: () => { setMenuId(null); onEdit(item.id) } })
              menuItems.push({ id: 'secret', label: '合言葉を作り直す', onSelect: () => { setMenuId(null); onRotate(item) } })
              menuItems.push({ id: 'delete', label: '削除する', tone: 'danger', onSelect: () => { setMenuId(null); onDelete(item) } })
            }
            menuItems.push({
              id: 'test',
              label: '試しに送る',
              onSelect: () => onTest(item),
              disabled: !canTest || !item.isActive,
              disabledReason: !item.isActive ? '止めている送り先には試し送信できません' : !canTest ? manageReason : undefined,
            })
            return (
              <tr key={item.id}>
                <td className={styles.nameCell}>
                  <span className={styles.nameText} title={item.name}>{item.name}</span>
                  <span className={styles.urlText} title={item.url}>{maskedUrl(item.url)}</span>
                </td>
                <td><span className={styles.cellSub} title={firstEventLabel(item)}>{firstEventLabel(item)}</span></td>
                <td><span className={styles.cellSub} title={payloadLabel(item)}>{payloadLabel(item)}</span></td>
                <td className={styles.countCell}>
                  {formatNumber(item.deliverySummary.total)}回
                  <span className={styles.countSub}>
                    {item.deliverySummary.failed > 0
                      ? `失敗 ${formatNumber(item.deliverySummary.failed)}回`
                      : `送信中 ${formatNumber(item.deliverySummary.pending)}回`}
                  </span>
                </td>
                <td>
                  <div className={styles.stateCell}>
                    <div>
                      <span className={`${styles.pill} ${failed ? styles.pillDanger : item.isActive ? styles.pillActive : styles.pillNeutral}`}>
                        ● {toggling ? '切り替え中' : failed ? '失敗あり' : item.isActive ? '動いている' : '止めている'}
                      </span>
                    </div>
                    <div title={completedAt ? `最終 ${formatDateTime(completedAt)}` : undefined}>
                      {completedAt ? `最終 ${formatDateTime(completedAt)}` : '—'}
                    </div>
                  </div>
                </td>
                <td className={styles.opsCell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {item.deliverySummary.canRetry
                      ? <Button href="/webhooks?tab=interactions">失敗をやり直す</Button>
                      : <Button href="/webhooks?tab=interactions">中身を見る</Button>}
                    <Button
                      aria-haspopup="menu"
                      aria-expanded={menuId === item.id}
                      onClick={() => setMenuId(menuId === item.id ? null : item.id)}
                    >
                      設定
                    </Button>
                    <ActionMenu
                      open={menuId === item.id}
                      onClose={() => setMenuId(null)}
                      ariaLabel={`「${item.name}」の設定`}
                      items={menuItems}
                      note={canManage ? undefined : manageReason}
                    />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
