'use client'

/*
 * ★V8 電話予約の引き出し（提案 E-2 `wEzuG`）。
 *
 * 電話番号 → LINE の友だちを探して候補（押すと名前が入る）→ 名前 → 人数（−/＋）→ 日付（今日／明日／選ぶ）
 * → 空いている時刻の札 → 卓は自動（変えられる）→ メモ → 「LINE で確認を送る」（友だちのときだけ）→［予約を入れる］。
 * 電話番号・時刻・［予約を入れる］の3〜4手で入る。保存は今の手動予約の口（source=phone）。動きは BEHAVIOR.md。
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, CircleCheck, Minus, Plus } from 'lucide-react'
import type { RestaurantOpeningDay } from '@line-crm/shared'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import Drawer from '@/components/shared/drawer'
import FilterChip from '@/components/shared/filter-chip'
import IconButton from '@/components/shared/icon-button'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { restaurantTestApi, type RestaurantReservation, type RestaurantTable } from '@/lib/restaurant-test-api'
import { STAY_MINUTES, freeTables, openTimes, startOf, tableNote, toYmd } from './slots'
import styles from './front-desk.module.css'

type Friend = { name: string; phone: string; lineUid: string }
type DayChoice = 'today' | 'tomorrow' | 'pick'

const MAX_GUESTS = 100

function addDays(day: Date, days: number): Date {
  const next = new Date(day)
  next.setDate(next.getDate() + days)
  return next
}

function md(day: Date): string {
  return `${day.getMonth() + 1}/${day.getDate()}`
}

export default function PhoneReservationDrawer({ open, accountId, storeId, tables, onClose, onSaved }: {
  open: boolean
  accountId: string
  storeId: string
  tables: RestaurantTable[]
  onClose: () => void
  /** 保存できたら呼ぶ（LINE の確認が送れなかったときは lineFailed）。 */
  onSaved: (result: { lineFailed: boolean }) => void
}) {
  const now = useMemo(() => new Date(), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [phone, setPhone] = useState('')
  const [friends, setFriends] = useState<Friend[]>([])
  const [friend, setFriend] = useState<Friend | null>(null)
  const [name, setName] = useState('')
  const [guests, setGuests] = useState(2)
  const [dayChoice, setDayChoice] = useState<DayChoice>('today')
  const [picked, setPicked] = useState('')
  const [time, setTime] = useState('')
  const [tableId, setTableId] = useState('auto')
  const [changingTable, setChangingTable] = useState(false)
  const [memo, setMemo] = useState('')
  const [notify, setNotify] = useState(true)
  const [hours, setHours] = useState<RestaurantOpeningDay[] | null>(null)
  const [dayRows, setDayRows] = useState<RestaurantReservation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* 開くたびに空から始める。 */
  useEffect(() => {
    if (!open) return
    setPhone(''); setFriends([]); setFriend(null); setName(''); setGuests(2); setDayChoice('today'); setPicked('')
    setTime(''); setTableId('auto'); setChangingTable(false); setMemo(''); setNotify(true); setError('')
  }, [open])

  const date = dayChoice === 'today' ? toYmd(now) : dayChoice === 'tomorrow' ? toYmd(addDays(now, 1)) : picked

  useEffect(() => {
    let current = true
    if (!open || !accountId || !storeId) return
    void restaurantTestApi.openingHours(accountId, storeId)
      .then((res) => { if (current) setHours(res.data.hours ?? null) })
      .catch(() => { if (current) setHours(null) })
    return () => { current = false }
  }, [open, accountId, storeId])

  useEffect(() => {
    let current = true
    setDayRows([])
    if (!open || !accountId || !storeId || !date) return
    void restaurantTestApi.reservationsDay(accountId, storeId, date)
      .then((res) => { if (current) setDayRows(Array.isArray(res.data?.reservations) ? res.data.reservations : []) })
      .catch(() => { if (current) setError('この日の予約を読み込めませんでした。日付を選び直してください。') })
    return () => { current = false }
  }, [open, accountId, storeId, date])

  /* 電話番号で LINE の友だちを探す（4桁から・打つのが止まってから）。 */
  useEffect(() => {
    let current = true
    const digits = phone.replace(/\D/g, '')
    setFriends([])
    if (!open || !accountId || !storeId || digits.length < 4) return
    const timer = setTimeout(() => {
      void restaurantTestApi.customerSearch(accountId, storeId, phone.trim())
        .then((res) => {
          if (!current) return
          setFriends(res.data.filter((c) => c.lineUid).map((c) => ({ name: c.name, phone: c.phone || '', lineUid: c.lineUid || '' })))
        })
        .catch(() => { /* 探せないときは候補を出さず、名前を手で入れてもらう */ })
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [open, accountId, storeId, phone])

  const times = useMemo(() => (date ? openTimes(date, hours, now) : []), [date, hours, now])
  const freeAt = (label: string) => freeTables(tables, guests, startOf(date, label), dayRows).length > 0
  const candidates = useMemo(
    () => (time && date ? freeTables(tables, guests, startOf(date, time), dayRows) : []),
    [tables, guests, time, date, dayRows],
  )
  /* 選んでいた時刻が人数を変えて埋まったら選び直してもらう。 */
  useEffect(() => {
    if (time && date && freeTables(tables, guests, startOf(date, time), dayRows).length === 0) setTime('')
  }, [guests, date, dayRows]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosenTable = tableId === 'auto' ? candidates[0] ?? null : candidates.find((t) => t.id === tableId) ?? candidates[0] ?? null
  const dirty = phone !== '' || name !== '' || memo !== '' || time !== '' || guests !== 2

  const choose = (item: Friend | null) => {
    setFriend(item)
    if (item) setName(item.name)
  }

  const save = async () => {
    setError('')
    if (!name.trim()) { setError('お名前を入れてください。'); return }
    if (!date || !time) { setError('日付と時刻を選んでください。'); return }
    if (!chosenTable) { setError('この時刻に人数が入る卓がありません。時刻か人数を変えてください。'); return }
    const startsAt = new Date(startOf(date, time))
    setBusy(true)
    try {
      const res = await restaurantTestApi.createReservation(accountId, {
        storeId,
        source: 'phone',
        customerName: name.trim(),
        customerPhone: phone.trim() || null,
        lineUid: friend?.lineUid || null,
        guestCount: guests,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + STAY_MINUTES * 60_000).toISOString(),
        tableId: chosenTable.id,
        note: memo.trim() || null,
        notifyLine: Boolean(friend) && notify,
      })
      onSaved({ lineFailed: Boolean(friend) && notify && !res.data.lineNotice.sent })
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '予約を入れられませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <div className={styles.drawerFoot}>
      <Button onClick={onClose} disabled={busy}>キャンセル</Button>
      <Button variant="primary" onClick={() => void save()} disabled={busy}>
        <Check size={15} aria-hidden="true" />予約を入れる
      </Button>
    </div>
  )

  return (
    <Drawer open={open} width="narrow" title="電話予約を入れる" dirty={dirty} busy={busy} error={error || undefined} onClose={onClose} footer={footer}>
      <div className={styles.form} data-design-node="wEzuG">
        <label className={styles.field}>
          <span className={styles.label}>電話番号</span>
          <TextField type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(event) => { setPhone(event.target.value); if (friend) choose(null) }} placeholder="090-1234-5678" />
        </label>
        {friends.length > 0 ? (
          <div className={styles.friendBox} role="group" aria-label="LINE の友だちの候補">
            <p className={styles.friendTitle}>LINE の友だちが見つかりました</p>
            {friends.slice(0, 3).map((item) => {
              const selected = friend?.lineUid === item.lineUid
              return (
                <button key={item.lineUid} type="button" className={styles.friendRow} aria-pressed={selected} onClick={() => choose(selected ? null : item)}>
                  <span className={styles.friendFace} aria-hidden="true">{item.name.slice(0, 1)}</span>
                  <span className={styles.friendName}>
                    <span className={styles.friendNameMain}>{item.name}</span>
                    <span className={styles.friendNameSub}>{item.phone ? `LINE の友だち・${item.phone}` : 'LINE の友だち'}</span>
                  </span>
                  {selected ? <span className={styles.friendPicked}><CircleCheck size={18} aria-hidden="true" />選択中</span> : <span className={styles.friendPick}>選ぶ</span>}
                </button>
              )
            })}
          </div>
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>お名前</span>
          <TextField value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </label>
        <div className={styles.field}>
          <span className={styles.label} id="e2-guests">人数</span>
          <div className={styles.stepper} role="group" aria-labelledby="e2-guests">
            <IconButton aria-label="人数を減らす" disabled={guests <= 1} onClick={() => setGuests((n) => Math.max(1, n - 1))}><Minus size={16} aria-hidden="true" /></IconButton>
            <span className={styles.stepperValue} aria-live="polite">{`${guests} 名`}</span>
            <IconButton aria-label="人数を増やす" disabled={guests >= MAX_GUESTS} onClick={() => setGuests((n) => Math.min(MAX_GUESTS, n + 1))}><Plus size={16} aria-hidden="true" /></IconButton>
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>日付</span>
          <span className={styles.segment}>
          <SegmentedControl<DayChoice>
            aria-label="日付"
            value={dayChoice}
            onChange={(value) => { setDayChoice(value); setTime('') }}
            options={[
              { value: 'today', label: `今日 ${md(now)}` },
              { value: 'tomorrow', label: `明日 ${md(addDays(now, 1))}` },
              { value: 'pick', label: '日付を選ぶ' },
            ]}
          />
          </span>
          {dayChoice === 'pick' ? (
            <DateField value={picked} onChange={(value) => { setPicked(value); setTime('') }} min={toYmd(now)} aria-label="予約の日付" />
          ) : null}
        </div>
        <div className={styles.field}>
          <span className={styles.label} id="e2-times">時刻（空いている時刻だけ）</span>
          {/* 時刻の札が1行出る高さを先に取る（空きが無い日・日付を選ぶ前でも下の卓・メモが上下しない）。 */}
          <div className={styles.timeBox}>
          {!date ? (
            <p className={styles.hint}>日付を選ぶと空いている時刻が出ます。</p>
          ) : times.filter(freeAt).length === 0 ? (
            <p className={styles.hint}>{`この日に ${guests}名が入る空いた時刻はありません。`}</p>
          ) : (
            <div className={styles.timeChips} role="group" aria-labelledby="e2-times">
              {times.filter(freeAt).map((label) => (
                <FilterChip key={label} selected={time === label} onChange={(on) => { setTime(on ? label : ''); setTableId('auto') }}>{label}</FilterChip>
              ))}
            </div>
          )}
          </div>
        </div>
        <div className={styles.tableRow}>
          <div className={styles.tableText}>
            <span className={styles.label}>卓</span>
            <span className={styles.tableValue}>
              {chosenTable
                ? `${chosenTable.code}（${tableNote(chosenTable)}）を${tableId === 'auto' ? '自動で割り当て' : '選びました'}`
                : time ? '人数が入る空いた卓がありません' : '時刻を選ぶと自動で割り当てます'}
            </span>
          </div>
          {candidates.length > 1 && !changingTable ? <Button variant="text" onClick={() => setChangingTable(true)}>変える</Button> : null}
        </div>
        {changingTable && candidates.length > 1 ? (
          <Select
            aria-label="卓を選ぶ"
            size="full"
            value={chosenTable?.id ?? ''}
            onChange={setTableId}
            options={candidates.map((t) => ({ value: t.id, label: `${t.code}（${tableNote(t)}）` }))}
          />
        ) : null}
        <label className={styles.field}>
          <span className={styles.label}>メモ <span className={styles.optional}>任意</span></span>
          <TextField value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="アレルギー・記念日など" />
        </label>
        {friend ? (
          <div className={styles.notifyRow}>
            <Toggle checked={notify} onChange={setNotify} label="LINE で確認を送る" />
            <span className={styles.notifyText}>
              <span className={styles.notifyTitle}>LINE で確認を送る</span>
              <span className={styles.notifySub}>友だちのときだけ出ます</span>
            </span>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}
