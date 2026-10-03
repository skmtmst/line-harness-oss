'use client'

/*
 * ★V8-B 予約台帳 電話の予約を入れる（板 `rm92Y`）。
 *
 * 電話・店頭で受けた予約を台帳に入れる。空いている卓は自動で選ぶ
 * （サーバが人数に合う余剰最小の卓を確定する。口の応答が正）。
 * お客さまの特定・来店回数は台帳の記録からの名寄せで出す（新しい口は使わない）。
 *
 * 今の作りのままの所（口が無いので作らない）：
 * - 「枠だけ押さえる」：押さえの口が無い。選べない形で置く。
 * - 前日・当日の思い出し送り：予約ごとの送り分け口が無いので出さない。
 *   いますぐ送る（notifyLine・口あり）だけ出す。
 */
import { FormEvent, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import LinePreview from '@/components/shared/line-preview'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import type { RestaurantReservation } from '@/lib/restaurant-test-api'
import { Panel } from './shell'
import ledger from './reservations.module.css'

export type PhonePreset = {
  date?: Date
  time?: string
  tableId?: string
}

export type PhoneTable = {
  id: string
  code: string
  label: string
  capacity: string
  min: number
  max: number
  active: boolean
}

export type PhoneCourse = {
  id: string
  name: string
}

const BUSINESS_START = 11 * 60
const BUSINESS_END = 22 * 60
const STAY_MINUTES = 120

function toDateInput(day: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

function slotLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${minutes % 60 === 0 ? '00' : '30'}`
}

function addMinutes(time: string, delta: number): string {
  const [hour, minute] = time.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return ''
  return slotLabel(hour * 60 + minute + delta)
}

/** 希望の時間帯と重なる予約があるか。 */
function overlaps(day: string, time: string, tableId: string, rows: RestaurantReservation[]): boolean {
  const start = new Date(`${day}T${time}:00`).getTime()
  if (!Number.isFinite(start)) return false
  const end = start + STAY_MINUTES * 60_000
  return rows.some((r) => {
    if (r.table_id !== tableId) return false
    const s = new Date(r.starts_at).getTime()
    const e = new Date(r.ends_at).getTime()
    return s < end && e > start
  })
}

/** 人数が入る卓のうち余る席が一番少ない卓（口の自動配席と同じ決まり）。 */
function recommendTable(tables: PhoneTable[], count: number): PhoneTable | null {
  const suitable = tables
    .filter((t) => t.active && t.min <= count && t.max >= count)
    .sort((a, b) => (a.max - count) - (b.max - count) || a.max - b.max || a.id.localeCompare(b.id))
  return suitable[0] || null
}

type Person = {
  name: string
  phone: string
  lineUid: string
}

export default function ReservationPhone({ storeId, storeName, tables, courses, reservations, busy, preset, onBack, onSaved, onSave }: {
  storeId: string
  storeName: string
  tables: PhoneTable[]
  courses: PhoneCourse[]
  reservations: RestaurantReservation[]
  busy: boolean
  preset: PhonePreset
  onBack: () => void
  onSaved: () => void
  onSave: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const todayInput = toDateInput(new Date())
  const [kind, setKind] = useState('customer')
  const [whoTab, setWhoTab] = useState<'line' | 'phone'>('line')
  const [search, setSearch] = useState('')
  const [person, setPerson] = useState<Person | null>(null)
  const [manualPhone, setManualPhone] = useState('')
  const [manualName, setManualName] = useState('')
  const [date, setDate] = useState(preset.date ? toDateInput(preset.date) : todayInput)
  const [count, setCount] = useState(2)
  const [time, setTime] = useState(preset.time || '')
  const [tableMode, setTableMode] = useState(preset.tableId || 'auto')
  const [courseId, setCourseId] = useState('')
  const [allergy, setAllergy] = useState('')
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const dirty = kind !== 'customer' || whoTab !== 'phone' || search !== '' || person !== null
    || manualPhone !== '' || manualName !== '' || date !== todayInput || count !== 2 || time !== ''
    || tableMode !== 'auto' || courseId !== '' || allergy !== '' || !notify
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  /* 台帳の記録からの名寄せ（電話番号・LINE UID）。 */
  const candidates = useMemo(() => {
    const query = search.trim()
    if (query.length < 2) return []
    const seen = new Map<string, Person>()
    for (const r of reservations) {
      const hit = r.customer_name.includes(query)
        || (r.customer_phone || '').includes(query)
        || (r.line_uid || '').includes(query)
      if (!hit) continue
      const key = r.line_uid || r.customer_phone || r.customer_name
      if (!seen.has(key)) seen.set(key, { name: r.customer_name, phone: r.customer_phone || '', lineUid: r.line_uid || '' })
      if (seen.size >= 8) break
    }
    return [...seen.values()]
  }, [reservations, search])

  const visits = useMemo(() => {
    if (!person) return []
    return reservations
      .filter((r) => (person.lineUid && r.line_uid === person.lineUid)
        || (person.phone && r.customer_phone === person.phone)
        || r.customer_name === person.name)
      .sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at))
  }, [reservations, person])

  const lastVisit = visits[0] || null
  const lastAllergy = visits.find((r) => r.allergy_note)?.allergy_note || null

  /* 空いている時間（人数が入る卓が1つでも空く時間）。 */
  const freeTimes = useMemo(() => {
    const list: string[] = []
    for (let m = BUSINESS_START; m < BUSINESS_END; m += 30) {
      const label = slotLabel(m)
      const ok = tables.some((t) => t.active && t.min <= count && t.max >= count && !overlaps(date, label, t.id, reservations))
      if (ok) list.push(label)
    }
    return list
  }, [tables, count, date, reservations])

  const recommended = useMemo(() => recommendTable(tables, count), [tables, count])
  const endsAt = time ? addMinutes(time, STAY_MINUTES) : ''
  const name = person?.name || manualName.trim()
  const phone = person?.phone || manualPhone.trim()
  const lineUid = person?.lineUid || ''

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!storeId) {
      setError('上の欄で店舗を選んでください。')
      return
    }
    if (!name) {
      setError('お客さまの名前を入れてください（探すか、電話番号と一緒に入力してください）。')
      return
    }
    if (!date || !time) {
      setError('日付と時間を入れてください。')
      return
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setError('人数は1〜100で入れてください。')
      return
    }
    const startsAt = new Date(`${date}T${time}:00`).toISOString()
    const endsAtIso = new Date(new Date(startsAt).getTime() + STAY_MINUTES * 60_000).toISOString()
    /* 成功したら番兵を黙らせるため、保存中（busy）のまま一覧へ戻る。 */
    void onSave({
      storeId, customerName: name, customerPhone: phone || null, lineUid: lineUid || null,
      guestCount: count, startsAt, endsAt: endsAtIso,
      tableId: tableMode === 'auto' ? null : tableMode,
      courseId: courseId || null,
      allergyNote: allergy.trim() || null, notifyLine: notify,
    }).then((ok) => { if (ok) onSaved() })
  }

  return (
    <div className={ledger.ledgerBoard}>
      <div>
        <Button onClick={onBack}>← 予約台帳へ</Button>
      </div>
      <div className={ledger.phoneBody}>
        <form ref={formRef} className={ledger.phoneMain} onSubmit={save}>
          <Panel title="何を入れますか">
            <RadioCardGroup legend="何を入れますか">
              <RadioCard
                name="ledger-phone-kind"
                value="customer"
                checked={kind === 'customer'}
                onChange={setKind}
                title="お客さまの予約を入れる"
                note="電話・店頭で受けた予約"
              />
              <RadioCard
                name="ledger-phone-kind"
                value="hold"
                checked={false}
                onChange={() => {}}
                title="枠だけ押さえる"
                note="電話・常連・団体のために空けておく"
                disabled
                disabledReason="枠を押さえる口が無いため、今は使えません"
              />
            </RadioCardGroup>
          </Panel>

          <Panel
            title="だれの予約ですか"
            description="LINEの友だちなら名前で探して結びつけます。LINE未連携の電話番号でも入れられます"
          >
            <div className={ledger.viewTabs} role="tablist" aria-label="お客さまの探し方">
              <button type="button" role="tab" aria-selected={whoTab === 'line'} className={ledger.viewTab} onClick={() => setWhoTab('line')}>LINEの友だち</button>
              <button type="button" role="tab" aria-selected={whoTab === 'phone'} className={ledger.viewTab} onClick={() => setWhoTab('phone')}>LINE未連携の電話番号</button>
            </div>
            {whoTab === 'line' ? (
              <>
                <label className="mt-3 block text-xs font-medium text-ink-secondary">名前・電話番号で探す
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前・電話番号で探す" aria-label="名前・電話番号で探す" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
                </label>
                {search.trim().length >= 2 && !person ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {candidates.length === 0 ? <p className={ledger.inlineNote}>台帳に見つかりません。電話番号のタブから入れられます。</p> : null}
                    {candidates.map((c) => (
                      <button
                        key={`${c.lineUid || c.phone || c.name}`}
                        type="button"
                        className={ledger.slotAdd}
                        onClick={() => setPerson(c)}
                      >
                        {c.name}{c.phone ? `（${c.phone}）` : ''}
                      </button>
                    ))}
                  </div>
                ) : null}
                {person ? (
                  <div className={`${ledger.personCard} mt-3`}>
                    <div>
                      <p className={ledger.personName}>{person.name}</p>
                      <p className={ledger.personMeta}>
                        {person.lineUid ? 'LINE連携済み' : 'LINE未連携'}{visits.length > 0 ? `・来店${visits.length}回` : ''}
                      </p>
                    </div>
                    <Button size="compact" onClick={() => { setPerson(null); setSearch('') }}>選び直す</Button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-ink-secondary">電話番号
                  <input value={manualPhone} onChange={(event) => setManualPhone(event.target.value)} inputMode="tel" aria-label="電話番号" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
                </label>
                <label className="text-xs font-medium text-ink-secondary">お名前
                  <input value={manualName} onChange={(event) => setManualName(event.target.value)} aria-label="お名前" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
                </label>
              </div>
            )}
          </Panel>

          <Panel title="いつ・何人・どの卓">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-ink-secondary">日付
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required aria-label="日付" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
              </label>
              <label className="text-xs font-medium text-ink-secondary">人数
                <input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} required aria-label="人数" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
              </label>
            </div>
            <p className={`${ledger.fieldHelp} mt-3`}>空いている時間（{count}名が入る卓がある時間）{endsAt ? `・${time}〜${endsAt}（2時間）` : ''}</p>
            <div className={`${ledger.timeChips} mt-2`}>
              {freeTimes.map((label) => (
                <button key={label} type="button" aria-pressed={time === label} className={ledger.timeChip} onClick={() => setTime(label)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-ink-secondary">卓
                <Select aria-label="卓" value={tableMode} onChange={setTableMode} size="full" className="mt-1" options={[
                  { value: 'auto', label: recommended ? `自動で選ぶ（おすすめ：${recommended.code} ${recommended.capacity}）` : '自動で選ぶ' },
                  ...tables.filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.code}・${t.label}（${t.capacity}）` })),
                ]} />
              </label>
              <label className="text-xs font-medium text-ink-secondary">コース
                <Select aria-label="コース" value={courseId} onChange={setCourseId} size="full" className="mt-1" options={[
                  { value: '', label: '席のみ' },
                  ...courses.map((c) => ({ value: c.id, label: c.name })),
                ]} />
              </label>
            </div>
            <p className={ledger.fieldHelp}>自動で選ぶと、人数が入る卓のうち余る席が一番少ない卓にします（座席・卓管理の自動配席ルール）。</p>
          </Panel>

          <Panel title="要望・アレルギー">
            <label className="text-xs font-medium text-ink-secondary">アレルギー・特記事項
              <input value={allergy} onChange={(event) => setAllergy(event.target.value)} placeholder="えび" aria-label="アレルギー・特記事項" className="mt-1 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm font-normal text-ink" />
            </label>
          </Panel>

          <Panel
            title="お客さまに何を送りますか"
            description="LINEとつながっている方には予約の案内を送れます。送らない選択もできます"
          >
            <Checkbox checked={notify} onCheckedChange={setNotify}>
              予約を受け付けたことを、いますぐLINEに送る
            </Checkbox>
            <p className={ledger.fieldHelp}>日時・人数・コースを書いた案内が届きます。前日・当日の思い出し送りは、送り分けの口が無いため今は出していません。</p>
          </Panel>
          {error ? <p className={ledger.formError} role="alert">{error}</p> : null}
        </form>

        <div className={ledger.sideCol}>
          <section className={ledger.sideCard} aria-label="その時間の卓">
            <h3 className={ledger.sideCardTitle}>{time ? `${time}〜${endsAt}の卓（2時間）` : '時間を選ぶと卓が出ます'}</h3>
            {time ? (
              <>
                <div className={ledger.tableChips}>
                  {tables.filter((t) => t.active).map((t) => {
                    const busyTable = overlaps(date, time, t.id, reservations)
                    const selected = tableMode === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={selected}
                        className={`${ledger.tableChip} ${busyTable ? ledger.tableChipBusy : ledger.tableChipFree}`}
                        onClick={() => setTableMode(t.id)}
                      >
                        {t.code}・{busyTable ? '使用中' : '空き'}
                      </button>
                    )
                  })}
                </div>
                <p className={ledger.chipLegend}>緑＝この予約で使う卓・赤＝埋まっている</p>
              </>
            ) : null}
          </section>
          <section className={ledger.sideCard} aria-label="届く見本">
            <h3 className={ledger.sideCardTitle}>お客さまにLINEで確認を送る{notify ? '（オン）' : '（オフ）'}</h3>
            <LinePreview>
              <div>
                <p className={ledger.previewBubbleTitle}>ご予約を承りました</p>
                <p className={ledger.previewBubbleBody}>
                  {date.replace(/-/g, '/')} {time}{endsAt ? `〜${endsAt}` : ''}・{count}名・{courses.find((c) => c.id === courseId)?.name || '席のみ'}
                  {storeName ? `・${storeName}` : ''}
                </p>
              </div>
            </LinePreview>
          </section>
          <section className={ledger.sideCard} aria-label="この方について">
            <h3 className={ledger.sideCardTitle}>この方について</h3>
            {person ? (
              <>
                <div className={ledger.breakRow}><span>これまでの来店</span><strong>{visits.length}回</strong></div>
                <div className={ledger.breakRow}><span>前回</span><strong>{lastVisit ? `${lastVisit.starts_at.slice(5, 10).replace('-', '/')}・${lastVisit.guest_count}名・${lastVisit.table_label || '未配席'}` : '—'}</strong></div>
                <div className={ledger.breakRow}><span>アレルギー（前回）</span><strong>{lastAllergy || '—'}</strong></div>
              </>
            ) : (
              <p className={ledger.inlineNote}>お客さまを選ぶと、来店回数と前回が出ます。</p>
            )}
          </section>
        </div>
      </div>
      <StickyBar
        status={storeId ? '下書き（まだ誰にも公開されません）' : '上の欄で店舗を選んでください'}
        actions={(
          <>
            <Button onClick={onBack}>キャンセル</Button>
            <Button
              variant="primary"
              disabled={busy || !storeId}
              onClick={() => formRef.current?.requestSubmit()}
            >
              ✓ 台帳に入れる
            </Button>
          </>
        )}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
