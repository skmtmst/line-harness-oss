'use client'

/*
 * ★V8 デリバリー受注の親（Pencil：注文一覧 `kDQHr`・注文の詳細 `hjdqV`・
 * キャンセルの確認 `dgeTy`・注文履歴・売上 `OzHLO`・品切れ一括設定 `h7OeT`・
 * 受付の一括停止 `XCVGd`）。
 *
 * 取得と送信はこの画面だけが持つ。子の板（orders・history・bulk）と窓（order-detail）は
 * 受け取った数と状態を出すだけにする。
 * 急ぎ度の判定はWorker側だけで行い、画面には結果と理由の文しか来ない（仕組みの名前は出さない）。
 * 受け付ける URL は `?tab=`（新着・調理中・受け渡し済み・すべて）・`?view=`（history・sold-out）・
 * `?id=`（注文の詳細）。
 * 画面の移動は useSamePageUrl を通す（絞り込みだけの書き換えで読み直しが起きないようにする）。
 * 動きは BEHAVIOR.md。
 */

import { PackageX, Pause, RefreshCw } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { ApiError } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import { DEFAULT_PAGE_SIZE } from '@/components/shared/page-size-select'
import ListState from '@/components/shared/list-state'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import Notice, { type NoticeTone } from '@/components/shared/notice'
import { PREPARING_WORD, usePreparingDialog } from '@/components/shared/preparing-dialog'
import EntitySelect from '@/components/shared/entity-select'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useSamePageUrl } from '@/lib/use-same-page-url'
import { restaurantTestApi, type RestaurantStore } from '@/lib/restaurant-test-api'
import {
  DELIVERY_SERVICE_LABELS,
  restaurantDeliveryApi,
  type DeliveryCancelReasonCode,
  type DeliveryHistoryData,
  type DeliveryIntakeStopPreset,
  type DeliveryMenuItem,
  type DeliveryOrderDetailData,
  type DeliveryOrderMutationData,
  type DeliveryOrderSummary,
  type DeliveryOrderTab,
  type DeliveryOrdersData,
  type DeliveryService,
} from '@/lib/restaurant-delivery-api'
import { BoundaryBanner, RestaurantPage } from '@/v8/restaurant/common-a/public/frame/index'
import OrdersBoard from './orders'
import { CancelOrderDialog, OrderDetailDialog } from './order-detail'
import HistoryBoard from './history'
import SoldOutBoard, { IntakeStopDialog } from './bulk'
import { DASH, errorMessage, formatClock, storeToday } from './format'
import { useUberConnection } from './use-uber-connection'
import styles from './delivery.module.css'

/** 板の印（撮影と見張りの試験が読む）。 */
const VIEW_BOARDS = {
  orders: 'kDQHr',
  history: 'OzHLO',
  'sold-out': 'h7OeT',
} as const

type DeliveryView = keyof typeof VIEW_BOARDS

/*
 * 板の頭と中身の余白は共通の器（RestaurantPage）の既定に任せる（数字で渡さない）。
 * 題の大きさだけ、注文履歴と品切れ一括設定は小さい題（絵 OzHLO・h7OeT）。
 */
const VIEW_HEAD: Record<DeliveryView, { titleSize?: 'sub' }> = {
  orders: {},
  history: { titleSize: 'sub' },
  'sold-out': { titleSize: 'sub' },
}

const TABS: DeliveryOrderTab[] = ['all', 'new', 'cooking', 'handed_over']

/** 自動で読み直す間（絵の「30秒ごとに自動更新」）。予約一覧と同じ間にする。 */
const REFRESH_MS = 30_000

/** 板の頭。題と説明は絵の文のまま。 */
const PAGE_META: Record<DeliveryView, { title: string; description: string }> = {
  orders: {
    title: 'デリバリー受注',
    description: '保存済みの注文を確認できます。Uber Eats の注文の取り込みと操作はまだ利用できません',
  },
  history: {
    title: '注文履歴・売上',
    description: '日付とサービスを指定して、過去の注文と売上を確認できます',
  },
  'sold-out': {
    title: '品切れ一括設定',
    description: '保存済みの商品を確認できます。Uber Eats を含む商品の品切れ・販売再開・メニュー同期はまだ利用できません',
  },
}

