'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import {
  api,
  ApiError,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingMenu,
  type BookingMenuStaff,
  type FriendListItem,
  type ProxyBookingResult,
} from '@/lib/api'
import { reminderScheduleLabels } from './proxy-booking-schedule'

type Step = 'input' | 'confirm' | 'done' | 'conflict'

const NODE_BY_STEP: Record<Step, string> = {
  input: 'cpdDi',
  confirm: 'GFDqW',
  done: 'GfceK',
  conflict: 'Lg8ff',
}

function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`
}

function toUtcIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+09:00`).toISOString()
}

function dateLabel(date: string, time: string): string {
  if (!date || !time) return '—'
  return new Date(`${date}T${time}:00+09:00`).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  })
}

function timeRangeLabel(date: string, time: string, minutes: number): string {
  if (!date || !time) return '—'
  const startsAt = new Date(`${date}T${time}:00+09:00`)
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000)
  return `${dateLabel(date, time)} 〜 ${endsAt.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  })}`
}

export default function NewProxyBookingPage() {
  const { selectedAccountId } = useAccount()
  const [step, setStep] = useState<Step>('input')
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [staff, setStaff] = useState<BookingMenuStaff[]>([])
  const [slots, setSlots] = useState<BookingAvailabilitySlot[]>([])
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [friendQuery, setFriendQuery] = useState('')
  const [friend, setFriend] = useState<FriendListItem | null>(null)
  const [menuId, setMenuId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [result, setResult] = useState<ProxyBookingResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const slotRequest = useRef(0)

  const selectionKey = [selectedAccountId ?? '', friend?.id ?? '', menuId, staffId, date, time].join('\u001f')
  const latestSelectionKey = useRef(selectionKey)
  latestSelectionKey.current = selectionKey

  const menu = menus.find((item) => item.id === menuId) ?? null
  const selectedStaff = staff.find((item) => item.id === staffId) ?? null
  const selectedSlot = slots.find((item) => item.date === date && item.start === time) ?? null
  const occupiedMinutes = selectedSlot
    ? (new Date(`${date}T${selectedSlot.end}:00+09:00`).getTime() - new Date(`${date}T${selectedSlot.start}:00+09:00`).getTime()) / 60_000
    : selectedStaff?.duration_minutes ?? 0

  useEffect(() => {
    setStep('input')
    setFriend(null)
    setFriendQuery('')
    setMenuId('')
    setStaffId('')
    setDate('')
    setTime('')
    setResult(null)
    setIdempotencyKey('')
    setLoading(false)
    setError('')
  }, [selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) {
      setMenus([])
      return
    }
    let active = true
    void bookingApi.listMenus(selectedAccountId)
      .then((response) => {
        if (active) setMenus(response.menus.filter((item) => item.is_active === 1))
      })
      .catch(() => {
        if (active) setError('予約メニューを読み込めませんでした')
      })
    return () => { active = false }
  }, [selectedAccountId])

  useEffect(() => {
    setStaffId('')
    setTime('')
    setSlots([])
    if (!selectedAccountId || !menuId) {
      setStaff([])
      return
    }
    let active = true
    void bookingApi.listMenuStaff(selectedAccountId, menuId)
      .then((response) => {
        if (active) setStaff(response.staff)
      })
      .catch(() => {
        if (active) setError('担当者を読み込めませんでした')
      })
    return () => { active = false }
  }, [selectedAccountId, menuId])

  const loadSlots = useCallback(async () => {
    const requestId = ++slotRequest.current
    if (!selectedAccountId || !menuId || !staffId || !date) {
      setSlots([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await bookingApi.getAvailability(selectedAccountId, {
        menuId, staffId, from: date, to: date,
      })
      if (requestId === slotRequest.current) {
        setSlots(response.by_staff.find((item) => item.staff_id === staffId)?.slots ?? [])
      }
    } catch {
      if (requestId === slotRequest.current) {
        setSlots([])
        setError('空き時間を確認できませんでした')
      }
    } finally {
      if (requestId === slotRequest.current) setLoading(false)
    }
  }, [selectedAccountId, menuId, staffId, date])

  useEffect(() => {
    setTime('')
    void loadSlots()
  }, [loadSlots])

  useEffect(() => {
    const query = friendQuery.trim()
    if (!selectedAccountId || query.length < 2 || friend) {
      setFriends([])
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void api.friends.list({ accountId: selectedAccountId, search: query, limit: 20 })
        .then((response) => {
          if (active && response.success) setFriends(response.data.items)
        })
        .catch(() => {
          if (active) setError('友だちを検索できませんでした')
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [selectedAccountId, friendQuery, friend])

  const validation = useMemo(() => {
    if (!selectedAccountId) return 'LINEアカウントを選択してください'
    if (!friend) return '予約する友だちを選択してください'
    if (!menu) return '予約メニューを選択してください'
    if (!selectedStaff) return '担当者を選択してください'
    if (!date || !time) return '空いている日時を選択してください'
    return null
  }, [selectedAccountId, friend, menu, selectedStaff, date, time])

  async function review() {
    if (validation) {
      setError(validation)
      return
    }
    if (!selectedAccountId || !menu || !selectedStaff || !date || !time) return
    const requestKey = selectionKey
    setLoading(true)
    setError('')
    try {
      // 入力時に見えた空き枠は、確認へ進むまでに別の予約で埋まることがある。
      // 確認画面へ進む直前に同じ口を読み直し、古い空き枠を確定候補にしない。
      const latest = await bookingApi.getAvailability(selectedAccountId, {
        menuId: menu.id,
        staffId: selectedStaff.id,
        from: date,
        to: date,
      })
      if (latestSelectionKey.current !== requestKey) return
      const available = latest.by_staff
        .find((item) => item.staff_id === selectedStaff.id)
        ?.slots.some((slot) => slot.date === date && slot.start === time)
      if (!available) {
        setStep('conflict')
        setError('選んだ時間は、ほかの予約で埋まりました')
        return
      }
      setIdempotencyKey(crypto.randomUUID())
      setStep('confirm')
    } catch {
      if (latestSelectionKey.current !== requestKey) return
      setError('空き時間を再確認できませんでした。状態を読み直して、もう一度お試しください。')
    } finally {
      if (latestSelectionKey.current === requestKey) setLoading(false)
    }
  }

  async function createBooking() {
    if (!selectedAccountId || !friend || !menu || !selectedStaff || !date || !time) return
    const requestKey = selectionKey
    setLoading(true)
    setError('')
    try {
      const created = await bookingApi.createProxyBooking(selectedAccountId, {
        friend_id: friend.id,
        menu_id: menu.id,
        staff_id: selectedStaff.id,
        starts_at: toUtcIso(date, time),
        customer_note: customerNote.trim() || undefined,
      }, idempotencyKey)
      if (latestSelectionKey.current !== requestKey) return
      setResult(created)
      setStep('done')
    } catch (cause) {
      if (latestSelectionKey.current !== requestKey) return
      if (
        cause instanceof ApiError
        && (cause.code === 'slot_conflict' || cause.code === 'slot_not_available')
      ) {
        setStep('conflict')
        setError('選んだ時間は、ほかの予約で埋まりました')
      } else {
        setError('予約を登録できませんでした。状態を確認して、もう一度お試しください。')
      }
    } finally {
      if (latestSelectionKey.current === requestKey) setLoading(false)
    }
  }

  async function recoverConflict() {
    setStep('input')
    setTime('')
    await loadSlots()
  }

  return (
    <div data-design-node={NODE_BY_STEP[step]} className="space-y-4 pb-24">
      <nav data-design="Crumb" aria-label="現在位置" className="text-ink-faint text-xs">
        <Link href="/booking/bookings" className="text-accent">予約</Link>
        <span className="mx-2">›</span>
        <Link href="/booking/bookings" className="text-accent">予約管理</Link>
        <span className="mx-2">›</span>
        <span>{step === 'confirm' ? '内容を確認' : step === 'done' ? '登録が終わりました' : step === 'conflict' ? '入れられません' : '電話の予約を入れる'}</span>
      </nav>

      {error && step !== 'conflict' && (
        <div className="border-danger bg-danger-bg text-danger rounded-card border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {step === 'input' && (
        <div data-design="Body" className="grid gap-4 xl:flex">
          <div className="min-w-0 flex-1 space-y-4">
            <Card title="だれの予約ですか" note="LINEの友だちなら、名前で探して結びつけてください。">
              {friend ? (
                <div className="border-hairline bg-canvas-sunken flex items-center justify-between rounded-control border px-3 py-3">
                  <div>
                    <p className="text-ink text-sm font-medium">{friend.displayName}</p>
                    <p className="text-ink-faint mt-1 text-xs">LINE連携済み</p>
                  </div>
                  <button type="button" className="text-accent text-sm" onClick={() => {
                    setFriend(null)
                    setFriendQuery('')
                  }}>選び直す</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={friendQuery}
                    onChange={(event) => setFriendQuery(event.target.value)}
                    placeholder="名前・電話番号で探す"
                    className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                  />
                  {friends.length > 0 && (
                    <div className="border-hairline bg-canvas absolute z-20 mt-1 max-h-64 w-full divide-y overflow-y-auto rounded-control border shadow-lg">
                      {friends.map((item) => (
                        <button key={item.id} type="button" onClick={() => {
                          setFriend(item)
                          setFriendQuery(item.displayName)
                        }} className="hover:bg-canvas-sunken block w-full px-3 py-2 text-left text-sm">
                          {item.displayName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="text-ink-faint mt-2 text-xs">
                LINE未連携の電話客は、顧客台帳の受け皿ができるまで登録できません。別の友だちへ推測で結び付けません。
              </p>
            </Card>

            <Card title="いつ・何を">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="予約メニュー">
                  <Select
                    aria-label="予約メニュー"
                    value={menuId}
                    onChange={setMenuId}
                    options={[{ value: '', label: '選択してください' }, ...menus.map((item) => ({ value: item.id, label: item.name }))]}
                    size="full"
                  />
                </Field>
                <Field label="担当者">
                  <Select
                    aria-label="担当者"
                    value={staffId}
                    onChange={setStaffId}
                    options={[{ value: '', label: '選択してください' }, ...staff.map((item) => ({ value: item.id, label: item.display_name }))]}
                    disabled={!menuId}
                    size="full"
                  />
                </Field>
                <Field label="日付">
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                </Field>
                <Field label="空いている時間">
                  <Select
                    aria-label="空いている時間"
                    value={time}
                    onChange={setTime}
                    options={[
                      { value: '', label: loading ? '確認中です' : '選択してください' },
                      ...slots.map((slot) => ({ value: slot.start, label: `${slot.start}〜${slot.end}` })),
                    ]}
                    disabled={!date || loading}
                    size="full"
                  />
                </Field>
              </div>
              {date && time && selectedStaff && menu ? (
                <div className="border-success bg-success-bg text-success mt-3 rounded-control border px-3 py-2 text-xs font-semibold">
                  {dateLabel(date, time)} は空いています。{selectedStaff.duration_minutes}分のメニューです。
                </div>
              ) : null}
            </Card>

            <Card title="お客様からの要望">
              <textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={4} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" placeholder="予約時に確認した内容を入力" />
            </Card>

            <Card title="お客様に何を送りますか" note="LINEと結びついている方には、予約後の案内を送ります。">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="text-success font-bold">✓</span>
                  <div><p className="text-ink text-sm font-medium">予約を受け付けたことを、いますぐLINEに送る</p><p className="text-ink-faint mt-0.5 text-xs">日時・メニュー・担当を書いた案内が届きます。</p></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-success font-bold">✓</span>
                  <div><p className="text-ink text-sm font-medium">前日に思い出してもらう</p><p className="text-ink-faint mt-0.5 text-xs">予約設定から計算した時刻に送ります。</p></div>
                </div>
                <div className="flex gap-3">
                  <span className="text-success font-bold">✓</span>
                  <div><p className="text-ink text-sm font-medium">当日のお知らせを送る</p><p className="text-ink-faint mt-0.5 text-xs">開始まで十分な時間がある場合だけ送ります。</p></div>
                </div>
              </div>
            </Card>
          </div>

          <div data-design="Right" className="w-full space-y-4 xl:flex-none" style={{ maxWidth: 390 }}>
            <Card title={friend ? `${friend.displayName}さんにはこう届きます` : 'お客様にはこう届きます'}>
              <div className="rounded-card bg-action-soft p-3">
                <p className="text-action mb-2 text-center text-xs font-semibold">LINEプレビュー</p>
                <div className="rounded-card bg-canvas p-4 text-sm leading-6">
                  <p>{friend?.displayName ?? 'お客様'}さま</p>
                  <p className="font-semibold">ご予約を承りました。</p>
                  <p className="mt-3">{date && time ? dateLabel(date, time) : '日時を選ぶと表示されます'}</p>
                  <p>{menu?.name ?? 'メニューを選ぶと表示されます'} ／ 担当 {selectedStaff?.display_name ?? '—'}</p>
                </div>
              </div>
            </Card>
            <Card title="この方について">
              {friend ? (
                <div className="space-y-2 text-xs">
                  <p><strong className="text-success">LINEと結びついています</strong></p>
                  <p className="text-ink-faint">来店履歴と前回の申し送りは、友だち詳細で確認できます。</p>
                </div>
              ) : <p className="text-ink-faint text-xs">友だちを選ぶと、連絡方法と来店履歴を確認できます。</p>}
            </Card>
            <Card title="つながる先">
              <div className="text-ink-secondary space-y-2 text-xs">
                <p>→ 予約管理　入れたあとの台帳</p>
                <p>→ 予約設定　メニューと空き枠</p>
                <p>→ リマインダ　前日・当日のお知らせ</p>
                <p>→ 友だち　顧客カルテに残ります</p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {step === 'confirm' && friend && menu && selectedStaff && (
        <div data-design="Body" className="grid gap-4 xl:grid-cols-4">
          <div data-design="Left" className="min-w-0 space-y-4 xl:col-span-3">
            <Card title="だれの予約か">
              <Summary label="お客様" value={friend.displayName} />
              <Summary label="電話番号" value="友だち情報欄で確認" />
              <Summary label="ペットの名前" value="未取得" />
              <Summary label="LINEとの結びつき" value="結びついています" />
            </Card>
            <Card title="いつ・何を">
              <Summary label="日時" value={timeRangeLabel(date, time, occupiedMinutes)} />
              <Summary label="メニュー" value={`${menu.name}（${occupiedMinutes}分）`} />
              <Summary label="担当" value={selectedStaff.display_name} />
              <Summary label="お客様からのご希望" value={customerNote.trim() || '記入なし'} />
            </Card>
            <Card title="お客様に送るもの">
              <NoticeRow title="いますぐ LINE に送る" detail="日時・メニュー・担当を書いた案内が届きます" />
              {reminderScheduleLabels(date, time).map((label) => (
                <NoticeRow key={label} title={`${label} に思い出してもらう`} detail="リマインダから自動で送ります" />
              ))}
            </Card>
            <p data-booking-slot-check="available" className="border-success bg-success-bg text-success rounded-card border px-4 py-3 text-xs">
              この日時は、確認画面を開く直前に空きを再確認しました。
            </p>
          </div>
          <aside data-design="Right" className="space-y-4">
            <Card title={`${friend.displayName}さんにはこう届きます`} note="送る前に、文面をそのまま確かめられます。">
              <LinePreview friendName={friend.displayName} menuName={menu.name} staffName={selectedStaff.display_name} date={date} time={time} sent={false} />
            </Card>
            <WarningCard title="気をつけること" lines={['LINEと結びついていない方には、自動のお知らせは届きません', 'あとで時間を変えたときは、もう一度お知らせを送ってください']} />
            <RelatedLinks includeConversion={false} />
          </aside>
        </div>
      )}

      {step === 'conflict' && friend && menu && selectedStaff && (
        <>
          <section className="border-danger bg-danger-bg text-danger flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3">
            <div><p className="text-sm font-semibold">{dateLabel(date, time)} は {selectedStaff.display_name} がふさがっています</p><p className="mt-1 text-xs">同じ担当が同じ時間に2件受けることはできません。時間か担当を変えてください。</p></div>
            <Button onClick={() => void recoverConflict()}>空いている時間を見る</Button>
          </section>
          <div data-design="Body" className="grid gap-4 xl:grid-cols-4">
            <div data-design="Left" className="min-w-0 space-y-4 xl:col-span-3">
              <Card title="だれの予約か"><Summary label="お客様" value={friend.displayName} /><Summary label="LINEとの結びつき" value="結びついています" /></Card>
              <Card title="いつ・何を" note="時間が重なっています。右の空いている時間から選べます。">
                <Summary label="メニュー" value={`${menu.name}（${occupiedMinutes}分）`} />
                <Summary label="日付" value={dateLabel(date, time).split(' ')[0]} />
                <Summary label="時刻" value={time} />
                <Summary label="担当" value={selectedStaff.display_name} />
                <p className="text-danger mt-3 text-xs">選んだ時間は、ほかの予約で埋まりました。</p>
              </Card>
              <Card title="お客様に何を送りますか" note="LINEと結びついているため、時間を選び直して登録すると案内が届きます。">
                <NoticeRow title="予約を受け付けたことを、いますぐLINEに送る" detail="日時・メニュー・担当を書いた案内が届きます" />
                <NoticeRow title="前日と開始2時間前に思い出してもらう" detail="リマインダから自動で送ります" />
              </Card>
            </div>
            <aside data-design="Right" className="space-y-4">
              <Card title="空いている時間" note={`${selectedStaff.display_name}の ${date || '選択日'} で、続けて取れるところです。`}>
                <div className="space-y-2">
                  {slots.filter((slot) => slot.start !== time).slice(0, 3).map((slot) => <div key={slot.start} className="border-hairline flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"><span className="text-sm font-semibold">{slot.start} 〜 {slot.end}</span><Button onClick={() => { setTime(slot.start); setStep('input'); setError('') }}>この時間に変える</Button></div>)}
                </div>
              </Card>
              <Card title="ほかの担当なら入れられます"><p className="text-ink-faint text-xs">担当別の空きは、入力へ戻って確認してください。</p></Card>
              <WarningCard title="気をつけること" lines={['重なったまま予約を入れることはできません', '入力したお客様・メニュー・担当・要望は残っています']} />
              <RelatedLinks includeConversion={false} />
            </aside>
          </div>
        </>
      )}

      {step === 'done' && result && friend && menu && selectedStaff && (
        <>
          <section className="bg-action-soft text-action rounded-card px-4 py-3 text-xs font-semibold">
            {timeRangeLabel(date, time, occupiedMinutes)} の枠を押さえました。お知らせはリマインダから自動で届きます。
          </section>
          <div data-design="Body" className="grid gap-4 xl:grid-cols-4">
            <div data-design="Left" className="min-w-0 space-y-4 xl:col-span-3">
              <Card title="入れた予約">
                <Summary label="お客様" value={friend.displayName} />
                <Summary label="日時" value={timeRangeLabel(date, time, occupiedMinutes)} />
                <Summary label="メニュー" value={`${menu.name}（${occupiedMinutes}分）`} />
                <Summary label="担当" value={selectedStaff.display_name} />
                <Summary label="受けかた" value="電話（代理で入力）" />
                <Summary label="予約ID" value={result.booking_id} />
                <Summary label="Googleカレンダー" value={result.calendar_sync === 'synced' ? '反映済み' : result.calendar_sync === 'failed' ? '反映に失敗' : result.calendar_sync === 'pending' ? '確認中' : '未設定'} />
              </Card>
              <Card title="このあと自動で動くもの">
                <NoticeRow title="いま LINE に案内を送りました" detail="開かれたかどうかは台帳から見られます" />
                {reminderScheduleLabels(date, time).map((label) => <NoticeRow key={label} title={`${label} にお知らせ`} detail="リマインダから自動で送ります" />)}
                <Summary label="リマインダの時刻" value={reminderScheduleLabels(date, time).join(' ／ ') || '今後の送信予定はありません'} />
                <Summary label="予約台帳" value="1件追加（電話で受けた予約も同じ台帳へ記録します）" />
              </Card>
              <Card title="次にすること">
                <div className="flex flex-wrap gap-2"><Button variant="primary" href="/booking/bookings">今日の台帳を見る</Button><Button href={`/booking/bookings/detail?id=${encodeURIComponent(result.booking_id)}`}>この予約の詳細を見る</Button><Button onClick={() => { setStep('input'); setResult(null); setTime(''); setIdempotencyKey('') }}>続けてもう1件入れる</Button></div>
              </Card>
            </div>
            <aside data-design="Right" className="space-y-4">
              <Card title="お客様に届いたもの" note="送った案内をそのまま残しています。"><LinePreview friendName={friend.displayName} menuName={menu.name} staffName={selectedStaff.display_name} date={date} time={time} sent /></Card>
              <RelatedLinks includeConversion />
            </aside>
          </div>
        </>
      )}

      {(step === 'input' || step === 'confirm' || step === 'conflict') && (
        <StickyBar
          status={step === 'input' ? 'まだ入っていません。保存すると台帳に並び、お客様にもお知らせします。' : step === 'confirm' ? 'まだ入っていません。「予約を入れる」を押すと台帳に並びます。' : '直すところがあります。時間を選び直すまで台帳には入りません。'}
          actions={(
            <>
              {(step === 'confirm' || step === 'conflict') && <Button onClick={() => { setStep('input'); setError('') }}>入力に戻る</Button>}
              {step === 'input' ? (
                <Button variant="primary" disabled={loading} data-qa-open="GFDqW" onClick={() => void review()}>
                  {loading ? '空きを再確認しています' : '予約内容を確認する'}
                </Button>
              ) : step === 'confirm' ? (
                <Button variant="primary" disabled={loading} data-qa-open="GfceK" onClick={() => void createBooking()}>
                  {loading ? '登録中です' : 'この内容で予約を入れる'}
                </Button>
              ) : <Button variant="primary" disabled>この内容で予約を入れる</Button>}
            </>
          )}
        />
      )}
    </div>
  )
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="border-hairline bg-canvas rounded-card border p-5"><h2 className="text-ink text-sm font-semibold">{title}</h2>{note ? <p className="text-ink-faint mt-1 text-xs">{note}</p> : null}<div className="mt-4">{children}</div></section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-ink-secondary block text-xs"><span className="mb-1.5 block font-medium">{label}</span>{children}</label>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="border-hairline grid gap-3 border-b py-2 text-sm last:border-b-0" style={{ gridTemplateColumns: '140px minmax(0, 1fr)' }}><span className="text-ink-faint">{label}</span><span className="text-ink">{value}</span></div>
}

function NoticeRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-3 flex gap-3 last:mb-0">
      <span className="text-success font-bold">✓</span>
      <div><p className="text-ink text-sm font-medium">{title}</p><p className="text-ink-faint mt-0.5 text-xs">{detail}</p></div>
    </div>
  )
}

function LinePreview({ friendName, menuName, staffName, date, time, sent }: {
  friendName: string
  menuName: string
  staffName: string
  date: string
  time: string
  sent: boolean
}) {
  return (
    <div className="bg-action rounded-card p-4">
      <p className="text-on-action text-center text-xs font-semibold">LINEプレビュー</p>
      <p className="bg-ink/25 text-on-action mx-auto mt-3 w-fit rounded-pill px-3 py-1 text-xs">{sent ? '送信済み・配信状況は台帳で確認できます' : '「予約を入れる」を押すと、すぐに届きます'}</p>
      <div className="bg-canvas rounded-card mt-3 p-4 text-sm leading-6">
        <p>{friendName}さま</p>
        <p>{dateLabel(date, time)} から、{menuName}をお受けしました。</p>
        <p>担当は{staffName}です。ご来店をお待ちしています。</p>
        <Button href="/booking/bookings" variant="primary" className="mt-3 w-full">予約内容を確認する</Button>
      </div>
    </div>
  )
}

function WarningCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="border-warning bg-warning-bg rounded-card border p-4">
      <h2 className="text-warning text-sm font-semibold">{title}</h2>
      <ul className="text-warning mt-3 space-y-2 text-xs">{lines.map((line) => <li key={line}>・{line}</li>)}</ul>
    </section>
  )
}

function RelatedLinks({ includeConversion }: { includeConversion: boolean }) {
  return (
    <Card title="つながる先">
      <div className="text-ink-secondary space-y-2 text-xs">
        <p><Link href="/booking/bookings" className="text-accent font-semibold">→ 予約管理</Link>　今日の台帳</p>
        <p><Link href="/booking/menus" className="text-accent font-semibold">→ 予約設定</Link>　メニューと空き枠</p>
        <p><Link href="/reminders" className="text-accent font-semibold">→ リマインダ</Link>　前日・開始前のお知らせ</p>
        <p><Link href="/friends" className="text-accent font-semibold">→ 友だち</Link>　顧客カルテに残ります</p>
        {includeConversion ? <p><Link href="/conversions" className="text-accent font-semibold">→ コンバージョン</Link>　予約の成果を確認</p> : null}
      </div>
    </Card>
  )
}
