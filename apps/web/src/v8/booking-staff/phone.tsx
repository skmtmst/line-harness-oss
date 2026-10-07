'use client'

/**
 * 予約スタッフの画面の右の列に出す「お客さまの予約画面」の写し（押せない見本）。
 * 実 LIFF（apps/liff）の並び「①メニュー → ②担当 → ③日時 → ④確認」の②と③。
 *   ② 担当を選ぶ … 予約スタッフを登録（CcA4k）
 *   ③ 日時を選ぶ … 勤務とシフト（d5fmnM）・自分の勤務（E3YDK）
 * 中身は実データ（作り物の名前は置かない）。今までの app/booking/menus/liff-phone-v8.tsx から写した。
 */
import type { ReactNode } from 'react'
import type { BookingAvailabilitySlot, BookingMenu, BookingStaff } from '@/lib/api'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import styles from './phone.module.css'

const WEEKDAY_JP = '日月火水木金土'
const STEP_LABELS = ['メニュー', '担当', '日時', '確認']

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function formatJpDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAY_JP[d.getUTCDay()]}）`
}

export function priceLabel(menu: Pick<BookingMenu, 'price_mode' | 'base_price'>): string {
  if (menu.price_mode === 'inquiry') return 'お問い合わせ'
  if (menu.price_mode === 'free' || menu.base_price === 0) return '無料'
  return `¥${menu.base_price.toLocaleString('ja-JP')}`
}

function PhoneChrome({ step, children, foot }: { step: number; children: ReactNode; foot: ReactNode }) {
  return (
    <div className={styles.phone} role="img" aria-label="お客さまの予約画面の見本">
      <div className={styles.status}>
        <span className={styles.time}>9:41</span>
        <span className={styles.statusIcons} aria-hidden="true">
          <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="3" width="3" height="8" rx="1" /><rect x="13.5" y="0.5" width="3" height="10.5" rx="1" /></svg>
          <svg width="25" height="11" viewBox="0 0 25 11" fill="none" stroke="currentColor"><rect x="0.5" y="0.5" width="21" height="10" rx="3" /><rect x="2.5" y="2.5" width="15" height="6" rx="1.5" fill="currentColor" stroke="none" /><path d="M23.5 3.5v4a2 2 0 0 0 0-4z" fill="currentColor" stroke="none" /></svg>
        </span>
      </div>
      <div className={styles.bar}>
        <span className={styles.barSide} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </span>
        <span className={styles.barTitle}>
          <span className={styles.barMain}>ご予約</span>
          <span className={styles.barShop}>然 - NEN -</span>
        </span>
        <span className={styles.barSide} aria-hidden="true">
          <svg width="18" height="6" viewBox="0 0 18 6" fill="currentColor"><circle cx="3" cy="3" r="1.6" /><circle cx="9" cy="3" r="1.6" /><circle cx="15" cy="3" r="1.6" /></svg>
        </span>
      </div>
      <div className={styles.steps} aria-hidden="true">
        {STEP_LABELS.map((label, i) => (
          <span key={label} className={styles.step} data-state={i + 1 < step ? 'done' : i + 1 === step ? 'now' : 'idle'}>
            <span className={styles.stepLine} />
            <span className={styles.stepLabel}>{i + 1} {label}</span>
          </span>
        ))}
      </div>
      <div className={styles.body}>{children}</div>
      <div className={styles.foot}>{foot}</div>
    </div>
  )
}

function CheckMark() {
  return (
    <svg className={styles.check} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6.5 10.2 8.9 12.6 13.5 7.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
}

function ListSkeleton() {
  return (
    <span className={styles.skeleton} aria-hidden="true">
      {[0, 1].map((i) => <Skeleton key={i} width="100%" height={76} />)}
    </span>
  )
}

/** ② 担当を選ぶ。指名なしを受ける担当がいれば、先頭に「指名なし」を選んだ形で出す。 */
export function PhoneStaffStep({ menu, staff, designationFree, status = 'ready' }: {
  menu: BookingMenu | null
  staff: BookingStaff[]
  designationFree: boolean
  status?: 'loading' | 'ready' | 'error'
}) {
  const shown = staff.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order)
  const people = shown.slice(0, designationFree ? 2 : 3)
  const empty = shown.length === 0 && !designationFree
  return (
    <PhoneChrome
      step={2}
      foot={<>
        <span className={styles.cta} data-off={empty || undefined}>日時を選ぶ</span>
        <span className={styles.back}>← メニューを選び直す</span>
      </>}
    >
      <h3 className={styles.title}>担当を選んでください</h3>
      {menu ? <p className={styles.sub}>{menu.name}・{menu.duration_minutes}分・{priceLabel(menu)}</p> : null}
      {status === 'loading' ? <DelayedSkeleton loading skeleton={<ListSkeleton />} />
        : status === 'error' ? <p className={styles.sub}>読み込めませんでした。</p>
          : (
            <>
              {designationFree ? (
                <div className={styles.card} data-picked="true">
                  <span className={styles.avatar} data-plain="true" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8" cy="7" r="3" /><path d="M2.5 16c.9-2.6 2.9-4 5.5-4s4.6 1.4 5.5 4" /><path d="M13 4.2a3 3 0 0 1 0 5.6M15 12.4c1.2.6 2 1.8 2.5 3.6" /></svg>
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName}>指名なし</span>
                    <span className={styles.cardDesc}>いちばん早く空いている人</span>
                  </span>
                  <CheckMark />
                </div>
              ) : null}
              {empty ? <p className={styles.sub}>担当できるスタッフはまだいません。</p> : people.map((person) => (
                <div key={person.id} className={styles.card}>
                  <span className={styles.avatar} aria-hidden="true">{person.display_name.slice(0, 1)}</span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName}>{person.display_name}</span>
                    <span className={styles.cardDesc}>{`${person.role ?? 'スタッフ'}・指名料なし`}</span>
                  </span>
                </div>
              ))}
            </>
          )}
    </PhoneChrome>
  )
}

/** ③ 日時を選ぶ（週で見る）。空きのある先頭の日から5日を並べ、その日の時刻を出す。 */
export function PhoneDatetimeStep({ menu, staffName, slots, closedDates, closedWeekdays, status = 'ready' }: {
  menu: BookingMenu | null
  /** 指名したときの担当の名前。無ければ「指名なし」。 */
  staffName: string | null
  slots: BookingAvailabilitySlot[]
  closedDates: string[]
  closedWeekdays: number[]
  status?: 'loading' | 'ready' | 'error'
}) {
  const byDate = new Map<string, BookingAvailabilitySlot[]>()
  for (const slot of slots) {
    const list = byDate.get(slot.date) ?? []
    list.push(slot)
    byDate.set(slot.date, list)
  }
  const openDates = [...byDate.keys()].sort()
  const selected = openDates[0] ?? null
  const anchor = selected ?? new Date().toISOString().slice(0, 10)
  const days = Array.from({ length: 5 }, (_, i) => addDaysStr(anchor, i))
  const closed = new Set(closedDates)
  const closedDow = new Set(closedWeekdays)
  const selectedSlots = selected ? (byDate.get(selected) ?? []) : []
  const picked = selectedSlots.find((slot) => slot.remaining > 0) ?? null
  return (
    <PhoneChrome
      step={3}
      foot={<>
        {picked && selected ? <span className={styles.footPick}>{formatJpDay(selected)}{picked.start}〜{picked.end}</span> : null}
        <span className={styles.cta} data-off={picked ? undefined : true}>内容を確かめる</span>
      </>}
    >
      <h3 className={styles.title}>日時を選んでください</h3>
      {menu ? <p className={styles.sub}>{menu.name}・{staffName ?? '指名なし'}</p> : null}
      <div className={styles.seg} aria-hidden="true">
        <span className={styles.segItem} data-now="true">週で見る</span>
        <span className={styles.segItem}>カレンダー</span>
      </div>
      <div className={styles.week}>
        <svg className={styles.nav} data-off="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
        <div className={styles.days}>
          {days.map((date) => {
            const d = new Date(`${date}T00:00:00Z`)
            const has = (byDate.get(date) ?? []).some((slot) => slot.remaining > 0)
            const isClosed = closed.has(date) || closedDow.has(d.getUTCDay())
            const state = isClosed ? '休み' : has ? '空き' : '満'
            return (
              <span key={date} className={styles.day} data-now={date === selected || undefined} data-closed={isClosed || undefined}>
                <span className={styles.dow}>{WEEKDAY_JP[d.getUTCDay()]}</span>
                <span className={styles.num}>{d.getUTCDate()}</span>
                <span className={styles.dayState} data-tone={isClosed ? 'off' : has ? 'open' : 'full'}>{state}</span>
              </span>
            )
          })}
        </div>
        <svg className={styles.nav} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
      </div>
      {selected ? <p className={styles.dayLabel}>{formatJpDay(selected)}の空き</p> : null}
      {status === 'loading' ? (
        <DelayedSkeleton loading skeleton={<span className={styles.slots} aria-hidden="true">{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={44} />)}</span>} />
      ) : status === 'error' ? <p className={styles.sub}>空きを読み込めませんでした。</p>
        : selected === null ? <p className={styles.sub}>この期間に空きはありません。</p>
          : (
            <div className={styles.slots}>
              {selectedSlots.slice(0, 6).map((slot) => (
                <span key={`${slot.date}-${slot.start}`} className={styles.slot} data-now={slot === picked || undefined} data-off={slot.remaining <= 0 || undefined}>{slot.start}</span>
              ))}
            </div>
          )}
    </PhoneChrome>
  )
}
