'use client'

/*
 * ★V8 予約台帳（板 `l9NlC0` 今日・`xzCK6` 今日 1152・`Z3FoM` 一覧・`rm92Y` 電話の予約を入れる）。
 *
 * 板の頭に店舗・見方（今日／今週／今月／一覧）・枠を押さえる・電話の予約を入れる。
 * 今日は時間×卓、今週・今月・一覧は予約タイムラインの表。電話の予約は作る型の画面に切り替わる。
 * 口・絞り込み・送る形は今の画面（app/restaurant-test/v8/reservations.tsx）と同じ。動きは BEHAVIOR.md。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Lock, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type ReservationQuery, type RestaurantReservation } from '@/lib/restaurant-test-api'
import RestaurantShell, { type RestaurantV8Context } from '../booking-kit/shell'
import { CancelReservationDialog, EditReservationDialog, InboundTrialDialog, type ReservationPatch } from './dialogs'
import ListView, { PAGE_SIZE } from './list'
import PhoneReservation from './phone'
import TodayView, { type PhonePreset } from './today'
import ReservationDetailDialog from '../../restaurant-reservations/detail-dialog'
import { type LedgerView, dayRange, monthRange, sameDay, toYmd, weekRange } from './format'
import styles from './reservations.module.css'

/** 予約を変えられる役割か（口は owner・admin・staff。閲覧のみは 403）。読めるまでは出す（最後の守りは口の 403）。 */
function canWriteRole(role: string | null | undefined): boolean {
  return !role || role === 'owner' || role === 'admin' || role === 'staff'
}

const VIEWS: Array<{ key: LedgerView; label: string }> = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '今週' },
  { key: 'month', label: '今月' },
  { key: 'list', label: '一覧' },
]

/** 頭の見方の切り替え（今日 8・今週 31・今月 112・一覧）。 */
function ViewSwitch({ view, counts, onChange }: {
  view: LedgerView
  counts: Record<'today' | 'week' | 'month', number> | null
  onChange: (view: LedgerView) => void
}) {
  return (
    <div className={styles.viewSwitch} role="tablist" aria-label="見方の切り替え">
      {VIEWS.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={view === item.key}
          className={styles.viewTab}
          onClick={() => onChange(item.key)}
        >
          {item.label}{item.key !== 'list' && counts ? ` ${counts[item.key]}` : ''}
        </button>
      ))}
    </div>
  )
}

