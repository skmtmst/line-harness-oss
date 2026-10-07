'use client'

/*
 * ★V8 ウォークインの窓（提案 E-3 `nNujj`）。
 *
 * 人数（−2＋）を合わせ、今すぐ座れる卓のカードを1つ押して［入店にする］の2手。
 * 人数を変えると座れる卓だけに絞り直す。満席のときは「いま座れる卓はありません」と次に空く目安。
 * 入れる口は walk-in.ts の1か所（予約なしの来店の口ができたら差し替える）。動きは BEHAVIOR.md。
 */
import { useEffect, useMemo, useState } from 'react'
import { Armchair, LogIn, Minus, Plus } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { restaurantTestApi, type RestaurantReservation, type RestaurantTable } from '@/lib/restaurant-test-api'
import { freeTables, pad2, tableBusy, tableNote, toYmd } from './slots'
import { seatWalkIn } from './walk-in'
import styles from './front-desk.module.css'

const MAX_GUESTS = 100

function hm(value: number | Date): string {
  const day = typeof value === 'number' ? new Date(value) : value
  return `${pad2(day.getHours())}:${pad2(day.getMinutes())}`
}

/** 満席のとき、人数が入る卓がいちばん早く空く時刻（今の予約の終わり）。 */
export function nextFreeAt(tables: RestaurantTable[], guests: number, rows: RestaurantReservation[], now: number): number | null {
  const fits = tables.filter((t) => t.is_active && t.min_capacity <= guests && t.max_capacity >= guests)
  let best: number | null = null
  for (const table of fits) {
    const ends = rows
      .filter((r) => r.table_id === table.id && !['cancelled', 'no_show'].includes(r.status) && Date.parse(r.starts_at) <= now && Date.parse(r.ends_at) > now)
      .map((r) => Date.parse(r.ends_at))
    const end = ends.length ? Math.max(...ends) : null
    if (end !== null && (best === null || end < best)) best = end
  }
  return best
}

export default function WalkInDialog({ open, accountId, storeId, tables, onClose, onSaved }: {
  open: boolean
  accountId: string
  storeId: string
  tables: RestaurantTable[]
  onClose: () => void
  onSaved: (result: { seated: boolean }) => void
}) {
  const [now, setNow] = useState(() => new Date())
  const [guests, setGuests] = useState(2)
  const [tableId, setTableId] = useState('')
  const [rows, setRows] = useState<RestaurantReservation[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setNow(new Date()); setGuests(2); setTableId(''); setError(''); setRows(null)
  }, [open])

  useEffect(() => {
    let current = true
    if (!open || !accountId || !storeId) return
    void restaurantTestApi.reservationsDay(accountId, storeId, toYmd(now))
      .then((res) => { if (current) setRows(Array.isArray(res.data?.reservations) ? res.data.reservations : []) })
      .catch(() => { if (current) { setRows([]); setError('今日の予約を読み込めませんでした。閉じてもう一度開いてください。') } })
    return () => { current = false }
  }, [open, accountId, storeId, now])

  const free = useMemo(() => (rows ? freeTables(tables, guests, now.getTime(), rows) : []), [tables, guests, now, rows])
  /* 頭の「空いている卓」は人数にかかわらず、いま予約が重なっていない動いている卓の数。 */
  const freeAll = useMemo(() => (rows ? tables.filter((t) => t.is_active && !tableBusy(t.id, now.getTime(), now.getTime() + 1, rows)).length : 0), [tables, now, rows])
  /* 人数を変えて選んでいた卓が外れたら、いちばん合う卓を選び直す。 */
  useEffect(() => {
    if (!free.some((t) => t.id === tableId)) setTableId(free[0]?.id ?? '')
  }, [free]) // eslint-disable-line react-hooks/exhaustive-deps
  const waitUntil = rows && free.length === 0 ? nextFreeAt(tables, guests, rows, now.getTime()) : null

  const save = async () => {
    if (!tableId) { setError('座る卓を選んでください。'); return }
    setBusy(true); setError('')
    try {
      const result = await seatWalkIn(accountId, { storeId, guestCount: guests, tableId, now: new Date() })
      onSaved({ seated: result.seated })
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '入店にできませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      designNode="nNujj"
      designWidth={560}
      /* 絵 PUWyq：窓の上は 140（座れる卓の数で上下しない）。 */
      designTop={140}
      footerAlign="center"
      title="ウォークインを入れる"
      description={`いま ${hm(now)} ・ 空いている卓 ${freeAll}`}
      busy={busy}
      error={error || undefined}
      confirmLabel="入店にする"
      confirmIcon={<LogIn size={15} aria-hidden="true" />}
      onConfirm={tableId ? () => void save() : undefined}
      onCancel={onClose}
    >
      <div className={styles.walkIn}>
        <div className={styles.field}>
          <span className={styles.label} id="e3-guests">人数</span>
          <div className={styles.stepper} role="group" aria-labelledby="e3-guests">
            <IconButton aria-label="人数を減らす" disabled={guests <= 1 || busy} onClick={() => setGuests((n) => Math.max(1, n - 1))}><Minus size={16} aria-hidden="true" /></IconButton>
            <span className={styles.stepperValue} aria-live="polite">{`${guests} 名`}</span>
            <IconButton aria-label="人数を増やす" disabled={guests >= MAX_GUESTS || busy} onClick={() => setGuests((n) => Math.min(MAX_GUESTS, n + 1))}><Plus size={16} aria-hidden="true" /></IconButton>
          </div>
        </div>
        {rows === null ? (
          <p className={styles.hint}>空いている卓を調べています。</p>
        ) : free.length === 0 ? (
          <div className={styles.full} role="status">
            <p className={styles.fullTitle}>いま座れる卓はありません</p>
            <p className={styles.hint}>{waitUntil ? `${guests}名が入る卓は ${hm(waitUntil)} ごろに空く予定です（約${Math.max(1, Math.round((waitUntil - now.getTime()) / 60_000))}分）。` : `${guests}名が入る卓がありません。人数を分けるか、予約台帳で卓を確かめてください。`}</p>
          </div>
        ) : (
          <div className={styles.cardsWrap}>
          <RadioCardGroup legend={`今すぐ座れる卓（${guests}名が座れる卓だけ）`} legendVisible className={styles.tableCards}>
            {free.map((table) => (
              <RadioCard
                key={table.id}
                name="walk-in-table"
                value={table.id}
                checked={tableId === table.id}
                onChange={setTableId}
                title={table.code}
                note={tableNote(table)}
                icon={<Armchair size={16} aria-hidden="true" />}
                height="short"
                disabled={busy}
              />
            ))}
          </RadioCardGroup>
          </div>
        )}
      </div>
    </Dialog>
  )
}
