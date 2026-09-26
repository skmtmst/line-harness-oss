'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { api, bookingApi, type BookingAdminDetail, type BookingMenu, type BookingRequest, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import FolderPanel, { FOLDER_RAIL_WIDTH } from '@/components/shared/folder-panel'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canOperateBookings } from '../lib/booking-permissions'
import { fetchAllPages } from './fetch-all-pages'
import BookingCalendar, {
  moveDay,
  startOfWeek,
  type CalendarAvailability,
  type CalendarSlot,
} from './booking-calendar'

/**
 * 予約管理（設計 V2 8-1 / node EAYvf）。
 *
 * 設計は「見出し ＋ 4枚のKPI ＋ 左のメニュー棚 ＋ 検索の帯 ＋ 表 ＋ 注記 ＋ 件数と頁送り」。
 * 以前は青い帯で予約URLを見せ、状態のタブを上に並べていた。作りとしては
 * 動いていたが、設計のどこにも無い形だったので組み直した。
 *
 * 状態の絞り込みは「よく使う」の並びに移した。設計にある「変更依頼のみ」は
 * その状態そのものが bookings に無いので、実際にある状態を並べている。
 */

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '未承認' },
  { key: 'confirmed', label: '確定' },
  // N-398: 完了・来店なしも台帳の状態として絞れるようにする。
  { key: 'completed', label: '完了' },
  { key: 'no_show', label: '来店なし' },
  { key: 'rejected', label: '拒否' },
  { key: 'expired', label: '期限切れ' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'all', label: '全件' },
]

/** 種別（予約経路）の絞り込み。bookings.source の CHECK 制約と同じ語彙。 */
const SOURCE_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '経路: すべて' },
  { key: 'liff', label: 'LINE' },
  { key: 'phone', label: '電話' },
  { key: 'counter', label: '店頭' },
  { key: 'operator', label: 'スタッフ入力' },
  { key: 'import', label: '取り込み' },
]

const statusBadgeColor: Record<string, string> = {
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
  rejected: 'bg-canvas-sunken text-ink-secondary',
  expired: 'bg-canvas-sunken text-ink-secondary',
  cancelled: 'bg-canvas-sunken text-ink-secondary',
  completed: 'bg-info-bg text-info',
  no_show: 'bg-danger-bg text-danger',
}

const statusLabel: Record<string, string> = {
  requested: 'リクエスト',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '無断',
}

const actionLabel: Record<string, string> = {
  approve: '承認',
  reject: '拒否',
  cancel: 'キャンセル',
  no_show: '無断キャンセル',
  complete: '完了',
}

/** 1ページに出す件数。設計の「表示 20件」に合わせる。 */
const PAGE_SIZE = 20