/* 頭の右：見方の切り替え（数はその月を取り直して今日・今週・今月で数える。遅い応答は捨てる）と主ボタン。 */
function HeadControls({ storePicker, view, day, storeId, busy, canWrite, onView, onPhone }: {
  storePicker: ReactNode
  view: LedgerView
  day: Date
  storeId: string
  busy: boolean
  /** 閲覧のみは false。押せないボタンは置かない。 */
  canWrite: boolean
  onView: (view: LedgerView) => void
  onPhone: (preset: PhonePreset) => void
}) {
  const { selectedAccountId } = useAccount()
  const [counts, setCounts] = useState<Record<'today' | 'week' | 'month', number> | null>(null)
  const countRef = useRef(0)
  const dayKey = toYmd(day)
  useEffect(() => {
    if (!selectedAccountId) { setCounts(null); return }
    const id = ++countRef.current
    const m = monthRange(day)
    const t = dayRange(day)
    const w = weekRange(day)
    void restaurantTestApi.snapshot(selectedAccountId, { from: m.from, to: m.to, limit: 500, offset: 0 }).then((res) => {
      if (id !== countRef.current || !res.success) return
      const scoped = storeId ? res.data.reservations.filter((r) => r.store_id === storeId) : res.data.reservations
      const live = scoped.filter((r) => !['cancelled', 'no_show'].includes(r.status))
      setCounts({
        today: live.filter((r) => r.starts_at >= t.from && r.starts_at < t.to).length,
        week: live.filter((r) => r.starts_at >= w.from && r.starts_at < w.to).length,
        month: live.length,
      })
    }).catch(() => { /* 数が出ないときは数なしで出す */ })
  }, [selectedAccountId, storeId, dayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={styles.headControls}>
      {storePicker}
      <ViewSwitch view={view} counts={counts} onChange={onView} />
      {/* 絵 l9NlC0（今日）・Z3FoM（一覧）とも頭の右に置く。閲覧のみは押せないボタンを置かない。 */}
      {canWrite ? (
        <span className={styles.headButtons}>
          <Button disabled={busy} onClick={() => onPhone({ date: day, hold: true })}><Lock size={15} aria-hidden="true" />枠を押さえる</Button>
          <Button variant="primary" disabled={busy} onClick={() => onPhone({ date: day })}><Plus size={15} aria-hidden="true" />電話の予約を入れる</Button>
        </span>
      ) : null}
    </div>
  )
}

function LedgerBody({ ctx, view, day, period, status, page, source, phone, onDay, onPeriod, onStatus, onPage, onSource, onPhone }: {
  ctx: RestaurantV8Context
  view: LedgerView
  day: Date
  period: string
  status: string
  page: number
  source: string
  phone: PhonePreset | null
  onDay: (day: Date) => void
  onPeriod: (value: string) => void
  onStatus: (value: string) => void
  onPage: (page: number) => void
  onSource: (value: string) => void
  onPhone: (preset: PhonePreset | null) => void
}) {
  const { data, store, busy, mutate, reload } = ctx
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 予約の口は owner・admin・staff に開いている（閲覧のみは 403）。受信データの試し（媒体の受信口）は owner・admin だけ。 */
  const canWrite = canWriteRole(role)
  const canImport = role === null || canManageRole(role)
  const accountId = selectedAccountId || ''
  const storeId = store?.id || ''
  const tables = useMemo(() => data.tables.filter((t) => !store || t.store_id === store.id), [data.tables, store])
  const menuItems = useMemo(() => data.menuItems.filter((m) => !store || m.store_id === store.id), [data.menuItems, store])
  const [todayRows, setTodayRows] = useState<RestaurantReservation[] | null>(null)
  const [openId, setOpenId] = useState('')
  const [detailId, setDetailId] = useState('')
  const [cancelId, setCancelId] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [lineWarning, setLineWarning] = useState('')

  useEffect(() => {
    let current = true
    setTodayRows(null)
    if (view !== 'today' || !storeId || !accountId) return
    const load = () => restaurantTestApi.reservationsDay(accountId, storeId, toYmd(day))
      .then((res) => { if (current) setTodayRows(Array.isArray(res.data?.reservations) ? res.data.reservations : []) })
      .catch(() => { if (current) setTodayRows([]) })
    void load()
    const timer = setInterval(() => { void load() }, 30_000)
    return () => { current = false; clearInterval(timer) }
  }, [view, storeId, accountId, day, data.reservations])

  const rows = useMemo(() => {
    const scoped = store ? data.reservations.filter((r) => r.store_id === store.id) : data.reservations
    if (view === 'today') return todayRows ?? []
    if (view === 'week') {
      const w = weekRange(day)
      return scoped.filter((r) => r.starts_at >= w.from && r.starts_at < w.to)
    }
    return scoped
  }, [data.reservations, store, view, day, todayRows])

  const save = useCallback(async (action: () => Promise<unknown>, success: string) => {
    const ok = await mutate(action, success)
    /* 失敗時は取り直す（競合 409 の古い表示で残さない）。 */
    if (!ok) void reload()
    return ok
  }, [mutate, reload])

  const opened = rows.find((r) => r.id === openId) ?? data.reservations.find((r) => r.id === openId) ?? null
  const detailed = rows.find((r) => r.id === detailId) ?? data.reservations.find((r) => r.id === detailId) ?? null
  const cancelling = rows.find((r) => r.id === cancelId) ?? data.reservations.find((r) => r.id === cancelId) ?? null

  if (phone) {
    return (
      <PhoneReservation
        storeId={storeId}
        storeName={store?.name || ''}
        tables={tables}
        menuItems={menuItems}
        busy={busy}
        preset={phone}
        onBack={() => onPhone(null)}
        onSave={(body) => save(() => (body.kind === 'hold'
          ? restaurantTestApi.holdReservation(accountId, { storeId, startsAt: String(body.startsAt), endsAt: String(body.endsAt), guestCount: Number(body.guestCount), tableId: (body.tableId as string | null) ?? null, holdMinutes: Number(body.holdMinutes), note: String(body.allergyNote || '電話のお客さま用') })
          : restaurantTestApi.createReservation(accountId, body).then((res) => {
            if (body.notifyLine && !res.data.lineNotice.sent) setLineWarning('予約は保存しました。LINE の確認は送れていません。友だちの連携と送信の状態を確かめてください。')
            return res
          })), body.kind === 'hold' ? '枠を押さえました。期限になると解除します。' : '台帳に入れました。').then((ok) => { if (ok) onPhone(null); return ok })}
      />
    )
  }

  const total = view === 'list' ? data.reservationTotal : rows.length

  return (
    <>
      {lineWarning ? <p role="alert" className={styles.warnBand}>{lineWarning}</p> : null}
      {view === 'today' ? (
        <TodayView
          rows={rows}
          later={store ? data.reservations.filter((r) => r.store_id === store.id) : data.reservations}
          tables={tables}
          day={day}
          isToday={sameDay(day, new Date())}
          busy={busy}
          canWrite={canWrite}
          source={source}
          onSource={onSource}
          onDay={onDay}
          onAdd={(preset) => onPhone(preset)}
          onOpen={setOpenId}
          onDetail={setDetailId}
        />
      ) : (
        <ListView
          view={view}
          rows={rows}
          total={total}
          tables={tables}
          page={page}
          period={period}
          status={status}
          busy={busy}
          canWrite={canWrite}
          canImport={canImport}
          onPeriod={onPeriod}
          onStatus={onStatus}
          onPage={onPage}
          onImport={() => setShowImport(true)}
          onCreate={() => onPhone({})}
          onOpen={setOpenId}
          onCancel={setCancelId}
          onRestore={(id) => { void save(() => restaurantTestApi.updateReservation(accountId, id, { status: 'confirmed' }), '予約を有効に戻しました。') }}
        />
      )}
      <ReservationDetailDialog
        reservation={detailed}
        accountId={accountId}
        tables={tables}
        courses={menuItems}
        busy={busy}
        canWrite={canWrite}
        onClose={() => setDetailId('')}
        onCancel={(id) => { setDetailId(''); setCancelId(id) }}
        onRestore={(id) => {
          void save(() => restaurantTestApi.updateReservation(accountId, id, { status: 'confirmed' }), '予約を有効に戻しました。').then((ok) => { if (ok) setDetailId('') })
        }}
        onEdit={(id) => { setDetailId(''); setOpenId(id) }}
      />
      <EditReservationDialog
        reservation={opened}
        tables={tables}
        courses={menuItems}
        busy={busy}
        canWrite={canWrite}
        onClose={() => setOpenId('')}
        onSave={(patch: ReservationPatch) => {
          if (!opened) return
          void save(() => restaurantTestApi.updateReservation(accountId, opened.id, patch), '予約を変更しました。').then((ok) => { if (ok) setOpenId('') })
        }}
        onCancelReservation={(id) => { setOpenId(''); setCancelId(id) }}
        onRestore={(id) => {
          void save(() => restaurantTestApi.updateReservation(accountId, id, { status: 'confirmed' }), '予約を有効に戻しました。').then((ok) => { if (ok) setOpenId('') })
        }}
      />
      <CancelReservationDialog
        reservation={cancelling}
        busy={busy}
        onClose={() => setCancelId('')}
        onConfirm={(id) => {
          void save(() => restaurantTestApi.updateReservation(accountId, id, { status: 'cancelled' }), cancelling && cancelling.hold_expires_at && cancelling.status === 'pending' ? '押さえを解除しました。' : '予約を取り消しました。')
          setCancelId('')
        }}
      />
      <InboundTrialDialog
        open={showImport}
        busy={busy}
        onClose={() => setShowImport(false)}
        onSubmit={(body) => {
          if (!store) return
          void save(() => restaurantTestApi.importReservation(accountId, {
            storeId: store.id, provider: body.provider, eventId: `ui-${Date.now()}`,
            reservation: {
              externalId: body.externalId, customerName: body.customerName, guestCount: body.guestCount, startsAt: body.startsAt,
              endsAt: new Date(new Date(body.startsAt).getTime() + 120 * 60_000).toISOString(),
            },
          }), '受信専用のデータとして取り込みました。').then((ok) => { if (ok) setShowImport(false) })
        }}
      />
    </>
  )
}

const DESCRIPTION: Record<'today' | 'list', string> = {
  today: '予約媒体・LINE・電話の予約を、時間と卓で確認します。',
  list: '予約媒体・LINE・電話の予約を、一つの時間軸で確認します。',
}

/*
 * 見方（今日・今週・今月・一覧）と電話の予約を切り替える。口への絞り込みは器（shell）へ渡す：
 * 今日・今週・今月は月の取り直し、一覧は期間・状態・ページ送り（今と同じ口）。
 * `?view=list|week|month` と `?date=YYYY-MM-DD` と `?source=<予約元>` を受け付ける。
 */
export default function ReservationsPage() {
  const [view, setView] = useState<LedgerView>('today')
  const [day, setDay] = useState<Date>(() => new Date())
  const [period, setPeriod] = useState('upcoming')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [source, setSource] = useState('all')
  const [phone, setPhone] = useState<PhonePreset | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const v = params.get('view')
    if (v === 'list' || v === 'week' || v === 'month') setView(v)
    const d = params.get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, dd] = d.split('-').map(Number)
      setDay(new Date(y, m - 1, dd))
    }
    const s = params.get('source')
    if (s) setSource(s)
  }, [])

  const query = useMemo<ReservationQuery>(() => {
    if (view === 'list') {
      const today = dayRange(new Date())
      const range = period === 'past'
        ? { from: undefined, to: today.from }
        : period === 'upcoming'
          ? { from: today.from, to: undefined }
          : { from: undefined, to: undefined }
      return { ...range, status: status === 'all' ? undefined : status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
    }
    const m = monthRange(day)
    return { from: m.from, to: m.to, limit: 500, offset: 0 }
  }, [view, day, period, status, page])

  const changeView = (next: LedgerView) => { setView(next); setPage(1) }
  const canWrite = canWriteRole(useStaffRole())

  if (phone) {
    return (
      <RestaurantShell boardId="rm92Y" title="電話の予約を入れる" description="" bare query={query}>
        {(ctx) => (
          <LedgerBody
            ctx={ctx} view={view} day={day} period={period} status={status} page={page} source={source} phone={phone}
            onDay={setDay} onPeriod={setPeriod} onStatus={setStatus} onPage={setPage} onSource={setSource} onPhone={setPhone}
          />
        )}
      </RestaurantShell>
    )
  }

  return (
    <RestaurantShell
      boardId={view === 'today' ? 'l9NlC0' : 'Z3FoM'}
      title="予約台帳"
      description={DESCRIPTION[view === 'today' ? 'today' : 'list']}
      query={query}
      layout={view === 'today' ? 'ledgerTight' : 'ledger'}
      headAfter={(ctx, storePicker) => (
        <HeadControls
          storePicker={storePicker}
          view={view}
          day={day}
          storeId={ctx?.selectedStoreId ?? ''}
          busy={!ctx || ctx.busy}
          canWrite={canWrite}
          onView={changeView}
          onPhone={setPhone}
        />
      )}
    >
      {(ctx) => (
        <LedgerBody
          ctx={ctx} view={view} day={day} period={period} status={status} page={page} source={source} phone={null}
          onDay={setDay}
          onPeriod={(value) => { setPeriod(value); setPage(1) }}
          onStatus={(value) => { setStatus(value); setPage(1) }}
          onPage={setPage}
          onSource={setSource}
          onPhone={setPhone}
        />
      )}
    </RestaurantShell>
  )
}
