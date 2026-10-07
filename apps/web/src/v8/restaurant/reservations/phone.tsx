'use client'

/*
 * ★V8 電話の予約を入れる（板 `rm92Y`）。作る型（CreatePage）で、左に入れる中身、右に確かめる物。
 *
 * 何を入れますか（お客さまの予約／枠だけ押さえる）→ だれの予約ですか（LINE の友だちを探す／
 * LINE 未連携の電話番号）→ いつ・何人・どの卓（空いている時間・卓・コース）→ 要望・アレルギー →
 * お客さまに何を送りますか。右：その時間の卓・LINE で届く見本・この方について。下の帯：キャンセル／台帳に入れる。
 * 送る形・口は今の画面（app/restaurant-test/v8/reservation-phone.tsx）と同じ。
 */
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Lock, UserPlus } from 'lucide-react'
import type { RestaurantCustomerHistory, RestaurantOpeningDay } from '@line-crm/shared'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { restaurantTestApi, type RestaurantMenuItem, type RestaurantReservation, type RestaurantTable } from '@/lib/restaurant-test-api'
import { DialogField } from '../booking-kit/parts'
import type { PhonePreset } from './today'
import { INACTIVE_STATUSES, dayTitle, floorOrder, slotLabel, toYmd } from './format'
import styles from './reservations.module.css'

const STAY_MINUTES = 120
const FALLBACK_START = 17 * 60
const FALLBACK_END = 21 * 60

type Person = { name: string; phone: string; lineUid: string }

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** 希望の時間（2時間）とその卓の予約が重なるか。期限切れの押さえは数えない。 */
function overlaps(day: string, time: string, tableId: string, rows: RestaurantReservation[]): boolean {
  const start = new Date(`${day}T${time.padStart(5, '0')}:00`).getTime()
  if (!Number.isFinite(start)) return false
  const end = start + STAY_MINUTES * 60_000
  return rows.some((r) => {
    if (r.table_id !== tableId || INACTIVE_STATUSES.includes(r.status)) return false
    if (r.status === 'pending' && r.hold_expires_at && Date.parse(r.hold_expires_at) <= Date.now()) return false
    const s = new Date(r.starts_at).getTime()
    const e = new Date(r.ends_at).getTime()
    return s < end && e > start
  })
}

/** 人数が入る卓のうち余る席が一番少ない卓（口の自動配席と同じ決まり）。空いている卓から選ぶ。 */
function recommendTable(tables: RestaurantTable[], count: number, free: (table: RestaurantTable) => boolean): RestaurantTable | null {
  return tables
    .filter((t) => t.is_active && t.min_capacity <= count && t.max_capacity >= count && free(t))
    .sort((a, b) => (a.max_capacity - count) - (b.max_capacity - count) || a.code.localeCompare(b.code, 'ja', { numeric: true }))[0] ?? null
}