function DeliveryInner() {
  const searchParams = useSearchParams()
  const samePageUrl = useSamePageUrl()
  const { selectedAccountId, setSelectedAccountId, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  const preparing = usePreparingDialog({ note: '接続の完了とは別の機能です。注文の取り込み・受ける・断る・取消・準備完了・営業状態の変更・メニュー同期はまだ利用できません。保存済みの注文や商品、過去の履歴は確認できます。' })
  /* 閲覧のみの人には送るボタンを置かず、閲覧のみの帯を出す（Worker側の 403 が最後の守り）。役割を読み込む前も置かない。 */
  const canManage = role !== null && canManageRole(role)
  // 接続情報の読み口も管理者専用。閲覧のみでは照会せず、接続未確認として扱う。
  const uberConnectionStatus = useUberConnection(canManage ? selectedAccountId : null)

  /* ── URL から今の見た目を決める ───────────────────────────── */
  const requestedView = searchParams.get('view')
  const view: DeliveryView = requestedView && requestedView in VIEW_BOARDS
    ? (requestedView as DeliveryView)
    : 'orders'
  const requestedTab = searchParams.get('tab') as DeliveryOrderTab | null
  const tab: DeliveryOrderTab = requestedTab && TABS.includes(requestedTab) ? requestedTab : 'new'
  const orderId = searchParams.get('id')

  const meta = PAGE_META[view]
  usePageTitle(meta.title)
  usePageCrumbs(view === 'orders'
    ? [{ label: '飲食店向け（テスト）', href: '/restaurant-test/dashboard' }]
    : [{ label: 'デリバリー受注', href: '/restaurant-test/delivery' }])

  /* ── 注文一覧（kDQHr） ───────────────────────────────────── */
  const [data, setData] = useState<DeliveryOrdersData | null>(null)
  const [stores, setStores] = useState<RestaurantStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<string[]>([])
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [busyService, setBusyService] = useState<DeliveryService | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  /* ── 注文の詳細（hjdqV）とキャンセル（dgeTy） ─────────────── */
  const [detail, setDetail] = useState<DeliveryOrderDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState<DeliveryCancelReasonCode>('out_of_stock')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  /* ── 注文履歴・売上（OzHLO） ─────────────────────────────── */
  const [history, setHistory] = useState<DeliveryHistoryData | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyDate, setHistoryDate] = useState(() => storeToday())
  const [historyService, setHistoryService] = useState<DeliveryService | ''>('')
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPerPage, setHistoryPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvNote, setCsvNote] = useState<string | null>(null)

  /* ── 品切れ一括設定（h7OeT） ─────────────────────────────── */
  const [items, setItems] = useState<DeliveryMenuItem[] | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [soldOutOnly, setSoldOutOnly] = useState(false)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [itemsPage, setItemsPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(DEFAULT_PAGE_SIZE)
  const [soldOutBusy, setSoldOutBusy] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)

  /* ── 受付の一括停止（XCVGd） ─────────────────────────────── */
  const [stopOpen, setStopOpen] = useState(false)
  const [stopSelected, setStopSelected] = useState<DeliveryService[]>([])
  /* 絵（XCVGd）で選ばれている札は「60分」なので、窓を開いた最初もそこに合わせる。 */
  const [stopPreset, setStopPreset] = useState<DeliveryIntakeStopPreset>('60m')
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  /* 404 は「店舗が無い」ことなので、他の失敗と文を分ける（Googleビジネスと同じ）。 */
  const ordersErrorText = useCallback((err: unknown) => (
    err instanceof ApiError && err.status === 404
      ? 'このLINEアカウントには店舗が紐付いていません。先に店舗管理でLINEアカウントを割り当ててください。'
      : errorMessage(err, '注文を読み込めませんでした。')
  ), [])

  /**
   * 注文一覧の読み込み。
   * `silent` のときは回る印も失敗の帯も出さない（30秒ごとの読み直しで画面が点滅しないため）。
   * 失敗したときは最後に読めた時刻をそのまま残し、古い数字を今の数字に見せない。
   */
  const loadOrders = useCallback(async (silent = false) => {
    if (!selectedAccountId) {
      setData(null)
      setStores([])
      setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const [orders, snapshot] = await Promise.all([
        restaurantDeliveryApi.orders(selectedAccountId, { tab }),
        restaurantTestApi.snapshot(selectedAccountId).catch(() => null),
      ])
      setData(orders)
      setStores(snapshot?.data.stores ?? [])
      setLoadedAt(Date.now())
      setError('')
    } catch (err) {
      if (silent) return
      setData(null)
      setError(ordersErrorText(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [selectedAccountId, tab, ordersErrorText])

  useEffect(() => { void loadOrders() }, [loadOrders])

  /* 30秒ごとに読み直し、経過の列も進める。 */
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
      void loadOrders(true)
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadOrders])

  /* タブを変えたら見せる件数と選択を初めに戻す。 */
  useEffect(() => {
    setPage(1)
    setSelected([])
  }, [tab])

  const loadDetail = useCallback(async (id: string, silent = false) => {
    if (!selectedAccountId) return
    if (!silent) {
      setDetailLoading(true)
      setDetailError(null)
    }
    try {
      const next = await restaurantDeliveryApi.order(selectedAccountId, id)
      setDetail(next)
      setDetailError(null)
    } catch (err) {
      if (silent) return
      setDetail(null)
      setDetailError(errorMessage(err, '注文を読み込めませんでした。'))
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (!orderId) {
      setDetail(null)
      setDetailError(null)
      setCancelOpen(false)
      return
    }
    void loadDetail(orderId)
  }, [orderId, loadDetail])

  const loadHistory = useCallback(async () => {
    if (!selectedAccountId) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const next = await restaurantDeliveryApi.history(selectedAccountId, {
        from: historyDate,
        to: historyDate,
        ...(historyService ? { service: historyService } : {}),
      })
      setHistory(next)
      setHistoryPage(1)
    } catch (err) {
      setHistory(null)
      setHistoryError(errorMessage(err, '注文履歴を読み込めませんでした。'))
    } finally {
      setHistoryLoading(false)
    }
  }, [selectedAccountId, historyDate, historyService])

  useEffect(() => {
    if (view !== 'history') return
    void loadHistory()
  }, [view, loadHistory])

  const loadItems = useCallback(async () => {
    if (!selectedAccountId) return
    setItemsLoading(true)
    setItemsError(null)
    try {
      const next = await restaurantDeliveryApi.menuItems(selectedAccountId)
      setItems(next.items)
    } catch (err) {
      setItems(null)
      setItemsError(errorMessage(err, '商品を読み込めませんでした。'))
    } finally {
      setItemsLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (view !== 'sold-out') return
    void loadItems()
  }, [view, loadItems])

  /* ── 画面の移動（読み直しが起きない書き換え） ───────────────── */
  const go = useCallback((
    params: Record<string, string | undefined>,
    mode: 'push' | 'replace' = 'push',
  ) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value)
    const search = next.toString()
    const href = `/restaurant-test/delivery${search ? `?${search}` : ''}`
    if (mode === 'replace') samePageUrl.replace(href)
    else samePageUrl.push(href)
  }, [samePageUrl])

  const viewParam = view === 'orders' ? undefined : view
  const tabParam = tab === 'new' ? undefined : tab

  const openOrder = useCallback((id: string) => {
    go({ view: viewParam, tab: tabParam, id })
  }, [go, viewParam, tabParam])

  const closeDetail = useCallback(() => {
    setCancelOpen(false)
    go({ view: viewParam, tab: tabParam }, 'replace')
  }, [go, viewParam, tabParam])

  /* ── 送信（一覧と詳細のどちらからでも同じ道を通る） ─────────── */
  const runOrderAction = useCallback(async (
    id: string,
    action: (accountId: string, orderId: string) => Promise<DeliveryOrderMutationData>,
    successText: string,
    fallback: string,
  ) => {
    const order = data?.orders.find((item) => item.id === id) ?? (detail?.order.id === id ? detail.order : null)
    if (!canManage || !selectedAccountId || !order || order.service === 'ubereats') return
    setBusyOrderId(id)
    setDetailBusy(true)
    setNotice(null)
    try {
      await action(selectedAccountId, id)
      setNotice({ tone: 'success', text: successText })
      await loadOrders(true)
      if (orderId === id) await loadDetail(id, true)
    } catch (err) {
      setNotice({ tone: 'danger', text: errorMessage(err, fallback) })
    } finally {
      setBusyOrderId(null)
      setDetailBusy(false)
    }
  }, [canManage, data, detail, selectedAccountId, loadOrders, loadDetail, orderId])

  const acceptOrder = useCallback((order: DeliveryOrderSummary | { id: string }) => {
    void runOrderAction(
      order.id,
      restaurantDeliveryApi.accept,
      '注文を受け付けました。',
      '注文を受け付けられませんでした。',
    )
  }, [runOrderAction])

  const rejectOrder = useCallback((order: DeliveryOrderSummary | { id: string }) => {
    void runOrderAction(
      order.id,
      restaurantDeliveryApi.reject,
      '注文を拒否しました。',
      '注文を拒否できませんでした。',
    )
  }, [runOrderAction])

  const readyOrder = useCallback((order: DeliveryOrderSummary | { id: string }) => {
    void runOrderAction(
      order.id,
      restaurantDeliveryApi.ready,
      '準備完了にしました。',
      '準備完了にできませんでした。',
    )
  }, [runOrderAction])

  /*
   * 「まとめて受け付ける」。まとめ送りの口はWorkerに無いので、ここで1件ずつ順に送る。
   * 途中で失敗しても残りは続け、終わったあとに数で伝える。
   */
  const bulkAccept = useCallback(async () => {
    if (!canManage || !selectedAccountId || selected.length === 0) return
    const targets = (data?.orders ?? []).filter(
      (order) => order.status === 'new' && order.service !== 'ubereats' && selected.includes(order.id),
    )
    if (targets.length === 0) return
    setBulkBusy(true)
    setNotice(null)
    let done = 0
    let failed = 0
    for (const order of targets) {
      try {
        await restaurantDeliveryApi.accept(selectedAccountId, order.id)
        done += 1
      } catch {
        failed += 1
      }
    }
    setSelected([])
    setBulkBusy(false)
    await loadOrders(true)
    if (failed === 0) {
      setNotice({ tone: 'success', text: `${done}件の注文を受け付けました。` })
    } else {
      setNotice({
        tone: 'warn',
        text: `${done}件を受け付けました。${failed}件は受け付けられませんでした。もう一度お試しください。`,
      })
    }
  }, [canManage, selectedAccountId, selected, data, loadOrders])

  const submitCancel = useCallback(async () => {
    const order = detail?.order
    if (!canManage || !selectedAccountId || !order || order.service === 'ubereats') return
    setCancelBusy(true)
    setCancelError(null)
    try {
      await restaurantDeliveryApi.cancel(selectedAccountId, order.id, cancelReason)
      setCancelOpen(false)
      setNotice({ tone: 'success', text: '注文をキャンセルしました。' })
      await loadOrders(true)
      closeDetail()
    } catch (err) {
      setCancelError(errorMessage(err, 'キャンセルできませんでした。'))
    } finally {
      setCancelBusy(false)
    }
  }, [canManage, selectedAccountId, detail, cancelReason, loadOrders, closeDetail])

  /* ── 受付の停止・再開 ───────────────────────────────────── */
  const openStop = useCallback((service?: DeliveryService) => {
    if (!canManage || service === 'ubereats') return
    const open = (data?.services ?? []).filter((state) => state.intakeStatus === 'open' && state.service !== 'ubereats')
    setStopSelected(service
      ? [service]
      : open.map((state) => state.service))
    setStopPreset('60m')
    setStopError(null)
    setStopOpen(true)
  }, [canManage, data])

  const submitStop = useCallback(async () => {
    if (!canManage || !selectedAccountId || stopSelected.length === 0 || stopSelected.includes('ubereats')) return
    setStopBusy(true)
    setStopError(null)
    try {
      const result = await restaurantDeliveryApi.stopIntake(selectedAccountId, stopSelected, stopPreset)
      setStopOpen(false)
      await loadOrders(true)
      if (result.failed.length === 0) {
        setNotice({ tone: 'success', text: `${result.stopped.length}件のサービスの受付を停止しました。` })
      } else {
        setNotice({
          tone: 'warn',
          text: `${result.stopped.length}件を停止しました。${result.failed.length}件は停止できませんでした。もう一度お試しください。`,
        })
      }
    } catch (err) {
      setStopError(errorMessage(err, '受付を停止できませんでした。'))
    } finally {
      setStopBusy(false)
    }
  }, [canManage, selectedAccountId, stopSelected, stopPreset, loadOrders])

  const resumeService = useCallback(async (service: DeliveryService) => {
    if (!canManage || !selectedAccountId || service === 'ubereats') return
    setBusyService(service)
    setNotice(null)
    try {
      const result = await restaurantDeliveryApi.resumeIntake(selectedAccountId, [service])
      await loadOrders(true)
      setNotice(result.failed.length === 0
        ? { tone: 'success', text: `${DELIVERY_SERVICE_LABELS[service]}の受付を再開しました。` }
        : { tone: 'warn', text: `${DELIVERY_SERVICE_LABELS[service]}の受付を再開できませんでした。もう一度お試しください。` })
    } catch (err) {
      setNotice({ tone: 'danger', text: errorMessage(err, '受付を再開できませんでした。') })
    } finally {
      setBusyService(null)
    }
  }, [canManage, selectedAccountId, loadOrders])

  /* ── 品切れの送信 ───────────────────────────────────────── */
  const submitSoldOut = useCallback(async (soldOut: boolean) => {
    if (!canManage || !selectedAccountId || selectedItems.length === 0 || selectedItems.some((id) => !items?.some((item) => item.id === id && !item.services.some(({ service }) => service === 'ubereats')))) return
    setSoldOutBusy(true)
    setNotice(null)
    try {
      const result = await restaurantDeliveryApi.bulkSoldOut(selectedAccountId, selectedItems, soldOut)
      setSelectedItems([])
      await loadItems()
      const done = result.updated.length
      const word = soldOut ? '品切れにしました' : '販売を再開しました'
      setNotice(result.failed.length === 0
        ? { tone: 'success', text: `${done}品を${word}。` }
        : { tone: 'warn', text: `${done}品を${word}。${result.failed.length}品は変更できませんでした。もう一度お試しください。` })
    } catch (err) {
      setNotice({ tone: 'danger', text: errorMessage(err, '品切れの設定を変更できませんでした。') })
    } finally {
      setSoldOutBusy(false)
    }
  }, [canManage, items, selectedAccountId, selectedItems, loadItems])

  const toggleOneSoldOut = useCallback(async (id: string, soldOut: boolean) => {
    if (!canManage || !selectedAccountId || !items?.some((item) => item.id === id && !item.services.some(({ service }) => service === 'ubereats'))) return
    setBusyItemId(id)
    setNotice(null)
    try {
      const result = await restaurantDeliveryApi.bulkSoldOut(selectedAccountId, [id], soldOut)
      await loadItems()
      if (result.failed.length > 0) {
        setNotice({ tone: 'warn', text: '商品の状態を変更できませんでした。もう一度お試しください。' })
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: errorMessage(err, '商品の状態を変更できませんでした。') })
    } finally {
      setBusyItemId(null)
    }
  }, [canManage, items, selectedAccountId, loadItems])

  /* ── CSVで保存 ─────────────────────────────────────────── */
  const saveCsv = useCallback(async () => {
    if (!selectedAccountId) return
    setCsvBusy(true)
    setCsvNote(null)
    setNotice(null)
    try {
      const result = await restaurantDeliveryApi.historyCsv(selectedAccountId, {
        from: historyDate,
        to: historyDate,
        ...(historyService ? { service: historyService } : {}),
      })
      if (result.truncated) {
        setCsvNote(`上限のため${result.returnedCount ?? 0}件まで保存しました（全${result.totalCount ?? 0}件）。期間やサービスを絞ってもう一度保存してください。`)
      } else {
        setNotice({ tone: 'success', text: 'CSVを保存しました。' })
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: errorMessage(err, 'CSVを保存できませんでした。') })
    } finally {
      setCsvBusy(false)
    }
  }, [selectedAccountId, historyDate, historyService])

  /* ── 絞り込み（品切れ一括設定） ───────────────────────────── */
  const filteredItems = useMemo(() => {
    const list = items ?? []
    const needle = query.trim().toLowerCase()
    return list.filter((item) => {
      if (soldOutOnly && !item.soldOut) return false
      if (!needle) return true
      return `${item.name} ${item.category ?? ''}`.toLowerCase().includes(needle)
    })
  }, [items, query, soldOutOnly])

  const soldOutCount = items ? items.filter((item) => item.soldOut).length : undefined

  /* ── 板の頭の右 ───────────────────────────────────────── */
  const currentStoreId = useMemo(() => (
    stores.find((item) => item.line_account_id === selectedAccountId)?.id
      ?? stores.find((item) => item.id === data?.store.id)?.id
      ?? ''
  ), [stores, selectedAccountId, data])

  // 作ってある店舗から選ぶ欄なので、共通の EntitySelect（EntityPickerField）を使う。
  // 置き場（フォルダ）は無いので kind は渡さない。
  const storePicker = stores.length > 0 ? (
    <EntitySelect
      aria-label="店舗"
      noun="店舗"
      value={currentStoreId}
      onChange={(value) => {
        const next = stores.find((item) => item.id === value)
        if (next?.line_account_id && next.line_account_id !== selectedAccountId) {
          setSelectedAccountId(next.line_account_id)
        }
      }}
      options={stores.map((item) => ({
        value: item.id,
        label: item.name,
        disabled: !item.line_account_id,
      }))}
    />
  ) : null

  const picker = view === 'sold-out' || view === 'history' ? undefined : (
    <div className={styles.headActions}>
      {/* 絵の板の頭は「題 → 間 → 更新（印＋名 nDOMR）→ 品切れ設定 → 一括停止」の並び。 */}
      <div className={styles.refreshRow}>
        <RefreshCw
          className={`${styles.refreshIcon}${loading ? ` ${styles.spin}` : ''}`}
          aria-hidden="true"
        />
        <p className={styles.muted}>
          30秒ごとに自動更新・最終 {loadedAt === null ? DASH : formatClock(new Date(loadedAt).toISOString())}
        </p>
      </div>
      {storePicker}
      {canManage ? (
        <>
          <Button onClick={() => go({ view: 'sold-out' })}>
            <PackageX size={16} aria-hidden="true" />
            品切れ一括設定
          </Button>
          <Button variant="danger-outline" onClick={() => openStop()}>
            <Pause size={16} aria-hidden="true" />
            受付をまとめて止める
          </Button>
        </>
      ) : null}
    </div>
  )

  /* ── 中身 ─────────────────────────────────────────────── */
  const ordersBody = (() => {
    if (!selectedAccountId) {
      return (
        <ListState
          kind="empty"
          title="LINE公式アカウントを選んでください"
          description="画面の上でLINE公式アカウントを選ぶと、そのアカウントの店舗の注文を表示します。"
        />
      )
    }
    if ((loading || accountLoading) && !data) {
      return <ListState kind="loading" title="注文を読み込んでいます" />
    }
    if (error && !data) {
      return (
        <ListState
          kind="error"
          title="注文を表示できませんでした"
          description={error}
          onRetry={() => { void loadOrders() }}
        />
      )
    }
    if (!data) return null
    return (
      <OrdersBoard
        data={data}
        uberConnectionStatus={uberConnectionStatus}
        page={page}
        perPage={perPage}
        busyOrderId={busyOrderId}
        busyService={busyService}
        canManage={canManage}
        nowMs={nowMs}
        selected={selected}
        bulkBusy={bulkBusy}
        onToggleSelect={(id, checked) => setSelected((prev) => (
          checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)
        ))}
        onToggleSelectAll={(checked) => setSelected(checked
          ? data.orders.filter((order) => order.status === 'new' && order.service !== 'ubereats').map((order) => order.id)
          : [])}
        onBulkAccept={() => { void bulkAccept() }}
        onTab={(next) => go({ tab: next === 'new' ? undefined : next })}
        onOpenHistory={() => go({ view: 'history' })}
        onOpenOrder={openOrder}
        onAccept={acceptOrder}
        onReject={rejectOrder}
        onReady={readyOrder}
        onStopService={(service) => openStop(service)}
        onResumeService={(service) => { void resumeService(service) }}
        onPage={setPage}
        onPerPage={(next) => { setPerPage(next); setPage(1) }}
      />
    )
  })()

  const body = view === 'history' ? (
    <HistoryBoard
      data={history}
      loading={historyLoading}
      error={historyError}
      isToday={historyDate === storeToday(nowMs)}
      page={historyPage}
      perPage={historyPerPage}
      csvNote={csvNote}
      onOpenOrder={openOrder}
      onRetry={() => { void loadHistory() }}
      date={historyDate}
      service={historyService}
      csvBusy={csvBusy}
      csvDisabled={(history?.orders.length ?? 0) === 0}
      onDateChange={setHistoryDate}
      onServiceChange={setHistoryService}
      onCsv={() => { void saveCsv() }}
      onPage={setHistoryPage}
      onPerPage={(next) => { setHistoryPerPage(next); setHistoryPage(1) }}
    />
  ) : view === 'sold-out' ? (
    <SoldOutBoard
      loading={itemsLoading}
      error={itemsError}
      items={filteredItems}
      total={items?.length ?? 0}
      selected={selectedItems}
      page={itemsPage}
      perPage={itemsPerPage}
      query={query}
      soldOutOnly={soldOutOnly}
      soldOutCount={soldOutCount}
      onQueryChange={(value) => { setQuery(value); setItemsPage(1) }}
      onSoldOutOnlyChange={(value) => { setSoldOutOnly(value); setItemsPage(1) }}
      busy={soldOutBusy}
      busyItemId={busyItemId}
      canManage={canManage}
      onToggle={(id, checked) => setSelectedItems((prev) => (
        checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)
      ))}
      onToggleAll={(checked) => setSelectedItems(checked
        ? filteredItems.slice((itemsPage - 1) * itemsPerPage, itemsPage * itemsPerPage).filter((item) => !item.services.some(({ service }) => service === 'ubereats')).map((item) => item.id)
        : [])}
      onToggleOne={(id, soldOut) => { void toggleOneSoldOut(id, soldOut) }}
      onSubmit={(soldOut) => { void submitSoldOut(soldOut) }}
      onRetry={() => { void loadItems() }}
      onPage={setItemsPage}
      onPerPage={(next) => { setItemsPerPage(next); setItemsPage(1) }}
    />
  ) : ordersBody

  const detailOrder = detail?.order ?? null

  return (
    <RestaurantPage
      boardId={VIEW_BOARDS[view]}
      title={meta.title}
      description={meta.description}
      titleSize={VIEW_HEAD[view].titleSize}
      picker={picker}
    >
      {role !== null && !canManage ? <ReadOnlyNotice /> : null}
      <BoundaryBanner note="デリバリー3社とは検証用の接続・本番の注文は流れません" />

      <Button onClick={() => preparing.open('Uber Eats の注文の連携')}>{`Uber Eats の注文の連携は${PREPARING_WORD}`}</Button>

      {notice ? (
        <Notice tone={notice.tone} density="compact" onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      ) : null}

      {body}

      {/*
       * キャンセルの確認（絵 dgeTy）は、注文の詳細の上に重ねない。
       * 絵は確認の窓だけを板の上に描いている。詳細を開いたままにすると
       * 後ろの窓の文字が確認の窓に隠れて切れる（重なり）。
       * orderId は残すので、確認の「戻る」で詳細へそのまま戻れる。
       */}
      {preparing.dialog}
      <OrderDetailDialog
        open={Boolean(orderId) && !cancelOpen}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        busy={detailBusy}
        canManage={canManage}
        onClose={closeDetail}
        onRetry={() => { if (orderId) void loadDetail(orderId) }}
        onAccept={() => { if (detailOrder) acceptOrder(detailOrder) }}
        onReject={() => { if (detailOrder) rejectOrder(detailOrder) }}
        onReady={() => { if (detailOrder) readyOrder(detailOrder) }}
        onCancelOrder={() => {
          setCancelReason('out_of_stock')
          setCancelError(null)
          setCancelOpen(true)
        }}
      />

      <CancelOrderDialog
        open={cancelOpen}
        orderNumber={detailOrder?.orderNumber ?? ''}
        serviceLabel={detailOrder
          ? detailOrder.serviceLabel || DELIVERY_SERVICE_LABELS[detailOrder.service]
          : DASH}
        totalAmount={detailOrder?.totalAmount ?? null}
        reasonCode={cancelReason}
        busy={cancelBusy}
        error={cancelError}
        onReasonChange={setCancelReason}
        onClose={() => setCancelOpen(false)}
        onSubmit={() => { void submitCancel() }}
      />

      <IntakeStopDialog
        open={stopOpen}
        services={data?.services ?? []}
        selected={stopSelected}
        preset={stopPreset}
        busy={stopBusy}
        error={stopError}
        onToggleService={(service, checked) => setStopSelected((prev) => (
          checked ? [...new Set([...prev, service])] : prev.filter((item) => item !== service)
        ))}
        onPresetChange={setStopPreset}
        onClose={() => setStopOpen(false)}
        onSubmit={() => { void submitStop() }}
      />
    </RestaurantPage>
  )
}

export default function DeliveryPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <DeliveryInner />
    </Suspense>
  )
}
