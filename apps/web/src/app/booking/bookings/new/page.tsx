'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
      {error && (
        <div className="border-danger bg-danger-bg text-danger rounded-card border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {step === 'input' && (
        <div className="grid gap-4 xl:flex">
          <div className="min-w-0 flex-1 space-y-4">
            <Card title="だれの予約ですか">
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
                    placeholder="名前を2文字以上入力"
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

            <Card title="いつ・何を予約しますか">
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
            </Card>

            <Card title="お客様からの要望">
              <textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={4} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" placeholder="予約時に確認した内容を入力" />
            </Card>
          </div>

          <div className="w-full xl:flex-none" style={{ maxWidth: 390 }}>
            <Card title="何を送りますか">
              <p className="text-ink text-sm font-medium">予約確認LINE</p>
              <p className="text-ink-faint mt-1 text-xs">予約登録後、選択した友だちへ確認を送ります。</p>
              <p className="text-ink mt-4 text-sm font-medium">リマインダ</p>
              <p className="text-ink-faint mt-1 text-xs">実際の送信時刻は予約設定から計算します。固定の時刻は表示しません。</p>
            </Card>
          </div>
        </div>
      )}

      {step === 'confirm' && friend && menu && selectedStaff && (
        <div className="grid gap-4 xl:flex">
          <div className="min-w-0 flex-1 space-y-4">
            <Card title="だれの予約か"><Summary label="お客様" value={friend.displayName} /></Card>
            <Card title="いつ・何を予約するか">
              <Summary label="日時" value={dateLabel(date, time)} />
              <Summary label="メニュー" value={menu.name} />
              <Summary label="担当" value={selectedStaff.display_name} />
              <Summary label="料金" value={yen(selectedStaff.price)} />
            </Card>
            <Card title="何を送るか"><Summary label="予約確認LINE" value="登録後に送信" /><Summary label="リマインダ" value="予約設定から計算" /></Card>
            <p
              data-booking-slot-check="available"
              className="border-success bg-success-bg text-success rounded-card border px-4 py-3 text-sm"
            >
              この日時は、確認画面を開く直前に空きを再確認しました。
            </p>
          </div>
          <div className="w-full xl:flex-none" style={{ maxWidth: 390 }}>
            <Card title="お客様に届く内容">
              <div className="bg-success-bg rounded-card p-4 text-sm leading-6">
                <p>予約が確定しました。</p>
                <p>メニュー: {menu.name}</p>
                <p>担当: {selectedStaff.display_name}</p>
                <p>日時: {dateLabel(date, time)}</p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {step === 'conflict' && (
        <Card title="この時間には予約を入れられません">
          <p className="text-ink-secondary text-sm">最新の空き時間を読み直して、別の時間を選んでください。入力したお客様・メニュー・担当者・要望は残っています。</p>
          <Button variant="primary" onClick={() => void recoverConflict()} className="mt-4">空いている時間を選び直す</Button>
        </Card>
      )}

      {step === 'done' && result && (
        <div className="mx-auto max-w-3xl space-y-4">
          <Card title="予約を登録しました">
            <Summary label="予約ID" value={result.booking_id} />
            <Summary label="状態" value="確定" />
            <Summary label="Googleカレンダー" value={result.calendar_sync === 'synced' ? '反映済み' : result.calendar_sync === 'failed' ? '反映に失敗' : result.calendar_sync === 'pending' ? '確認中' : '未設定'} />
          </Card>
          <Card title="このあと自動で動くもの">
            <Summary label="予約確認LINE" value="送信処理を開始" />
            <Summary
              label="リマインダの時刻"
              value={reminderScheduleLabels(date, time).join(' ／ ') || '今後の送信予定はありません'}
            />
            <Summary label="予約台帳" value="1件追加（電話で受けた予約も同じ台帳へ記録します）" />
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" href={`/booking/bookings/detail?id=${encodeURIComponent(result.booking_id)}`}>予約の詳細を見る</Button>
            <Button href="/booking/bookings">今日の予約台帳へ戻る</Button>
          </div>
        </div>
      )}

      {(step === 'input' || step === 'confirm') && (
        <StickyBar
          actions={(
            <>
              {step === 'confirm' && <Button onClick={() => setStep('input')}>予約入力に戻る</Button>}
              {step === 'input' ? (
                <Button variant="primary" disabled={loading} data-qa-open="GFDqW" onClick={() => void review()}>
                  {loading ? '空きを再確認しています' : '予約内容を確認する'}
                </Button>
              ) : (
                <Button variant="primary" disabled={loading} data-qa-open="GfceK" onClick={() => void createBooking()}>
                  {loading ? '登録中です' : 'この内容で予約を入れる'}
                </Button>
              )}
            </>
          )}
        />
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-hairline bg-canvas rounded-card border p-5"><h2 className="text-ink mb-4 text-sm font-semibold">{title}</h2>{children}</section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-ink-secondary block text-xs"><span className="mb-1.5 block font-medium">{label}</span>{children}</label>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="border-hairline grid gap-3 border-b py-2 text-sm last:border-b-0" style={{ gridTemplateColumns: '140px minmax(0, 1fr)' }}><span className="text-ink-faint">{label}</span><span className="text-ink">{value}</span></div>
}