export default function PhoneReservation({ storeId, storeName, tables, menuItems, busy, preset, onBack, onSave }: {
  storeId: string
  storeName: string
  tables: RestaurantTable[]
  menuItems: RestaurantMenuItem[]
  busy: boolean
  preset: PhonePreset
  onBack: () => void
  /** 保存。成功したら true（台帳へ戻る）。 */
  onSave: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const { selectedAccountId } = useAccount()
  const todayInput = toYmd(new Date())
  const [kind, setKind] = useState(preset.hold ? 'hold' : 'customer')
  const [holdMinutes, setHoldMinutes] = useState('15')
  const [whoTab, setWhoTab] = useState<'line' | 'phone'>('line')
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<Person[]>([])
  const [searchError, setSearchError] = useState('')
  const [person, setPerson] = useState<Person | null>(null)
  const [manualPhone, setManualPhone] = useState('')
  const [manualName, setManualName] = useState('')
  const [date, setDate] = useState(preset.date ? toYmd(preset.date) : todayInput)
  const [count, setCount] = useState('2')
  const [time, setTime] = useState(preset.time || '')
  const [tableMode, setTableMode] = useState(preset.tableId || 'auto')
  const [courseId, setCourseId] = useState('')
  const [allergy, setAllergy] = useState('')
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dayRows, setDayRows] = useState<RestaurantReservation[]>([])
  const [dayReady, setDayReady] = useState(false)
  const [hours, setHours] = useState<RestaurantOpeningDay[] | null>(null)
  const [history, setHistory] = useState<RestaurantCustomerHistory | null>(null)
  const [historyError, setHistoryError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const guests = Number(count)

  const dirty = kind !== (preset.hold ? 'hold' : 'customer') || search !== '' || person !== null || manualPhone !== '' || manualName !== ''
    || date !== (preset.date ? toYmd(preset.date) : todayInput) || count !== '2' || time !== (preset.time || '')
    || tableMode !== (preset.tableId || 'auto') || courseId !== '' || allergy !== '' || !notify
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  useEffect(() => {
    let current = true
    setDayReady(false)
    if (!selectedAccountId || !storeId) return
    void restaurantTestApi.reservationsDay(selectedAccountId, storeId, date).then((res) => {
      if (current) { setDayRows(Array.isArray(res.data?.reservations) ? res.data.reservations : []); setDayReady(true); setError(null) }
    }).catch(() => { if (current) setError('この日の予約を読み込めませんでした。日付を選び直してください。') })
    return () => { current = false }
  }, [selectedAccountId, storeId, date])

  useEffect(() => {
    let current = true
    if (!selectedAccountId || !storeId) return
    void restaurantTestApi.openingHours(selectedAccountId, storeId).then((res) => { if (current) setHours(res.data.hours) }).catch(() => { if (current) setHours(null) })
    return () => { current = false }
  }, [selectedAccountId, storeId])

  useEffect(() => {
    let current = true
    setFound([]); setSearchError('')
    if (!selectedAccountId || search.trim().length < 2) return
    const timer = setTimeout(() => {
      void restaurantTestApi.customerSearch(selectedAccountId, storeId, search.trim()).then((res) => {
        if (current) setFound(res.data.map((c) => ({ name: c.name, phone: c.phone || '', lineUid: c.lineUid || '' })))
      }).catch(() => { if (current) setSearchError('お客さまを検索できませんでした。もう一度入力してください。') })
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [selectedAccountId, storeId, search])

  const contactUid = person?.lineUid || ''
  const contactPhone = person?.phone || manualPhone.trim()
  useEffect(() => {
    let current = true
    setHistory(null); setHistoryError('')
    if (!selectedAccountId || (!contactUid && !contactPhone)) return
    const timer = setTimeout(() => {
      void restaurantTestApi.customerHistory(selectedAccountId, storeId, { lineUid: contactUid, phone: contactPhone }).then((res) => {
        if (current) setHistory(res.data)
      }).catch(() => { if (current) setHistoryError('来店履歴を読み込めませんでした。連絡先を確認してください。') })
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [selectedAccountId, storeId, contactUid, contactPhone])

  const activeTables = useMemo(() => tables.filter((t) => t.is_active).sort(floorOrder), [tables])
  const courses = useMemo(() => menuItems.filter((m) => m.status === 'active' && m.kind === 'course'), [menuItems])

  /* 受けられる時間：その曜日の開ける時間のうち、2時間いられる始まり（無ければ 17:00〜21:00）。 */
  const times = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    const weekday = y && m && d ? new Date(y, m - 1, d).getDay() : -1
    const periods = hours?.find((day) => day.weekday === weekday)?.periods
    const list: number[] = []
    if (periods && periods.length > 0) {
      for (const period of periods) {
        for (let t = toMinutes(period.opensAt); t + STAY_MINUTES <= toMinutes(period.closesAt); t += 30) list.push(t)
      }
    } else if (!hours) {
      for (let t = FALLBACK_START; t <= FALLBACK_END; t += 30) list.push(t)
    }
    return list.map(slotLabel)
  }, [date, hours])
  const freeAt = (label: string) => activeTables.some((t) => t.min_capacity <= guests && t.max_capacity >= guests && !overlaps(date, label, t.id, dayRows))

  const recommended = useMemo(
    () => (time ? recommendTable(activeTables, guests, (t) => !overlaps(date, time, t.id, dayRows)) : recommendTable(activeTables, guests, () => true)),
    [activeTables, guests, time, date, dayRows],
  )
  const endsAt = time ? slotLabel(toMinutes(time) + STAY_MINUTES) : ''
  const usedTableId = tableMode === 'auto' ? recommended?.id ?? '' : tableMode
  const name = person?.name || manualName.trim()
  const phone = person?.phone || manualPhone.trim()
  const lineUid = person?.lineUid || ''
  const course = courses.find((c) => c.id === courseId) ?? null
  const lastVisit = history?.visits[0] ?? null
  const lastAllergy = history?.visits.find((v) => v.allergy_note)?.allergy_note ?? null
  const [yy, mm, dd] = date.split('-').map(Number)
  const dayDate = yy && mm && dd ? new Date(yy, mm - 1, dd) : new Date()

  const save = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    setError(null)
    if (!storeId) { setError('店舗を選んでください。'); return }
    if (kind === 'customer' && !name) { setError('お客さまの名前を入れてください（探すか、電話番号と一緒に入力してください）。'); return }
    if (!date || !time) { setError('日付と時間を入れてください。'); return }
    if (!Number.isInteger(guests) || guests < 1 || guests > 100) { setError('人数は1〜100で入れてください。'); return }
    const startsAt = new Date(`${date}T${time.padStart(5, '0')}:00`).toISOString()
    const endsAtIso = new Date(new Date(startsAt).getTime() + STAY_MINUTES * 60_000).toISOString()
    void onSave({
      kind, holdMinutes: Number(holdMinutes), source: 'phone', storeId, customerName: name, customerPhone: phone || null, lineUid: lineUid || null,
      guestCount: guests, startsAt, endsAt: endsAtIso,
      tableId: tableMode === 'auto' ? null : tableMode,
      courseId: courseId || null,
      allergyNote: allergy.trim() || null, notifyLine: kind === 'customer' && notify,
    })
  }

  const preview = (
    <div className={styles.phoneSide}>
      <section className={styles.phoneSideCard} aria-labelledby="rs-phone-tables">
        <h3 id="rs-phone-tables" className={styles.sideTitle}>{time ? `${time}〜${endsAt} の卓（2時間）` : '時間を選ぶと卓が出ます'}</h3>
        {time ? (
          <>
            <div className={styles.phoneTables}>
              {activeTables.map((t) => {
                const taken = overlaps(date, time, t.id, dayRows)
                const chosen = usedTableId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={chosen}
                    disabled={taken}
                    className={`${styles.phoneTable} ${chosen ? styles.phoneTableChosen : taken ? styles.phoneTableTaken : ''}`}
                    onClick={() => setTableMode(t.id)}
                  >
                    {`${t.code}・${taken ? '使用中' : '空き'}`}
                  </button>
                )
              })}
            </div>
            <p className={styles.phoneLegend}>緑＝この予約で使う卓・赤＝埋まっている</p>
          </>
        ) : null}
      </section>
      <section className={styles.phoneSideCard} aria-labelledby="rs-phone-line">
        <h3 id="rs-phone-line" className={styles.sideTitle}>{`お客さまに LINE で確認を送る（${kind === 'customer' && notify ? 'オン' : 'オフ'}）`}</h3>
        <div className={styles.linePreview}>
          <p className={styles.linePreviewTitle}>{kind === 'hold' ? '（押さえは送りません）' : 'ご予約を承りました'}</p>
          <p className={styles.linePreviewBody}>{`${dayTitle(dayDate)}${time ? `${time}〜` : ''}・${guests}名・${course?.name ?? '席のみ'}`}</p>
          <p className={styles.linePreviewStore}>{storeName}</p>
        </div>
      </section>
      <section className={styles.phoneSideCard} aria-labelledby="rs-phone-who">
        <h3 id="rs-phone-who" className={styles.sideTitle}>この方について</h3>
        {history ? (
          <>
            <p className={styles.breakRow}><span>これまでの来店</span><strong>{`${history.visitCount} 回`}</strong></p>
            <p className={styles.breakRow}><span>前回</span><strong>{lastVisit ? `${new Date(lastVisit.starts_at).getMonth() + 1}/${new Date(lastVisit.starts_at).getDate()}・${lastVisit.guest_count}名・${lastVisit.table_label || '未配席'}` : '—'}</strong></p>
            <p className={styles.breakRow}><span>アレルギー（前回）</span><strong className={lastAllergy ? styles.alertText : undefined}>{lastAllergy || '—'}</strong></p>
          </>
        ) : (
          <p className={styles.sideText}>{historyError || (contactUid || contactPhone ? '来店履歴を読み込んでいます。' : 'お客さまを選ぶと、来店回数と前回が出ます。')}</p>
        )}
      </section>
    </div>
  )

  return (
    <>
      <CreatePage
        boardId="rm92Y"
        title="電話の予約を入れる"
        description="電話・店頭で受けた予約を台帳に入れます。空いている卓は自動で選びます。枠だけ押さえることもできます。"
        identity={<button type="button" className={styles.backLink} onClick={onBack}>← 予約台帳へ</button>}
        preview={preview}
        footerActions={(
          <>
            <Button onClick={onBack} disabled={busy}>キャンセル</Button>
            <Button variant="primary" disabled={busy || !storeId || !dayReady} onClick={() => formRef.current?.requestSubmit()}>
              {kind === 'hold' ? <Lock size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{kind === 'hold' ? '枠を押さえる' : '台帳に入れる'}
            </Button>
          </>
        )}
      >
        <form ref={formRef} className={styles.phoneForm} onSubmit={save}>
          <section className={styles.phoneCard} aria-labelledby="rs-phone-kind">
            <h2 id="rs-phone-kind" className={styles.phoneCardTitle}>何を入れますか</h2>
            <RadioCardGroup legend="何を入れますか" className={styles.kindCards}>
              <RadioCard name="rs-phone-kind" value="customer" checked={kind === 'customer'} onChange={setKind} icon={<UserPlus size={16} aria-hidden="true" />} title="お客さまの予約を入れる" note="電話・店頭で受けた予約" />
              <RadioCard name="rs-phone-kind" value="hold" checked={kind === 'hold'} onChange={setKind} icon={<Lock size={16} aria-hidden="true" />} title="枠だけ押さえる" note="電話・常連・団体のために空けておく" />
            </RadioCardGroup>
            {kind === 'hold' ? (
              <DialogField label="仮押さえの期限（分）" htmlFor="rs-phone-hold">
                <TextField id="rs-phone-hold" aria-label="仮押さえの期限（分）" type="number" min={1} max={120} value={holdMinutes} onChange={(event) => setHoldMinutes(event.target.value)} />
              </DialogField>
            ) : null}
          </section>
          {kind === 'customer' ? (
            <section className={styles.phoneCard} aria-labelledby="rs-phone-who-title">
              <div className={styles.phoneCardHead}>
                <h2 id="rs-phone-who-title" className={styles.phoneCardTitle}>だれの予約ですか</h2>
                <p className={styles.phoneCardText}>LINE の友だちなら名前で探して結びつけます。LINE 未連携の電話番号でも入れられます</p>
              </div>
              <div className={styles.whoTabs} role="tablist" aria-label="お客さまの探し方">
                <button type="button" role="tab" aria-selected={whoTab === 'line'} className={styles.whoTab} onClick={() => setWhoTab('line')}>LINE の友だち</button>
                <button type="button" role="tab" aria-selected={whoTab === 'phone'} className={styles.whoTab} onClick={() => setWhoTab('phone')}>LINE 未連携の電話番号</button>
              </div>
              {whoTab === 'line' ? (
                <>
                  {/* 選んだあとも探す欄は残す（絵 rm92Y：欄の下に選んだ人の行）。 */}
                  <SearchField
                    aria-label="名前・電話番号で探す"
                    placeholder="名前・電話番号で探す"
                    value={search}
                    /* 選んだあとに打ち直したら、選び直しとして扱う。 */
                    onChange={(value) => { setSearch(value); if (person) setPerson(null) }}
                    onClear={() => setSearch('')}
                  />
                  {!person && search.trim().length >= 2 ? (
                    <div className={styles.foundList}>
                      {searchError ? <p role="alert" className={styles.formError}>{searchError}</p> : null}
                      {found.length === 0 && !searchError ? <p className={styles.sideText}>台帳に見つかりません。電話番号のタブから入れられます。</p> : null}
                      {found.map((c) => (
                        <button key={`${c.lineUid || c.phone || c.name}`} type="button" className={styles.foundItem} onClick={() => { setPerson(c); setSearch('') }}>
                          {c.name}{c.phone ? `（${c.phone}）` : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {person ? (
                    <div className={styles.personRow}>
                      <span className={styles.personName}>{person.name}</span>
                      <span className={styles.personPill}>{`${person.lineUid ? 'LINE 連携済み' : 'LINE 未連携'}${history ? `・来店 ${history.visitCount} 回` : ''}`}</span>
                      <span className={styles.dateSpacer} />
                      <button type="button" className={styles.relink} onClick={() => { setPerson(null); setSearch('') }}>選び直す</button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className={styles.pair}>
                  <DialogField label="電話番号" htmlFor="rs-phone-tel">
                    <TextField id="rs-phone-tel" inputMode="tel" value={manualPhone} onChange={(event) => setManualPhone(event.target.value)} />
                  </DialogField>
                  <DialogField label="お名前" htmlFor="rs-phone-name">
                    <TextField id="rs-phone-name" value={manualName} onChange={(event) => setManualName(event.target.value)} />
                  </DialogField>
                </div>
              )}
            </section>
          ) : null}
          <section className={styles.phoneCard} aria-labelledby="rs-phone-when">
            <h2 id="rs-phone-when" className={styles.phoneCardTitle}>いつ・何人・どの卓</h2>
            <div className={styles.pair}>
              <DialogField label="日付" htmlFor="rs-phone-date">
                <TextField id="rs-phone-date" type="date" required value={date} onChange={(event) => { setDate(event.target.value); setTime('') }} />
              </DialogField>
              <DialogField label="人数" htmlFor="rs-phone-count">
                <TextField id="rs-phone-count" type="number" min={1} max={100} required value={count} onChange={(event) => setCount(event.target.value)} />
              </DialogField>
            </div>
            <div className={styles.timeBlock}>
              <p className={styles.timeLabel}>{`空いている時間（${guests}名が入る卓がある時間）`}</p>
              {times.length === 0 ? (
                <p className={styles.sideText}>この日は予約を受ける時間がありません（予約枠・在庫の開ける時間）。</p>
              ) : (
                <div className={styles.timeChips}>
                  {times.map((label) => {
                    const ok = freeAt(label)
                    return (
                      <button key={label} type="button" aria-pressed={time === label} disabled={!ok} className={styles.timeChip} onClick={() => setTime(label)}>{label}</button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className={styles.pair}>
              <DialogField label="卓" kind="select">
                <Select aria-label="卓" size="full" value={tableMode} onChange={setTableMode} options={[
                  { value: 'auto', label: recommended ? `自動で選ぶ（おすすめ：${recommended.code} ${recommended.label} ${recommended.max_capacity}名）` : '自動で選ぶ' },
                  ...activeTables.map((t) => ({ value: t.id, label: `${t.code}・${t.label}（${t.min_capacity}〜${t.max_capacity}名）` })),
                ]} />
              </DialogField>
              <DialogField label="コース" kind="select">
                <Select aria-label="コース" size="full" value={courseId} onChange={setCourseId} options={[
                  { value: '', label: '席のみ' },
                  ...courses.map((c) => ({ value: c.id, label: `${c.name} ${c.price.toLocaleString()}円` })),
                ]} />
              </DialogField>
            </div>
            <p className={styles.phoneNote}>自動で選ぶと、人数が入る卓のうち余る席が一番少ない卓にします（座席・卓管理の自動配席ルール）</p>
          </section>
          <section className={styles.phoneCard} aria-labelledby="rs-phone-allergy">
            <h2 id="rs-phone-allergy" className={styles.phoneCardTitle}>要望・アレルギー</h2>
            <DialogField label="アレルギー・特記事項" htmlFor="rs-phone-allergy-input">
              <TextField id="rs-phone-allergy-input" value={allergy} onChange={(event) => setAllergy(event.target.value)} />
            </DialogField>
          </section>
          {kind === 'customer' ? (
            <section className={styles.phoneCard} aria-labelledby="rs-phone-send">
              <div className={styles.phoneCardHead}>
                <h2 id="rs-phone-send" className={styles.phoneCardTitle}>お客さまに何を送りますか</h2>
                <p className={styles.phoneCardText}>LINE とつながっている方には予約の案内を送れます。送らない選択もできます</p>
              </div>
              <Checkbox checked={notify} onCheckedChange={setNotify}>
                <span className={styles.checkTitle}>予約を受け付けたことを、いますぐ LINE に送る</span>
                <span className={styles.checkSub}>日時・人数・コースを書いた案内が届きます</span>
              </Checkbox>
              <p className={styles.phoneNote}>前日・当日のご案内は「LINE来店フォロー」で決めた送り方で届きます。</p>
            </section>
          ) : null}
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        </form>
      </CreatePage>
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}