function formatJpDateTime(iso: string): string {
  // 不正な日時が来たら Invalid Date を出さず「—」に逃がす(点検#516軽6)。
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

/** 表の日時。設計は年を出していない（08/18 14:00）。 */
function formatShort(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function formatJpTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function jstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

function monthKey(offset: number): string {
  const now = new Date(Date.now() + 9 * 3600_000)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  return d.toISOString().slice(0, 7)
}

export default function BookingsPage() {
  usePageTitle('予約管理')
  const { selectedAccountId, selectedAccount } = useAccount()
  const urlParams = useSearchParams()
  const [view, setView] = useState<'day' | 'week' | 'month' | 'list'>('day')
  const [tab, setTab] = useState<string>('requested')
  /** 「今日」「今週」の絞り込み。設計の「よく使う」にある。 */
  const [range, setRange] = useState<'all' | 'today' | 'week'>('all')
  /*
   * URLの `?view=` `?status=` `?range=` で絞り込み済みの一覧を開ける
   * （IDEA-01）。ダッシュボードの「予約状況」カードは
   * `?view=list&status=requested` でここへ来る。初回だけURLを状態へ
   * 写し、知らない値は既定へ落とす。
   */
  const urlInitRef = useRef(false)
  useEffect(() => {
    if (urlInitRef.current) return
    urlInitRef.current = true
    const viewParam = urlParams.get('view')
    if (viewParam === 'week' || viewParam === 'month' || viewParam === 'list') setView(viewParam)
    const statusParam = urlParams.get('status')
    if (statusParam && STATUS_TABS.some((item) => item.key === statusParam)) setTab(statusParam)
    const rangeParam = urlParams.get('range')
    if (rangeParam === 'today' || rangeParam === 'week') setRange(rangeParam)
  }, [urlParams])
  const [menuFilter, setMenuFilter] = useState<string>('all')
  // N-398: 担当者・予約経路の絞り込み。一覧の取得とCSV書出しの両方に渡す。
  const [staffFilter, setStaffFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [staffList, setStaffList] = useState<BookingStaff[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<BookingRequest[]>([])
  const [total, setTotal] = useState(0)
  const [calendarItems, setCalendarItems] = useState<BookingRequest[]>([])
  /*
   * BOOKING-01: カレンダーが実際に表示している日・週の基点。以前は内部で
   * 持ち、取得範囲は常に「今日起点」だったため、翌週へ進んでも予約が
   * 読まれず全マスが空きに見えた。表示範囲と取得範囲を一致させる。
   */
  const [calendarAnchor, setCalendarAnchor] = useState(() => jstDay(new Date().toISOString()))
  const calendarFrom = view === 'week' ? startOfWeek(calendarAnchor) : calendarAnchor
  const calendarTo = view === 'week' ? moveDay(calendarFrom, 6) : calendarAnchor
  /*
   * BOOKING-01: 空き枠の実績。カレンダーのマス数から空きを推測しない。
   * - unconfigured: 担当0またはメニュー0。受付可能時間0として「—」を出す。
   * - error: 設定・空き枠の読み込みに失敗。0枠・0%とは区別する。
   * - loading / ready: 読み込み中 / 実績あり。
   */
  const [candidatesStatus, setCandidatesStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [availability, setAvailability] = useState<CalendarAvailability>({ status: 'loading', slots: [] })
  const [summary, setSummary] = useState({
    total: 0, requested: 0, monthTotal: 0, monthConfirmed: 0,
    monthCancelled: 0, lastMonthTotal: 0, todayTotal: 0, weekTotal: 0,
    byMenu: [] as Array<{ name: string; total: number }>,
  })
  const [menus, setMenus] = useState<BookingMenu[]>([])
  // 集計の読み込み失敗は0表示と分ける。黙って0のままだと運用者が気づけない。
  const [summaryError, setSummaryError] = useState(false)
  // ★V7 `x63W5x`：集計が取れていない間、KPI に 0 を出さない。「—」と出す。
  const [summaryReady, setSummaryReady] = useState(false)
  const [summarySeq, setSummarySeq] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copied 状態は URL 単位で持つ。アカウント切替で shareUrl が変わると
  // 自動で「コピー済」が消えるので、A の URL をコピーしたまま B 画面で
  // 「B フォームと思い込んで送信」する事故を防ぐ。
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  // コピー済み表示を消すタイマー。外したままにすると警告の元になる(点検#516軽6)。
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
  }, [])
  const [decideTarget, setDecideTarget] = useState<{ id: string; action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete' } | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decideError, setDecideError] = useState('')
  /* 台帳CSVの書出し中。失敗は一覧の error 帯へ出す（TECH-03）。 */
  const [csvBusy, setCsvBusy] = useState(false)
  /*
   * 一覧取得の応答が「どのアカウント・どの条件へ向けたものか」を照合する。
   * アカウントを切り替えたあとに遅れて届いた前のアカウントの応答で、
   * いま見ている一覧を上書きしない(#963)。
   */
  const listRequestRef = useRef(0)
  const listAccountRef = useRef<string | null>(selectedAccountId)
  listAccountRef.current = selectedAccountId
  // N-401: 閲覧のみの人には操作ボタンを見せない。読み込めるまでは隠す
  // （権限のある人に一瞬見せて消すより、静かに出すほうが誤操作を防ぐ）。
  const [canOperate, setCanOperate] = useState(false)
  useEffect(() => {
    let active = true
    void api.staff.me()
      .then((response) => { if (active) setCanOperate(response.success && canOperateBookings(response.data)) })
      .catch(() => { if (active) setCanOperate(false) })
    return () => { active = false }
  }, [])
  // 詳細パネルは行の実体ではなく id を保持する。承認などで再読み込みしたあとも
  // 最新の行を引き直せるので、パネルに古い状態が残らない。
  const [detailId, setDetailId] = useState<string | null>(null)

  const liffId = selectedAccount?.liffId ?? null
  // Worker `/o` は ref 解決・追跡なしで liffId を直接受けるラップ URL。
  // `liff.line.me` を直貼りすると OpenChat / IG DM 等で削除されるため、
  // LINE 内配信も SNS 配信もこの 1 本で完結させる。/o は LINE 内 UA でも
  // 「LINEで開く」ボタン経由で Universal Link → LIFF を起動する。
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const shareUrl =
    workerBase && liffId
      ? `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book`
      : null
  // N-396: お客さま自身の予約履歴を開くURL。LIFF側は page=salon-book&view=history で
  // 履歴画面を開く。/o は view を salon-book の history だけ通す。
  const historyUrl =
    workerBase && liffId
      ? `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book&view=history`
      : null
  const isCopied = (url: string | null) => url !== null && copiedUrl === url
  /** コピーできなかったURL。隣の欄を選んでもらう一言を出す（ブラウザの入力窓は使わない。V6R-S3-f）。 */
  const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null)

  async function copyUrl(url: string | null) {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setCopyFailedUrl(null)
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => {
        setCopiedUrl((cur) => (cur === url ? null : cur))
      }, 2000)
    } catch {
      // URL は押したボタンの隣の読取専用欄に出ている。窓は出さず、選んでコピーしてもらう。
      setCopyFailedUrl(url)
    }
  }

  // 一覧とCSVで同じ期間になるよう、from/to の計算は1か所にする (N-397)。
  const rangeFilterParams = useCallback((): { from?: string; to?: string } => {
    if (range === 'all') return {}
    const today = jstDay(new Date().toISOString())
    const weekTo = jstDay(new Date(Date.now() + 7 * 86_400_000).toISOString())
    return {
      from: new Date(`${today}T00:00:00+09:00`).toISOString(),
      to: range === 'today'
        ? new Date(`${jstDay(new Date(Date.now() + 86_400_000).toISOString())}T00:00:00+09:00`).toISOString()
        : new Date(`${weekTo}T00:00:00+09:00`).toISOString(),
    }
  }, [range])

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    // 要求が向かったアカウントを固定する(#963)。応答時に現在値と照合し、
    // 別アカウントへ切り替わったあとの遅い応答は一覧へ反映しない。
    const requestedAccountId = selectedAccountId
    const requestId = ++listRequestRef.current
    setLoading(true)
    setError(null)
    // タブ/アカウント切り替えで先に list をクリア。fetch 失敗時に前タブの行が
    // 残ってしまい、誤って別ステータスの予約を操作してしまう事故を防ぐ。
    setItems([])
    try {
      const r = await bookingApi.listRequests(requestedAccountId, tab, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        query: query.trim() || undefined,
        menuName: menuFilter === 'all' ? undefined : menuFilter,
        staffId: staffFilter === 'all' ? undefined : staffFilter,
        source: sourceFilter === 'all' ? undefined : sourceFilter,
        ...rangeFilterParams(),
      })
      if (requestId !== listRequestRef.current || listAccountRef.current !== requestedAccountId) return
      setItems(r.requests)
      setTotal(r.total)
    } catch (e) {
      if (requestId !== listRequestRef.current || listAccountRef.current !== requestedAccountId) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (requestId === listRequestRef.current && listAccountRef.current === requestedAccountId) setLoading(false)
    }
  }, [menuFilter, page, query, rangeFilterParams, selectedAccountId, sourceFilter, staffFilter, tab])

  useEffect(() => {
    load()
    // 条件が変わった時点で走っている要求を無効化し、遅い応答が
    // 新しい条件の一覧へ紛れ込まないようにする(#963)。
    return () => {
      listRequestRef.current += 1
    }
  }, [load])

  /*
   * アカウントを切り替えたら、前のアカウントの行・詳細・候補を残さない(#963)。
   * 詳細パネルは id だけを持つので、一覧が入れ替わる間に前のアカウントの
   * 行を引いて別アカウントの画面へ出さない。候補(メニュー棚・担当)も
   * 取り直しが届くまで前のアカウントの選択肢を見せない。
   */
  useEffect(() => {
    setItems([])
    setTotal(0)
    setCalendarItems([])
    setDetailId(null)
    // 確定操作の確認窓・失敗表示も前のアカウントのものは残さない。
    // 残すと、別アカウントの予約へ向けた操作を新しいアカウントで
    // 確定してしまう(#963)。
    setDecideTarget(null)
    setDecideError('')
    setError(null)
    setMenus([])
    setStaffList([])
    setCopiedUrl(null)
    setCandidatesStatus('loading')
    setAvailability({ status: 'loading', slots: [] })
    setSummaryError(false)
    setSummaryReady(false)
    setSummary({
      total: 0, requested: 0, monthTotal: 0, monthConfirmed: 0,
      monthCancelled: 0, lastMonthTotal: 0, todayTotal: 0, weekTotal: 0,
      byMenu: [],
    })
  }, [selectedAccountId])

  /*
   * N-397: 今見えている絞り込みのまま台帳CSVを出す。上限・範囲の断りは
   * CSV先頭の注記行にサーバが書く。
   * TECH-03: 直リンクは Cookie が届かない経路で取れないため、
   * 認証付きの取得からファイル保存へ揃える。
   */
  const downloadLedgerCsv = () => {
    if (!selectedAccountId || csvBusy) return
    setCsvBusy(true)
    void bookingApi.downloadLedgerCsv(selectedAccountId, {
      status: tab,
      query: query.trim() || undefined,
      menuName: menuFilter === 'all' ? undefined : menuFilter,
      staffId: staffFilter === 'all' ? undefined : staffFilter,
      source: sourceFilter === 'all' ? undefined : sourceFilter,
      ...rangeFilterParams(),
    })
      .catch(() => setError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。'))
      .finally(() => setCsvBusy(false))
  }

  // KPIとメニュー棚は集計口から読む。一覧全件をブラウザへ運ばない。
  useEffect(() => {
    if (!selectedAccountId) return
    // 要求が向かったアカウントを固定する(#963)。集計・メニュー棚・担当の
    // 候補も、切替後に届いた前のアカウントの応答では更新しない。
    const requestedAccountId = selectedAccountId
    let alive = true
    setSummaryError(false)
    setSummaryReady(false)
    setCandidatesStatus('loading')
    void (async () => {
      try {
        const today = jstDay(new Date().toISOString())
        const [counts, menuList, staffResult] = await Promise.all([
          bookingApi.requestsSummary(requestedAccountId, {
            month: monthKey(0), lastMonth: monthKey(-1), today,
            weekTo: jstDay(new Date(Date.now() + 6 * 86_400_000).toISOString()),
          }),
          bookingApi.listMenus(requestedAccountId),
          bookingApi.listStaff(requestedAccountId),
        ])
        if (!alive || listAccountRef.current !== requestedAccountId) return
        setSummary(counts)
        setSummaryReady(true)
        setMenus(menuList.menus)
        setStaffList(staffResult.staff.filter((item) => item.is_active === 1))
        setCandidatesStatus('ready')
      } catch {
        // KPI が出ないだけで一覧は使える。ここで画面全体を止めない。
        // ただし0のまま黙ると気づけないので、KPI欄の上に理由と再試行を出す。
        // BOOKING-01: メニュー・担当の候補も同じ失敗なので、カレンダー側へ
        // 「未取得」と伝える（未設定と取り違えて0枠扱いにしない）。
        if (alive && listAccountRef.current === requestedAccountId) {
          setSummaryError(true)
          setCandidatesStatus('error')
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedAccountId, summarySeq])

  // カレンダーは表示中の日/週の範囲だけをページごとに読み、100件を越えても
  // 欠落させない。BOOKING-01: 取得範囲はカレンダーの表示範囲（anchor）と
  // 一致させる。前へ・次へで動いた週の予約も読み直し、読んでいない週を
  // 「全部空き」のように見せない。
  useEffect(() => {
    if (!selectedAccountId || (view !== 'day' && view !== 'week')) return
    // 要求が向かったアカウントを固定する(#963)。ページをまたぐ取得の途中で
    // 切り替わっても、前のアカウントの行を集め続けない。
    const requestedAccountId = selectedAccountId
    let alive = true
    void (async () => {
      const range = {
        from: new Date(`${calendarFrom}T00:00:00+09:00`).toISOString(),
        to: new Date(`${moveDay(calendarTo, 1)}T00:00:00+09:00`).toISOString(),
      }
      // 2ページ目以降は同時に取る（V6R-S3-c）。途中でアカウントが替わったら集めない（#963）。
      const collected = await fetchAllPages(
        (offset) => bookingApi.listRequests(requestedAccountId, 'all', { limit: 100, offset, ...range }),
        100,
        () => alive && listAccountRef.current === requestedAccountId,
      )
      if (collected === null) return
      if (alive && listAccountRef.current === requestedAccountId) setCalendarItems(collected)
    })().catch(() => {
      if (alive && listAccountRef.current === requestedAccountId) setError('カレンダーの読み込みに失敗しました。もう一度読み込んでください。')
    })
    return () => { alive = false }
  }, [selectedAccountId, view, calendarFrom, calendarTo])

  /*
   * BOOKING-01: 空き枠の実績を空き枠APIから取る。受付可能な時間は
   * 営業時間・担当シフト・例外日・外部予定・既存予約・同時受付数を
   * サーバー側で考慮した結果なので、カレンダーのマス数から推測しない。
   * メニューごとに取って、全メニューの枠をマージする。
   */
  useEffect(() => {
    if (!selectedAccountId || (view !== 'day' && view !== 'week')) return
    if (candidatesStatus === 'loading') {
      setAvailability({ status: 'loading', slots: [] })
      return
    }
    if (candidatesStatus === 'error') {
      setAvailability({ status: 'error', slots: [] })
      return
    }
    const activeMenus = menus.filter((item) => item.is_active === 1)
    if (activeMenus.length === 0 || staffList.length === 0) {
      setAvailability({ status: 'unconfigured', slots: [] })
      return
    }
    const requestedAccountId = selectedAccountId
    let alive = true
    // 読み直し中は前の範囲の枠を残さない。別の週の枠が新しい週の
    // 空きとして一瞬でも出ると、取れない入口を踏ませる。
    setAvailability({ status: 'loading', slots: [] })
    void (async () => {
      try {
        /*
         * #1060: メニュー分の往復を1要求の一括口へまとめる。
         * 一括口をまだ持たない Worker では 400/404 で落ちるので、
         * そのときだけ従来のメニューごと取得へ退く（段階配備の互換）。
         */
        const slots: CalendarSlot[] = []
        try {
          const batch = await bookingApi.getAvailabilityBatch(requestedAccountId, {
            menuIds: activeMenus.map((menu) => menu.id),
            from: calendarFrom,
            to: calendarTo,
          })
          if (!alive || listAccountRef.current !== requestedAccountId) return
          for (const perMenu of batch.by_menu) {
            for (const perStaff of perMenu.by_staff) {
              for (const slot of perStaff.slots) {
                slots.push({ staffId: perStaff.staff_id, staffName: perStaff.display_name, menuId: perMenu.menu_id, ...slot })
              }
            }
          }
        } catch {
          const responses = await Promise.all(
            activeMenus.map((menu) =>
              bookingApi.getAvailability(requestedAccountId, {
                menuId: menu.id,
                from: calendarFrom,
                to: calendarTo,
              }),
            ),
          )
          if (!alive || listAccountRef.current !== requestedAccountId) return
          responses.forEach((response, index) => {
            for (const perStaff of response.by_staff) {
              for (const slot of perStaff.slots) {
                slots.push({ staffId: perStaff.staff_id, staffName: perStaff.display_name, menuId: activeMenus[index].id, ...slot })
              }
            }
          })
        }
        setAvailability({ status: 'ready', slots })
      } catch {
        if (alive && listAccountRef.current === requestedAccountId) {
          setAvailability({ status: 'error', slots: [] })
        }
      }
    })()
    return () => { alive = false }
  }, [selectedAccountId, view, calendarFrom, calendarTo, candidatesStatus, menus, staffList])

  type BookingAction = 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete'

  /**
   * 予約の状態を変える。**押す前に確認を出す。**
   *
   * ブラウザの `confirm()` / `alert()` は見た目がブラウザ任せで、設計の
   * 確認窓と違ううえ、**画像比較に写らない**（確認と失敗の絵をそもそも
   * 撮れない）。失敗は窓の中に出して、押した場所から動かさない。
   */
  async function runDecide(id: string, action: BookingAction) {
    if (!selectedAccountId) return
    // 操作が向かったアカウントを固定する(#963)。応答を待つ間に
    // 切り替わっていても、新しいアカウントの確認窓・失敗表示を触らない。
    const decideAccountId = selectedAccountId
    setDeciding(true)
    setDecideError('')
    try {
      await bookingApi.decideRequest(decideAccountId, id, action)
      /*
       * 再読み込みも同じアカウントのときだけ(#979 A27-03)。`load` は
       * 操作開始時のアカウントを掴んだ古い実体なので、切替後に呼ぶと
       * 新しいアカウントの一覧を空にしたまま読み込み状態が残る。
       * 切替済みなら、切替の効果が新しいアカウントの取得を始めている。
       */
      if (listAccountRef.current === decideAccountId) {
        setDecideTarget(null)
        await load()
      }
    } catch (e) {
      if (listAccountRef.current === decideAccountId) {
        setDecideError(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      setDeciding(false)
    }
  }

  function handleDecide(id: string, action: BookingAction) {
    setDecideError('')
    setDecideTarget({ id, action })
  }

  const kpi = {
    total: summary.monthTotal,
    diff: summary.monthTotal - summary.lastMonthTotal,
    confirmed: summary.monthConfirmed,
    cancelled: summary.monthCancelled,
    rate: summary.monthTotal > 0 ? Math.round((summary.monthCancelled / summary.monthTotal) * 100) : null,
  }
  const menuCounts = new Map(summary.byMenu.map((item) => [item.name, item.total]))
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const shown = items

  /*
   * 「まだ予約が無い」と「絞り込みで0件」は言い分ける（#635）。
   * summary.total はアカウントの予約総数なので、0 なら条件以前に
   * 予約そのものが無い。集計が取れていないときは安全側に「条件に合う」へ倒す。
   * 状態タブは初期値が「未承認」なので、空の言い分けには使わず、
   * 「絞り込みを解除」の要否だけに使う（既定タブのまま解除を出しても
   * 全件へ戻す動線として意味を持つ）。
   */
  const nonTabNarrowing =
    query.trim() !== '' ||
    menuFilter !== 'all' ||
    staffFilter !== 'all' ||
    sourceFilter !== 'all' ||
    range !== 'all'
  const hasAnyBooking = summaryError || summary.total > 0
  const showFilteredEmpty = hasAnyBooking || nonTabNarrowing
  const clearListFilters = () => {
    setQuery('')
    setMenuFilter('all')
    setStaffFilter('all')
    setSourceFilter('all')
    setRange('all')
    setTab('all')
  }

  // 絞り込みが変わったら1ページ目に戻す。3ページ目のまま条件を狭めると
  // 「該当なし」に見えてしまう。
  useEffect(() => {
    setPage(1)
  }, [tab, menuFilter, query, range, staffFilter, sourceFilter])

  // タブ切替やアカウント切替で items が入れ替わったとき、開いていた予約が
  // 一覧から消えることがある。その場合はパネルを閉じる。
  const detail = detailId
    ? (calendarItems.find((b) => b.id === detailId) ?? items.find((b) => b.id === detailId) ?? null)
    : null
  useEffect(() => {
    if (detailId && !calendarItems.some((b) => b.id === detailId) && !items.some((b) => b.id === detailId)) {
      setDetailId(null)
    }
  }, [calendarItems, items, detailId])

  const todayCount = summary.todayTotal
  const weekCount = summary.weekTotal

  const pageHead = (
    <>
      <div data-design="Toolbar" className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs" aria-label="パンくず">
          <span>予約</span>
          <span className="mx-1.5">/</span>
          <span>予約管理</span>
        </nav>
      </div>
      <nav aria-label="予約の表示" className="border-hairline mb-4 flex items-center gap-7 border-b">
        {/*
          ★V7：集計が取れていない間、タブの件数に 0 を出さない。件数は出さない。
        */}
        {([
          ['day', summaryReady ? `今日 ${todayCount}` : '今日'],
          ['week', summaryReady ? `今週 ${weekCount}` : '今週'],
          ['month', summaryReady ? `今月 ${kpi.total}` : '今月'],
          ['list', '一覧'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`border-b-2 px-1 py-3 text-sm font-semibold ${
              view === key ? 'border-accent text-accent-deep' : 'border-transparent text-ink-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </>
  )

  /*
   * 作る操作は一覧のすぐ上の左の並びへ。見出しの行の右端には置かない。
   * N-401: 閲覧のみの人には代理予約の入口を出さない。
   */
  const createRow = canOperate ? (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="primary" href="/booking/bookings/new">電話の予約を入れる</Button>
    </div>
  ) : null

  const dialogs = (
    <>
      {detail && (
        <BookingDetailPanel
          booking={detail}
          accountId={selectedAccountId}
          canOperate={canOperate}
          onClose={() => setDetailId(null)}
          onAction={(a) => handleDecide(detail.id, a)}
        />
      )}
      <ConfirmDialog
        open={decideTarget !== null}
        title={`この予約を「${decideTarget ? actionLabel[decideTarget.action] : ''}」にしますか？`}
        description={
          // N-390: LINE未連携の予約へ「届きます」と出すと事実と違う。
          decideTarget && (calendarItems.find((b) => b.id === decideTarget.id) ?? items.find((b) => b.id === decideTarget.id))?.friend_id
            ? '予約した人へ、この結果がLINEで届きます。取り消すには、もう一度状態を変える必要があります。'
            : 'LINEと結びついていないため、お客様への自動連絡はありません。取り消すには、もう一度状態を変える必要があります。'
        }
        confirmLabel={decideTarget ? actionLabel[decideTarget.action] : '実行する'}
        destructive={decideTarget?.action === 'reject' || decideTarget?.action === 'cancel' || decideTarget?.action === 'no_show'}
        busy={deciding}
        error={decideError || undefined}
        onCancel={() => { setDecideTarget(null); setDecideError('') }}
        onConfirm={() => { if (decideTarget) void runDecide(decideTarget.id, decideTarget.action) }}
      />
    </>
  )

  if (view === 'day' || view === 'week') {
    return (
      <div>
        {pageHead}
        {createRow}
        {/*
          ★V7 `x63W5x`：同じ失敗を1画面に1つへ。失敗の1枚はカレンダーの場所に
          出す（#634 の読み直す口は保つ）。一覧が読めている間はカレンダーを出す。
        */}
        {error ? (
          <div className="mb-4">
            <ListState
              kind="error"
              title="予約を読み込めませんでした"
              description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
              onRetry={() => void load()}
            />
          </div>
        ) : (
          <BookingCalendar
            mode={view}
            items={calendarItems}
            onOpen={setDetailId}
            staffNames={staffList.map((item) => item.display_name)}
            canCreate={canOperate}
            anchorDay={calendarAnchor}
            onAnchorChange={setCalendarAnchor}
            availability={availability}
            dataState={loading ? 'loading' : 'ready'}
            /*
             * #634: 空き枠の失敗からその場で読み直す。空き枠は集計・メニュー・
             * 担当の候補が先に要るので、同じ取得列（summarySeq）を回し直す。
             * 候補が揃うと空き枠の取得はuseEffectの依存で自動的に再実行される。
             */
            onRetryAvailability={() => setSummarySeq((n) => n + 1)}
          />
        )}
        {dialogs}
      </div>
    )
  }

  return (
    <div>
      {pageHead}

      {/*
        ★V7 `x63W5x`：一覧の失敗でページ上のピンクの帯は出さない。
        一覧の場所の ListState error だけにまとめる。
      */}

      {summaryError && (
        // ★V7 `x63W5x`：補助のデータ（集計）だけ取れないときは、その場所に
        // 小さく1行だけ。一覧はそのまま使える。文言は契約試験が守る。
        <p className="text-ink-secondary mb-4 text-xs" role="status">
          集計を読み込めませんでした。一覧はそのまま使えます。
          <button type="button" className="text-action ml-2 font-semibold hover:underline" onClick={() => setSummarySeq((n) => n + 1)}>もう一度読み込む</button>
        </p>
      )}

      {/*
        ★V7 `x63W5x`：取れない KPI は「—」。読み込み中は「読み込んでいます」、
        失敗は「読み込めませんでした」と言い分け、0（本当に0件）と混ぜない。
      */}
      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="今月の予約"
          value={summaryReady ? kpi.total : null}
          unit="件"
          detail={summaryError ? '読み込めませんでした' : !summaryReady ? '読み込んでいます' : `前月比 ${kpi.diff >= 0 ? '+' : ''}${kpi.diff}`}
        />
        <Kpi title="確定" value={summaryReady ? kpi.confirmed : null} unit="件" detail={summaryError ? '読み込めませんでした' : !summaryReady ? '読み込んでいます' : '来店予定'} />
        {/* 設計は「変更依頼 / 要対応」。bookings の状態に「変更依頼」が無いので
            承認待ちを出す。要対応であることは変わらない。 */}
        <Kpi
          title="変更依頼"
          value={summaryReady ? summary.requested : null}
          unit="件"
          detail={summaryError ? '読み込めませんでした' : !summaryReady ? '読み込んでいます' : '要対応'}
        />
        <Kpi
          title="キャンセル"
          value={summaryReady ? kpi.cancelled : null}
          unit="件"
          detail={summaryError ? '読み込めませんでした' : !summaryReady ? '読み込んでいます' : kpi.rate === null ? '率 —' : `率 ${kpi.rate}%`}
        />
      </div>

      {createRow}

      <div
        data-design="Body"
        className="flex flex-col items-start gap-4 xl:flex-row"
      >
        <div data-design="Folders" className="shrink-0" style={{ width: FOLDER_RAIL_WIDTH }}>
          <FolderPanel
            heading="メニュー"
            rows={[
              { id: 'all', label: 'すべて', count: summary.total },
              ...menus.map((menu) => ({
                id: menu.name,
                label: menu.name,
                count: menuCounts.get(menu.name) ?? 0,
              })),
            ]}
            activeId={menuFilter}
            onSelect={setMenuFilter}
            total={`${summary.total} 件`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div
            data-design="Bar"
            className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="お客さま名で検索"
              aria-label="お客さま名で検索"
              className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            {/* N-398: 担当者と種別（予約経路）の絞り込み。一覧と件数の両方に効く。 */}
            <Select
              aria-label="担当者で絞り込む"
              value={staffFilter}
              onChange={setStaffFilter}
              options={[
                { value: 'all', label: '担当: すべて' },
                ...staffList.map((item) => ({ value: item.id, label: item.display_name })),
              ]}
            />
            <Select
              aria-label="予約経路で絞り込む"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={SOURCE_FILTERS.map((item) => ({ value: item.key, label: item.label }))}
            />
            {/* N-397: 今の絞り込みのままCSVへ。範囲の断りはCSV先頭行に入る。 */}
            {selectedAccountId ? (
              <Button variant="secondary" disabled={csvBusy} onClick={downloadLedgerCsv}>
                {csvBusy ? '書き出しています…' : 'CSVで書き出す'}
              </Button>
            ) : null}
            {/*
              #670 17: 押せない「保存した条件」(準備中です)は置かない。
              押せない口を並べると「まだ何かある」と読める。条件の保存が
              要るときは、動く形で足し直す。
            */}
          </div>

          <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-ink-faint text-xs">よく使う</span>
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-pill px-3 py-1 text-xs font-medium transition-colors ${
                  tab === key
                    ? 'bg-accent-deep text-on-accent'
                    : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="border-hairline mx-1 h-4 border-l" />
            <button
              onClick={() => setRange(range === 'today' ? 'all' : 'today')}
              className={`rounded-pill px-3 py-1 text-xs font-medium ${
                range === 'today'
                  ? 'bg-accent-deep text-on-accent'
                  : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
              }`}
            >
              今日
            </button>
            <button
              onClick={() => setRange(range === 'week' ? 'all' : 'week')}
              className={`rounded-pill px-3 py-1 text-xs font-medium ${
                range === 'week'
                  ? 'bg-accent-deep text-on-accent'
                  : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
              }`}
            >
              今週
            </button>
          </div>

          {!selectedAccountId ? (
            <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
              サイドバーでアカウントを選択してください
            </div>
          ) : loading ? (
            <div className="bg-canvas rounded-card border-hairline border">
              <ListState kind="loading" title="予約を読み込んでいます" />
            </div>
          ) : error ? (
            // ★V7 `x63W5x`：失敗を「まだありません」と言わない。
            // 空の案内と作成ボタンは出さない。
            <div className="bg-canvas rounded-card border-hairline border">
              <ListState
                kind="error"
                title="予約を読み込めませんでした"
                description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
                onRetry={() => void load()}
              />
            </div>
          ) : shown.length === 0 ? (
            <div className="bg-canvas rounded-card border-hairline border">
              {showFilteredEmpty ? (
                <ListState
                  kind="empty"
                  title="条件に合う予約はありません"
                  description="検索語や絞り込みを変えてください。"
                  action={nonTabNarrowing || tab !== 'all' ? <Button variant="secondary" onClick={clearListFilters}>絞り込みを解除</Button> : undefined}
                />
              ) : (
                <ListState
                  kind="empty"
                  title="まだ予約はありません"
                  description="予約が入ると、ここに日時とお客さまが並びます。"
                  action={canOperate ? <Button variant="primary" href="/booking/bookings/new">電話の予約を入れる</Button> : undefined}
                />
              )}
            </div>
          ) : (
            <div
              data-design="Table"
              className="bg-canvas rounded-card border-hairline overflow-hidden border"
            >
              {/* @container: 谷間帯の列削減。表の幅が足りない間だけ「担当」を畳む。
                  担当は予約の詳細で読める補助情報。畳んでいる間も操作列は右端に留める。 */}
              <div className="overflow-x-auto @container">
                <table className="w-full min-w-[720px] @[830px]:min-w-[820px]">
                  <thead>
                    <tr className="bg-canvas-sunken border-hairline border-b">
                      <Th>日時</Th>
                      <Th>お客さま</Th>
                      <Th>メニュー</Th>
                      <Th className="cq-hide-below-830">担当</Th>
                      <Th>予約経路</Th>
                      <Th className="text-right">料金</Th>
                      <Th>状態</Th>
                      <Th className="bg-canvas-sunken sticky right-0 text-right">操作</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map((b) => (
                      <tr key={b.id} className="group hover:bg-canvas-sunken">
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          {formatShort(b.starts_at)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {b.friend_id ? (
                            <Link
                              href={`/chats?friend=${b.friend_id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {b.friend_name ?? '-'}
                            </Link>
                          ) : (
                            <span>{b.friend_name ?? 'LINE未連携のお客さま'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{b.menu_name}</td>
                        <td className="cq-hide-below-830 px-4 py-3 text-sm">{b.staff_name}</td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`${b.friend_id ? 'bg-success-bg text-success' : 'bg-info-bg text-info'} rounded-pill px-2 py-0.5 text-xs`}
                          >
                            {b.friend_id ? 'LINE' : '電話'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums">
                          ¥{b.price_at_booking.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs ${statusBadgeColor[b.status] ?? 'bg-canvas-sunken'}`}
                          >
                            {statusLabel[b.status] ?? b.status}
                          </span>
                        </td>
                        <td className="bg-canvas group-hover:bg-canvas-sunken sticky right-0 px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setDetailId(b.id)}
                              className="text-ink-secondary bg-canvas-sunken rounded-md px-3 py-1 text-xs font-medium hover:bg-hairline"
                            >
                              詳細
                            </button>
                            {/* N-401: 閲覧のみの人には状態を変えるボタンを出さない */}
                            {canOperate ? (
                              <ActionButtons
                                status={b.status}
                                onAction={(a) => handleDecide(b.id, a)}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div data-design="note" className="bg-canvas-sunken rounded-card mt-3 p-3">
            <p className="text-ink-secondary text-xs leading-5">
              友だち予約URLと、友だちが自分の予約履歴を見るURLをそれぞれ発行できます。予約履歴URLを配ると「自分の予約を確認したい」という問い合わせを減らせます。
            </p>
            {shareUrl ? (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    aria-label="友だち予約URL"
                    onFocus={(e) => e.currentTarget.select()}
                    className="border-hairline bg-canvas rounded-control min-w-0 flex-1 border px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => copyUrl(shareUrl)}
                    className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium"
                  >
                    {isCopied(shareUrl) ? 'コピー済' : 'コピー'}
                  </button>
                  <span className="text-ink-faint text-xs">お客さまが新しく予約を入れるURL</span>
                </div>
                {/* N-396: 履歴URLは別画面を開く。両方発行できることを注記と揃える。 */}
                {historyUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={historyUrl}
                      aria-label="予約履歴URL"
                      onFocus={(e) => e.currentTarget.select()}
                      className="border-hairline bg-canvas rounded-control min-w-0 flex-1 border px-3 py-2 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => copyUrl(historyUrl)}
                      className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium"
                    >
                      {isCopied(historyUrl) ? 'コピー済' : 'コピー'}
                    </button>
                    <span className="text-ink-faint text-xs">お客さまが自分の予約履歴を見るURL</span>
                  </div>
                ) : null}
                {copyFailedUrl && (copyFailedUrl === shareUrl || copyFailedUrl === historyUrl) ? (
                  <p role="alert" className="text-warning text-xs">
                    コピーできませんでした。左の欄を選んでコピーしてください。
                  </p>
                ) : null}
              </div>
            ) : !workerBase ? (
              // 配信先のURLが作れないのは、LIFF未設定ではなくAPI接続先の欠落(点検#516軽4)。
              <p className="text-warning mt-2 text-xs">
                予約URLを作れません。APIの接続先が設定されていません。管理者に連絡してください。
              </p>
            ) : (
              <p className="text-warning mt-2 text-xs">
                このアカウントには LIFF ID が未設定です。
                <Link href="/accounts" className="ml-1 underline">
                  アカウント設定
                </Link>
                で LIFF ID を登録してください。
              </p>
            )}
          </div>

          <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-faint text-xs">全 {total} 件</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={current <= 1}
                className="border-hairline rounded-control border px-3 py-1 text-xs disabled:opacity-40"
              >
                前へ
              </button>
              <span className="text-ink-secondary px-2 text-xs tabular-nums">
                {current} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={current >= pageCount}
                className="border-hairline rounded-control border px-3 py-1 text-xs disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </div>
        </div>
      </div>

      {dialogs}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-ink-faint px-4 py-3 text-left text-xs font-semibold ${className}`}>
      {children}
    </th>
  )
}

function Kpi({
  title,
  value,
  unit,
  detail,
}: {
  title: string
  // ★V7 `x63W5x`：取れていないときは null で「—」を出す。0 とは別物。
  value: number | null
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{title}</p>
      <p className="text-ink mt-1 text-2xl font-semibold tabular-nums">
        {value === null ? '—' : value.toLocaleString('ja-JP')}
        {value === null ? null : (
          <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>
        )}
      </p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline flex gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-ink-faint w-28 shrink-0 pt-0.5 text-xs font-medium">{label}</span>
      <div className="text-ink flex-1 text-sm break-words">{children}</div>
    </div>
  )
}

function BookingDetailPanel({
  booking: b,
  accountId,
  canOperate,
  onClose,
  onAction,
}: {
  booking: BookingRequest
  accountId: string | null
  /** N-401: 閲覧のみの人には状態を変える操作を出さない。 */
  canOperate: boolean
  onClose: () => void
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  const [detail, setDetail] = useState<BookingAdminDetail | null>(null)
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    if (!accountId) return
    let active = true
    setDetailError('')
    void bookingApi.getBooking(accountId, b.id)
      .then((response) => { if (active) setDetail(response.booking) })
      .catch(() => { if (active) setDetailError('予約の顧客カルテと通知実績を読み込めませんでした') })
    return () => { active = false }
  }, [accountId, b.id])

  const lineOperation = detail?.operations.find((item) => item.kind === 'confirmation_line') ?? null
  // N-390: LINEと結びついていない電話予約では「届きます」系の文言を畳む。
  const isLinked = detail?.customer.isLineLinked ?? Boolean(b.friend_id)
  return (
    <div data-design-node="TnDbq" className="fixed inset-y-0 right-0 left-0 z-50 flex justify-end xl:left-64">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <aside className="relative h-full w-full overflow-y-auto bg-canvas-sunken shadow-xl">
        <div className="border-hairline sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b bg-canvas px-6 py-3">
          <div className="min-w-0">
            <p className="text-ink-faint text-xs font-semibold">予約管理　›　今日　›　{formatJpTime(b.starts_at)} {b.friend_name ?? 'お客様'}さま</p>
            <h2 className="text-ink mt-1 truncate text-xl font-semibold">{b.friend_name ?? 'お客様'} ／ {b.menu_name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-pill px-3 py-1 text-xs font-semibold ${statusBadgeColor[b.status] ?? 'bg-canvas-sunken'}`}>{statusLabel[b.status] ?? b.status}</span>
            {b.friend_id ? <Button href={`/chats?friend=${b.friend_id}`} variant="primary">この人と話す</Button> : null}
            {/* N-389: 変更は詳細ページの変更フォームで行う。「準備中」のまま残さない。
                N-401: 閲覧のみの人には変更・取消の入口を出さない。 */}
            {canOperate ? (
              <>
                <Button href={`/booking/bookings/detail?id=${encodeURIComponent(b.id)}`} variant="secondary">時間や担当を変える</Button>
                <Button onClick={() => onAction('cancel')} className="border-danger text-danger">予約を取り消す</Button>
              </>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="rounded-mini p-1.5 text-ink-secondary hover:bg-canvas-sunken"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div data-design="Body" className="grid gap-4 px-6 py-4 xl:grid-cols-4">
          <div className="min-w-0 xl:col-span-3">
          {detailError ? <Notice tone="danger" message={detailError} onClose={() => setDetailError('')} className="mb-4" /> : null}
          <section className="mb-6">
            <div className="bg-success-bg text-success mb-3 w-fit rounded-pill px-3 py-1 text-xs font-semibold">予約が入っています</div>
            <p className="text-ink-secondary mb-3 text-sm">{formatJpDateTime(b.starts_at)}〜{formatJpTime(b.ends_at)} ／ 担当 {b.staff_name} ／ {isLinked ? 'LINEから入りました。' : '電話・店頭で受け付けました。'}</p>
            <div className="bg-canvas rounded-card border-hairline border p-5">
            <h3 className="text-ink mb-1 text-base font-semibold">予約の中身</h3>
            <DetailRow label="メニュー">{b.menu_name}</DetailRow>
            <DetailRow label="日時">
              {formatJpDateTime(b.starts_at)} 〜 {formatJpTime(b.ends_at)}
            </DetailRow>
            <DetailRow label="担当">{b.staff_name}</DetailRow>
            <DetailRow label="料金">
              <span className="tabular-nums">¥{b.price_at_booking.toLocaleString()}</span>
            </DetailRow>
            <DetailRow label="予約番号">
              <span className="text-ink-secondary font-mono text-xs">{b.id}</span>
            </DetailRow>
            <DetailRow label="お客様からのご希望">{b.customer_note ?? <span className="text-ink-faint">記入なし</span>}</DetailRow>
            </div>
          </section>

          <section className="bg-canvas rounded-card border-hairline mb-4 border p-5">
            <h3 className="text-ink text-base font-semibold">この方のこれまで</h3>
            <p className="text-ink-faint mt-1 text-xs">顧客カルテの履歴は、友だち詳細で確認できます。前回のことを覚えていると、話が早くなります。</p>
            <div className="border-hairline mt-4 grid grid-cols-4 gap-3 border-b pb-2 text-xs text-ink-faint"><span>いつ・何を</span><span>担当</span><span>金額</span><span>メモ</span></div>
            {(detail?.history.length ? detail.history : [{ id: b.id, startsAt: b.starts_at, menuName: b.menu_name, staffName: b.staff_name, price: b.price_at_booking, customerNote: b.customer_note, handoverNote: null, status: b.status }]).slice(0, 3).map((item) => (
              <div key={item.id} className="grid grid-cols-4 gap-3 py-3 text-sm"><span>{formatJpDateTime(item.startsAt)} {item.menuName}</span><span>{item.staffName}</span><span>¥{item.price.toLocaleString()}</span><span>{item.customerNote ?? '記入なし'}</span></div>
            ))}
            {b.friend_id ? <Link href={`/friends/detail?id=${encodeURIComponent(b.friend_id)}`} className="text-action text-xs font-semibold hover:underline focus-visible:underline">顧客カルテで以前の予約を見る →</Link> : null}
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h3 className="text-ink text-base font-semibold">この予約で動いたこと</h3>
            <div className="mt-3 space-y-3 text-sm">
              <p>✓ {formatJpDateTime(b.requested_at)} 予約を受け付けました</p>
              {b.decided_at ? <p>✓ {formatJpDateTime(b.decided_at)} 予約を「{statusLabel[b.status] ?? b.status}」にしました</p> : null}
              {lineOperation ? <p>{lineOperation.status === 'succeeded' ? '✓' : '…'} 予約確認LINE: {lineOperation.status === 'succeeded' ? '送信済み' : lineOperation.status === 'queued' ? '送信中' : lineOperation.status === 'retry_wait' ? '再試行中' : lineOperation.status === 'permanent_failed' ? '失敗' : '送信なし'}</p> : null}
              {detail?.reminders.map((reminder) => <p key={reminder.id}>{reminder.status === 'sent' ? '✓' : '…'} {formatJpDateTime(reminder.scheduledAt)} リマインダ: {reminder.status}</p>)}
              {isLinked ? <p className="text-ink-faint">お知らせの開封状況は、受信箱で確認できます。</p> : null}
            </div>
          </section>
          </div>

          <aside className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h3 className="text-ink text-sm font-semibold">お客様とペット</h3>
            <div className="mt-3 flex items-center gap-3"><span className="bg-action-soft text-action flex h-10 w-10 items-center justify-center rounded-full font-bold">{b.friend_name?.charAt(0) ?? '?'}</span><div>{b.friend_id ? <Link href={`/friends/detail?id=${encodeURIComponent(b.friend_id)}`} className="text-ink font-semibold hover:underline">{b.friend_name ?? '名前未設定'}さま</Link> : <span className="text-ink font-semibold">{b.friend_name ?? '名前未設定'}さま</span>}<p className="text-ink-faint text-xs">{b.friend_id ? 'LINEの友だち情報と来店履歴' : '電話受付のお客さま'}</p></div></div>
            <DetailRow label="ペット">{detail?.customer.petName ?? '登録なし'}</DetailRow>
            <DetailRow label="連絡先">{detail?.customer.phone ?? '登録なし'}</DetailRow>
            {detail?.customer.tags.length ? <DetailRow label="タグ">{detail.customer.tags.map((tag) => tag.name).join('、')}</DetailRow> : null}
            {detail?.customer.mileageBalance !== null && detail?.customer.mileageBalance !== undefined ? <DetailRow label="マイル">{detail.customer.mileageBalance.toLocaleString()}</DetailRow> : null}
          </section>
          <section className="border-warning bg-warning-bg rounded-card border p-5">
            <h3 className="text-warning text-sm font-semibold">当日 気をつけること</h3>
            <p className="text-warning mt-3 text-xs">{detail?.previousHandover ?? '前回の申し送りはありません。'}</p>
          </section>
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h3 className="text-ink text-sm font-semibold">つながる先</h3>
            <div className="mt-3 space-y-2 text-xs"><p><Link href="/booking/menus" className="text-action font-semibold hover:underline focus-visible:underline">→ 予約設定</Link>　メニューと受付枠</p><p><Link href="/reminders" className="text-action font-semibold hover:underline focus-visible:underline">→ リマインダ</Link>　前日・開始前のお知らせ</p>{b.friend_id ? <p><Link href={`/chats?friend=${b.friend_id}`} className="text-action font-semibold hover:underline focus-visible:underline">→ 受信箱</Link>　この方とのやりとり</p> : null}<p><Link href="/mileage" className="text-action font-semibold hover:underline focus-visible:underline">→ マイル</Link>　来店時の付与</p></div>
          </section>
          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink-faint mb-2 text-xs">
              {isLinked
                ? '承認するとお客様のLINEに確定のお知らせが届きます。'
                : 'LINEと結びついていないため、お客様への自動連絡はありません。'}
            </p>
            {canOperate ? <ActionButtons status={b.status} onAction={onAction} /> : null}
            <Link
              href={`/booking/bookings/detail?id=${encodeURIComponent(b.id)}`}
              data-qa-open="TnDbq"
              aria-label={`${b.friend_name ?? 'この予約'}の予約の詳細ページを開く`}
              className="text-ink-secondary mt-3 inline-block text-xs underline"
            >
              予約の詳細ページを開く
            </Link>
          </div>
          </aside>
        </div>
        {canOperate ? (
          <div className="border-hairline sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-canvas px-6 py-3"><p className="text-ink-faint text-xs">{isLinked ? 'ここでの状態変更は、お客様のLINEにも自動で知らせます。' : 'LINEと結びついていないため、お客様への自動連絡はありません。'}</p><div className="flex gap-2"><Button onClick={() => onAction('cancel')}>キャンセル</Button><Button onClick={() => onAction('complete')}>来ていただきました にする</Button></div></div>
        ) : null}
      </aside>
    </div>
  )
}

function ActionButtons({
  status,
  onAction,
}: {
  status: string
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  if (status === 'requested') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('approve')}
          className="rounded-control bg-accent-deep text-on-accent hover:brightness-92 px-3 py-1 text-xs font-medium transition-colors"
        >
          承認
        </button>
        <button
          onClick={() => onAction('reject')}
          className="text-danger bg-danger-bg rounded-md px-3 py-1 text-xs font-medium hover:bg-red-100"
        >
          拒否
        </button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('complete')}
          className="bg-info-bg text-info rounded-md px-3 py-1 text-xs font-medium hover:bg-hairline"
        >
          完了
        </button>
        <button
          onClick={() => onAction('no_show')}
          className="bg-warning-bg text-warning rounded-md px-3 py-1 text-xs font-medium hover:bg-hairline"
        >
          無断
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="text-ink-secondary bg-canvas-sunken rounded-md px-3 py-1 text-xs font-medium hover:bg-hairline"
        >
          取消
        </button>
      </div>
    )
  }
  return <span className="text-ink-faint text-xs">-</span>
}
