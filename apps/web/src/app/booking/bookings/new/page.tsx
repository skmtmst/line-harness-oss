'use client'

import DateField from '@/components/shared/date-field'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import LinePreview from '@/components/shared/line-preview'
import {
  api,
  ApiError,
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingConflictAlternatives,
  type BookingCustomerContext,
  type BookingMenu,
  type BookingMenuStaff,
  type BookingCustomerSummary,
  type FriendListItem,
  type ProxyBookingResult,
} from '@/lib/api'
import { canOperateBookings } from '../../lib/booking-permissions'

type Step = 'input' | 'confirm' | 'done' | 'conflict'

/**
 * N-400: 再読み込みで入力が消えないよう、アカウント別に sessionStorage へ
 * 置く下書きの形。友だちは表示に使う最小限（id と表示名）だけを持つ。
 * 完了・破棄で消す。別タブを汚さないよう sessionStorage（タブ単位）を使う。
 */
interface ProxyBookingDraft {
  phoneCustomer: boolean
  customerName: string
  customerPhone: string
  petName: string
  friend: { id: string; displayName: string } | null
  customer: BookingCustomerSummary | null
  menuId: string
  staffId: string
  date: string
  time: string
  customerNote: string
  notification: {
    send_line_confirmation: boolean
    day_before: boolean
    hours_before: boolean
  }
}

const DRAFT_KEY_PREFIX = 'booking:new-draft:'

const NODE_BY_STEP: Record<Step, string> = {
  input: 'cpdDi',
  confirm: 'GFDqW',
  done: 'GfceK',
  conflict: 'Lg8ff',
}

// 候補の instant 契約。サーバは各枠へ店舗 timezone と offset 付き instant を
// 付ける。表示も送信も、壁時刻を組み立て直さずこの instant だけを使う。
//
// 以前は startUtc が無いときに、日付と時刻を JST 固定のずれで読み直して
// いた。これは店舗が JST のときだけ正しい。America/New_York の 10:00 を
// 9 時間進んだ場所として読むと前日 21:00 の instant になり、休業日・
// 営業時間外・Google の予定を迂回した予約を送ってしまう。その退路は
// 残さず、読めない候補は使わない（fail-closed）。
function slotInstant(slot?: { startUtc?: string | null } | null): string | null {
  const raw = slot?.startUtc
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function dateLabel(startUtc: string, timeZone = 'Asia/Tokyo'): string {
  if (!startUtc) return '—'
  return new Date(startUtc).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', timeZone,
  })
}

function timeRangeLabel(
  startUtc: string, minutes: number, timeZone = 'Asia/Tokyo', endUtc?: string | null,
): string {
  if (!startUtc) return '—'
  const startsAt = new Date(startUtc)
  const endsAt = endUtc ? new Date(endUtc) : new Date(startsAt.getTime() + minutes * 60_000)
  return `${dateLabel(startUtc, timeZone)} 〜 ${endsAt.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone,
  })}`
}

// サーバ側 packages/db/src/booking-customers.ts の normalizeBookingCustomerPhone と
// 同じ約束を先に確かめる。出す直前で落とすと入れ直しになる。
function phoneDigitsError(phone: string): string | null {
  const compact = phone.normalize('NFKC').trim().replace(/[\s()（）\-‐‑–—ー]/g, '')
  if (!/^\+?\d{7,15}$/.test(compact)) return '電話番号は数字7〜15桁で入力してください'
  return null
}

function scheduleLabel(value: string, timeZone = 'Asia/Tokyo'): string {
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
    timeZone,
  })
}

function operationStatusLabel(status: string): string {
  return ({
    queued: '処理中', succeeded: '完了', skipped: '設定なし', retry_wait: '再試行中',
    permanent_failed: '失敗', cancelled: '取消済み',
  } as Record<string, string>)[status] ?? status
}

export default function NewProxyBookingPage() {
  const { selectedAccountId } = useAccount()
  const [step, setStep] = useState<Step>('input')
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [staff, setStaff] = useState<BookingMenuStaff[]>([])
  const [slots, setSlots] = useState<BookingAvailabilitySlot[]>([])
  // 空き枠を実際に取り終えたか。URL・下書きの時刻指定は、到着前の空配列で
  // 捨てないようこの旗を見てから判断する。
  const [slotsReady, setSlotsReady] = useState(false)
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [friendQuery, setFriendQuery] = useState('')
  const [friend, setFriend] = useState<FriendListItem | null>(null)
  const [customer, setCustomer] = useState<BookingCustomerSummary | null>(null)
  const [phoneCustomer, setPhoneCustomer] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [petName, setPetName] = useState('')
  const [menuId, setMenuId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [result, setResult] = useState<ProxyBookingResult | null>(null)
  const [customerContext, setCustomerContext] = useState<BookingCustomerContext | null>(null)
  const [conflictAlternatives, setConflictAlternatives] = useState<BookingConflictAlternatives | null>(null)
  // 確認へ進む直前に読み直した枠。ここから先の表示・送信はこれだけを使う。
  const [confirmedSlot, setConfirmedSlot] = useState<BookingAvailabilitySlot | null>(null)
  const [reminderPreview, setReminderPreview] = useState<Array<{ kind: 'day_before' | 'hours_before'; scheduledAt: string }>>([])
  // N-391: 予約ごとに選べる通知の可否。LINEと結びついた予約だけ意味を持つ。
  const [notification, setNotification] = useState({
    send_line_confirmation: true,
    day_before: true,
    hours_before: true,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const slotRequest = useRef(0)
  // N-401: 閲覧のみの人には予約を入れる操作を出さない。読み込めるまでは隠す。
  const [canOperate, setCanOperate] = useState(false)
  // 権限を読み終わるまで案内バナーも出さない（操作できる人へ一瞬見せない）。
  const [staffResolved, setStaffResolved] = useState(false)
  useEffect(() => {
    let active = true
    void api.staff.me()
      .then((response) => { if (active) setCanOperate(response.success && canOperateBookings(response.data)) })
      .catch(() => { if (active) setCanOperate(false) })
      .finally(() => { if (active) setStaffResolved(true) })
    return () => { active = false }
  }, [])
  // N-399/N-400: URL 指定・下書きの「担当者・時刻」は、担当一覧や空き枠が
  // 届いてから存在を確かめて選ぶ。到着を待つ分だけこの ref に預ける。
  const pendingSelect = useRef<{ staffId?: string; staffName?: string; date?: string; time?: string }>({})
  const restoredAccount = useRef<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)

  const selectionKey = [selectedAccountId ?? '', friend?.id ?? customer?.id ?? '', menuId, staffId, date, time].join('\u001f')
  const latestSelectionKey = useRef(selectionKey)
  latestSelectionKey.current = selectionKey

  const menu = menus.find((item) => item.id === menuId) ?? null
  const selectedStaff = staff.find((item) => item.id === staffId) ?? null
  const customerLabel = friend?.displayName ?? customer?.display_name ?? (customerName.trim() || 'お客様')
  const selectedSlot = slots.find((item) => item.date === date && item.start === time) ?? null
  // 確認済みの枠があればそれを優先する。入力画面で見えた古い instant を
  // 確認・完了・競合の画面へ持ち越さない。
  const activeSlot = confirmedSlot ?? selectedSlot
  const slotTimeZone = activeSlot?.timeZone ?? 'Asia/Tokyo'
  const slotStartIso = slotInstant(activeSlot) ?? ''
  const slotEndIso = activeSlot?.endUtc ?? null
  const occupiedMinutes = activeSlot?.startUtc && activeSlot?.endUtc
    ? (new Date(activeSlot.endUtc).getTime() - new Date(activeSlot.startUtc).getTime()) / 60_000
    : selectedStaff?.duration_minutes ?? 0
  const confirmationOperation = result?.operations.find((item) => item.kind === 'confirmation_line') ?? null
  const automaticOperations = result?.operations.filter((item) => ['conversion', 'mileage', 'automation'].includes(item.kind)) ?? []
  // N-390: LINEと結びついているか。友だち選択か、台帳上で連携済みの顧客か。
  // 新しく作る電話客（customer 未保存）は必ず未連携。
  const isLineLinked = friend != null || customer?.is_line_linked === true

  function resetForm() {
    setStep('input')
    setFriend(null)
    setCustomer(null)
    setPhoneCustomer(false)
    setCustomerName('')
    setCustomerPhone('')
    setPetName('')
    setFriendQuery('')
    setMenuId('')
    setStaffId('')
    setDate('')
    setTime('')
    setResult(null)
    setCustomerContext(null)
    setConflictAlternatives(null)
    setReminderPreview([])
    setNotification({ send_line_confirmation: true, day_before: true, hours_before: true })
    setIdempotencyKey('')
    setLoading(false)
    setError('')
    pendingSelect.current = {}
  }

  useEffect(() => {
    resetForm()
    setDraftRestored(false)
    // アカウントが確定した最初の1回だけ下書きとURL指定を読む。それ以降の
    // 入力途中に再読み込みしても同じ下書きが戻る。別アカウントに切り替えた
    // ときはそのアカウントの下書きを読む（前のアカウントの入力は持ち越さない）。
    if (!selectedAccountId || restoredAccount.current === selectedAccountId) return
    restoredAccount.current = selectedAccountId
    // N-400: 書きかけの下書きを戻す。壊れた JSON は捨てて初期状態で始める。
    try {
      const raw = window.sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${selectedAccountId}`)
      if (raw) {
        const draft = JSON.parse(raw) as Partial<ProxyBookingDraft>
        if (draft.friend?.id) setFriend({ id: draft.friend.id, displayName: String(draft.friend.displayName ?? '') } as FriendListItem)
        if (draft.customer?.id) setCustomer(draft.customer as BookingCustomerSummary)
        setPhoneCustomer(draft.phoneCustomer === true)
        setCustomerName(typeof draft.customerName === 'string' ? draft.customerName : '')
        setCustomerPhone(typeof draft.customerPhone === 'string' ? draft.customerPhone : '')
        setPetName(typeof draft.petName === 'string' ? draft.petName : '')
        setMenuId(typeof draft.menuId === 'string' ? draft.menuId : '')
        setDate(typeof draft.date === 'string' ? draft.date : '')
        setCustomerNote(typeof draft.customerNote === 'string' ? draft.customerNote : '')
        if (draft.notification && typeof draft.notification === 'object') {
          setNotification({
            send_line_confirmation: draft.notification.send_line_confirmation !== false,
            day_before: draft.notification.day_before !== false,
            hours_before: draft.notification.hours_before !== false,
          })
        }
        // 担当・時刻は一覧の到着後に存在を確かめてから選ぶ。
        pendingSelect.current = {
          staffId: typeof draft.staffId === 'string' && draft.staffId ? draft.staffId : undefined,
          date: typeof draft.date === 'string' ? draft.date : undefined,
          time: typeof draft.time === 'string' ? draft.time : undefined,
        }
        setDraftRestored(true)
      }
    } catch {
      // 壊れた下書きは捨てる
    }
    // N-399: カレンダーの空きセルから来たURL指定は下書きより優先する。
    const params = new URLSearchParams(window.location.search)
    const paramDate = params.get('date')
    const paramTime = params.get('time')
    const paramStaff = params.get('staff')
    const paramMenu = params.get('menu') ?? params.get('menu_id')
    if (paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate)) {
      setDate(paramDate)
      pendingSelect.current.date = paramDate
    }
    if (paramMenu) setMenuId(paramMenu)
    if (paramStaff) pendingSelect.current.staffName = paramStaff
    if (paramTime && /^\d{2}:\d{2}$/.test(paramTime)) pendingSelect.current.time = paramTime
  }, [selectedAccountId])

  // N-399/N-400: メニューを選ぶと担当者一覧が届く。下書き・URLの担当が
  // 一覧にあれば選び直す。URLの担当は名前で来るので display_name で照合する。
  useEffect(() => {
    const pending = pendingSelect.current
    if (pending.staffId) {
      if (staff.some((item) => item.id === pending.staffId)) {
        setStaffId(pending.staffId)
        delete pending.staffId
      }
    } else if (pending.staffName) {
      const match = staff.find((item) => item.display_name === pending.staffName)
      if (match) {
        setStaffId(match.id)
        delete pending.staffName
      } else if (staff.length > 0) {
        // 一覧が届いたのに居ない担当名（改名・非担当）は捨てる。
        // 空の一覧は「まだ届いていない」だけなので残す。
        delete pending.staffName
      }
    }
  }, [staff])

  // N-399/N-400: 空き枠が届いたら、指定の開始時刻が実際に取れるときだけ選ぶ。
  // 取れない時刻（埋まった・営業時間外）は黙って捨て、選び直しに委ねる。
  // slotsReady が立つ前の空配列は「まだ読み込み中」なので時刻指定を捨てない。
  useEffect(() => {
    const pending = pendingSelect.current
    if (!pending.time || pending.date !== date || !slotsReady) return
    if (slots.some((slot) => slot.date === date && slot.start === pending.time)) {
      setTime(pending.time)
    }
    delete pending.time
  }, [slots, slotsReady, date])

  // N-400: 入力中の内容をアカウント別に sessionStorage へ書く。
  // 完了・破棄で消す。書き込みに失敗しても入力自体は止めない。
  useEffect(() => {
    if (!selectedAccountId || step === 'done') return
    const draft: ProxyBookingDraft = {
      phoneCustomer,
      customerName,
      customerPhone,
      petName,
      friend: friend ? { id: friend.id, displayName: friend.displayName } : null,
      customer,
      menuId,
      staffId,
      date,
      time,
      customerNote,
      notification,
    }
    try {
      window.sessionStorage.setItem(`${DRAFT_KEY_PREFIX}${selectedAccountId}`, JSON.stringify(draft))
    } catch {
      // 容量超過などは無視する
    }
  }, [selectedAccountId, step, phoneCustomer, customerName, customerPhone, petName, friend, customer, menuId, staffId, date, time, customerNote, notification])

  function discardDraft() {
    if (selectedAccountId) {
      try { window.sessionStorage.removeItem(`${DRAFT_KEY_PREFIX}${selectedAccountId}`) } catch { /* noop */ }
    }
    setDraftRestored(false)
    resetForm()
  }

  // 選択（アカウント・客・メニュー・担当・日時）が変わったら、確認済みの
  // 枠を捨てる。前の選択の instant がそのまま次の確定に乗ると、画面の
  // 表示と送る時刻がずれる。
  useEffect(() => {
    setConfirmedSlot(null)
  }, [selectionKey])

  useEffect(() => {
    // どちらの客かを先に束ねる(点検#516軽5)。`customer!` の断言では、将来の分岐変更でnullが紛れ込む。
    const target = friend ? { friendId: friend.id } : customer ? { bookingCustomerId: customer.id } : null
    if (!selectedAccountId || !target) {
      setCustomerContext(null)
      return
    }
    let active = true
    void bookingApi.getCustomerContext(selectedAccountId, target)
      .then((response) => { if (active) setCustomerContext(response.customer) })
      .catch(() => { if (active) setCustomerContext(null) })
    return () => { active = false }
  }, [selectedAccountId, friend, customer])

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
      setSlotsReady(false)
      return
    }
    setLoading(true)
    setError('')
    // 取り直し中は前回の枠で時刻指定を判定しないよう一度落とす。
    setSlotsReady(false)
    try {
      const response = await bookingApi.getAvailability(selectedAccountId, {
        menuId, staffId, from: date, to: date,
      })
      if (requestId === slotRequest.current) {
        setSlots(response.by_staff.find((item) => item.staff_id === staffId)?.slots ?? [])
        setSlotsReady(true)
      }
    } catch {
      if (requestId === slotRequest.current) {
        setSlots([])
        // 読み込み自体は終わったので「指定時刻は取れない」として捨てる側に回す。
        setSlotsReady(true)
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
    if (!friend && !customer && !phoneCustomer) return '予約するお客様を選択してください'
    if (phoneCustomer && !customer && (!customerName.trim() || !customerPhone.trim())) return '電話客の名前と電話番号を入力してください'
    if (phoneCustomer && !customer && customerPhone.trim()) {
      const phoneError = phoneDigitsError(customerPhone)
      if (phoneError) return phoneError
    }
    if (!menu) return '予約メニューを選択してください'
    if (!selectedStaff) return '担当者を選択してください'
    if (!date || !time) return '空いている日時を選択してください'
    return null
  }, [selectedAccountId, friend, customer, phoneCustomer, customerName, customerPhone, menu, selectedStaff, date, time])

  async function ensureCustomer(): Promise<BookingCustomerSummary | null> {
    if (!phoneCustomer) return customer
    if (customer) return customer
    if (!selectedAccountId) return null
    const response = await bookingApi.createCustomer(selectedAccountId, {
      display_name: customerName.trim(), phone: customerPhone.trim(), pet_name: petName.trim() || undefined,
    })
    setCustomer(response.customer)
    return response.customer
  }

  async function review() {
    if (validation) {
      setError(validation)
      return
    }
    if (!selectedAccountId || !menu || !selectedStaff || !date || !time) return
    let selectedCustomer = customer
    if (phoneCustomer) {
      try { selectedCustomer = await ensureCustomer() } catch { setError('電話客の情報を保存できませんでした。名前と電話番号を確認してください。'); return }
    }
    if (!friend && !selectedCustomer) { setError('予約するお客様を選択してください'); return }
    const requestKey = [selectedAccountId, friend?.id ?? selectedCustomer?.id ?? '', menuId, staffId, date, time].join('\u001f')
    latestSelectionKey.current = requestKey
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
      // 読み直した結果の枠そのものを持つ。「空いていた」だけを見て古い
      // instant を送ると、店舗タイムゾーンや夏時間の切替をまたいだとき
      // 別の瞬間の予約になる。
      const available = latest.by_staff
        .find((item) => item.staff_id === selectedStaff.id)
        ?.slots.find((slot) => slot.date === date && slot.start === time) ?? null
      if (!available) {
        const staleStartIso = slotInstant(selectedSlot)
        const alternatives = staleStartIso
          ? await bookingApi.getAlternatives(selectedAccountId, {
            menuId: menu.id,
            staffId: selectedStaff.id,
            startsAt: staleStartIso,
          })
          : null
        if (latestSelectionKey.current !== requestKey) return
        setConfirmedSlot(null)
        setConflictAlternatives(alternatives)
        setStep('conflict')
        setError('選んだ時間は、ほかの予約で埋まりました')
        return
      }
      // 開始 instant を受け取れない枠は確定させない（fail-closed）。
      const freshStartIso = slotInstant(available)
      if (!freshStartIso) {
        setConfirmedSlot(null)
        setError('この時間の開始時刻を受け取れませんでした。時間を選び直してください。')
        return
      }
      const preview = await bookingApi.previewReminders(selectedAccountId, freshStartIso)
      if (latestSelectionKey.current !== requestKey) return
      setConfirmedSlot(available)
      setReminderPreview(preview.reminders)
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
    const customerPart = friend ? { friend_id: friend.id } : customer ? { booking_customer_id: customer.id } : null
    if (!selectedAccountId || !customerPart || !menu || !selectedStaff || !date || !time) return
    // 空キーで送ると400になる(点検#516軽5)。無ければここで作る。
    const key = idempotencyKey || crypto.randomUUID()
    if (!idempotencyKey) setIdempotencyKey(key)
    // 送るのは確認直前に読み直した枠の instant だけ。無ければ送らない。
    const startsAtIso = slotInstant(confirmedSlot)
    if (!startsAtIso) {
      setError('確認した開始時刻が見つかりません。日時を選び直してください。')
      return
    }
    const requestKey = selectionKey
    setLoading(true)
    setError('')
    try {
      const created = await bookingApi.createProxyBooking(selectedAccountId, {
        ...customerPart,
        menu_id: menu.id,
        staff_id: selectedStaff.id,
        starts_at: startsAtIso,
        customer_note: customerNote.trim() || undefined,
        // N-391: 選んだ通知可否を予約へ固定する。未連携は明示的に全OFFで
        // 送る（指定を残すと「実は送れない予約」が分からなくなる）。
        notification_policy: isLineLinked
          ? notification
          : { send_line_confirmation: false, day_before: false, hours_before: false },
      }, key)
      if (latestSelectionKey.current !== requestKey) return
      setResult(created)
      setCustomerContext(created.customer_context)
      // N-400: 入った予約の下書きは消す。残すと次回「書きかけ」として
      // 同じ予約が戻り、二重に入れる事故になる。
      try { window.sessionStorage.removeItem(`${DRAFT_KEY_PREFIX}${selectedAccountId}`) } catch { /* noop */ }
      setDraftRestored(false)
      setStep('done')
    } catch (cause) {
      if (latestSelectionKey.current !== requestKey) return
      if (
        cause instanceof ApiError
        && (cause.code === 'slot_conflict' || cause.code === 'slot_not_available')
      ) {
        setConflictAlternatives(cause.data as BookingConflictAlternatives | null)
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
    setConfirmedSlot(null)
    setConflictAlternatives(null)
    await loadSlots()
  }

  return (
    <div data-design-node={NODE_BY_STEP[step]} className="space-y-4 pb-24">
      <nav data-design="Crumb" aria-label="現在位置" className="text-ink-faint text-xs">
        <Link href="/booking/bookings" className="text-action underline">予約</Link>
        <span className="mx-2">›</span>
        <Link href="/booking/bookings" className="text-action underline">予約管理</Link>
        <span className="mx-2">›</span>
        <span>{step === 'confirm' ? '内容を確認' : step === 'done' ? '登録が終わりました' : step === 'conflict' ? '入れられません' : '電話の予約を入れる'}</span>
      </nav>

      {error && step !== 'conflict' && (
        <div className="border-danger bg-danger-bg text-danger rounded-card border px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {staffResolved && !canOperate ? (
        <div className="border-warning bg-warning-bg text-warning rounded-card border px-4 py-3 text-sm">
          予約を入れられるのは、予約の操作権限を持つ人だけです。閲覧のみの権限では操作ボタンは出ません。
        </div>
      ) : null}

      {draftRestored && step === 'input' ? (
        <div className="border-hairline bg-canvas-sunken text-ink-secondary rounded-card flex flex-wrap items-center justify-between gap-2 border px-4 py-2 text-xs">
          <span>書きかけの入力を戻しました。</span>
          <button type="button" onClick={discardDraft} className="text-action font-semibold">
            破棄して最初から入れ直す
          </button>
        </div>
      ) : null}

      {step === 'input' && (
        <div data-design="Body" className="grid gap-4 xl:flex">
          <div className="min-w-0 flex-1 space-y-4">
            <Card title="だれの予約ですか" note="LINEの友だちなら、名前で探して結びつけてください。LINE未連携の電話客も登録できます。">
              <div className="mb-3 flex gap-2">
                <Button className="text-xs" variant={!phoneCustomer ? 'primary' : 'secondary'} onClick={() => { setPhoneCustomer(false); setCustomer(null) }}>LINEの友だち</Button>
                <Button className="text-xs" variant={phoneCustomer ? 'primary' : 'secondary'} onClick={() => { setPhoneCustomer(true); setFriend(null) }}>LINE未連携の電話客</Button>
              </div>
              {phoneCustomer ? (
                <div className="space-y-2">
                  <input aria-label="電話客の名前" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="お客様の名前" className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                  <input aria-label="電話客の電話番号" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="電話番号" className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                  <input aria-label="電話客のペット名" value={petName} onChange={(event) => setPetName(event.target.value)} placeholder="ペットの名前（任意）" className="border-hairline rounded-control w-full border px-3 py-2 text-sm" />
                  {customer ? <p className="text-success text-xs">顧客台帳に保存済み（電話末尾 {customer.phone_last4}）</p> : <p className="text-ink-faint text-xs">確認へ進むと顧客台帳へ保存します。</p>}
                </div>
              ) : friend ? (
                <div className="border-hairline bg-canvas-sunken flex items-center justify-between rounded-control border px-3 py-3">
                  <div>
                    <p className="text-ink text-sm font-medium">{friend.displayName}</p>
                    <p className="text-ink-faint mt-1 text-xs">LINE連携済み</p>
                  </div>
                  <button type="button" className="text-action text-sm" onClick={() => {
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
              {!phoneCustomer ? <p className="text-ink-faint mt-2 text-xs">別の友だちへ推測で結び付けず、選んだ相手だけに予約を記録します。</p> : null}
              <p className="text-ink-faint mt-2 text-xs">この方について入力した情報は、予約と顧客台帳に残ります。</p>
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
                  <DateField name="date" value={date} onChange={setDate} aria-label="日付" />
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
                  {dateLabel(slotStartIso, slotTimeZone)} は空いています。{selectedStaff.duration_minutes}分のメニューです。
                </div>
              ) : null}
            </Card>

            <Card title="お客様からの要望">
              <textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={4} className="border-hairline rounded-control w-full border px-3 py-2 text-sm" placeholder="予約時に確認した内容を入力" />
            </Card>

            <Card title="お客様に何を送りますか" note="LINEと結びついている方には、予約後の案内を送ります。送らない選択もできます。">
              {isLineLinked || (!phoneCustomer && !friend) ? (
                <div className="space-y-3">
                  <NotificationToggle
                    checked={notification.send_line_confirmation}
                    onChange={(checked) => setNotification((prev) => ({ ...prev, send_line_confirmation: checked }))}
                    title="予約を受け付けたことを、いますぐLINEに送る"
                    detail="日時・メニュー・担当を書いた案内が届きます。"
                  />
                  <NotificationToggle
                    checked={notification.day_before}
                    onChange={(checked) => setNotification((prev) => ({ ...prev, day_before: checked }))}
                    title="前日に思い出してもらう"
                    detail="予約設定から計算した時刻に送ります。"
                  />
                  <NotificationToggle
                    checked={notification.hours_before}
                    onChange={(checked) => setNotification((prev) => ({ ...prev, hours_before: checked }))}
                    title="当日のお知らせを送る"
                    detail="開始まで十分な時間がある場合だけ送ります。"
                  />
                </div>
              ) : (
                // N-390: LINEと結びつかない電話客には送信UIを見せない。
                <p className="text-ink-faint text-sm">
                  LINEと結びついていないため、自動のお知らせは届きません。
                  連絡は電話などで直接行ってください。
                </p>
              )}
            </Card>
          </div>

          <div data-design="Right" className="w-full space-y-4 xl:flex-none" style={{ maxWidth: 390 }}>
            <Card title={friend ? `${friend.displayName}さんにはこう届きます` : 'お客様にはこう届きます'}>
              {phoneCustomer && !isLineLinked ? (
                // N-390: 未連携の電話客へLINEプレビューを見せると
                // 「送れる」と誤解させる。実態をそのまま伝える。
                <p className="text-ink-faint rounded-card bg-canvas-sunken p-4 text-sm">
                  LINEと結びついていないため、LINEのお知らせは届きません。
                </p>
              ) : (
                <LinePreview>
                  <div className="rounded-card bg-canvas p-4 text-sm leading-6">
                    <p>{friend?.displayName ?? 'お客様'}さま</p>
                    <p className="font-semibold">ご予約を承りました。</p>
                    <p className="mt-3">{slotStartIso ? dateLabel(slotStartIso, slotTimeZone) : '日時を選ぶと表示されます'}</p>
                    <p>{menu?.name ?? 'メニューを選ぶと表示されます'} ／ 担当 {selectedStaff?.display_name ?? '—'}</p>
                  </div>
                </LinePreview>
              )}
            </Card>
            <Card title="この方について">
              {customerContext ? (
                <div className="space-y-2 text-xs">
                  <p><strong className={customerContext.isLineLinked ? 'text-success' : 'text-warning'}>{customerContext.isLineLinked ? 'LINEと結びついています' : 'LINE未連携の電話客です'}</strong></p>
                  <p><span className="text-ink-faint">電話</span>　{customerContext.phone ?? '登録なし'}</p>
                  <p><span className="text-ink-faint">ペット</span>　{customerContext.petName ?? '登録なし'}</p>
                  <p><span className="text-ink-faint">これまでの予約</span>　{customerContext.recentBookings.length}件</p>
                  <p><span className="text-ink-faint">前回の申し送り</span>　{customerContext.previousHandover ?? 'ありません'}</p>
                  {customerContext.tags.length > 0 ? <p><span className="text-ink-faint">タグ</span>　{customerContext.tags.map((tag) => tag.name).join('、')}</p> : null}
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

      {step === 'confirm' && (friend || customer) && menu && selectedStaff && (
        <div data-design="Body" className="grid gap-4 xl:grid-cols-4">
          <div data-design="Left" className="min-w-0 space-y-4 xl:col-span-3">
            <Card title="だれの予約か">
              <Summary label="お客様" value={customerLabel} />
              <Summary label="電話番号" value={friend ? '友だち情報欄で確認' : `末尾 ${customer?.phone_last4 ?? '—'}`} />
              <Summary label="ペットの名前" value={customer?.pet_name ?? '未入力'} />
              <Summary label="LINEとの結びつき" value={friend ? '結びついています' : '未連携の電話客'} />
            </Card>
            <Card title="いつ・何を">
              <Summary label="日時" value={timeRangeLabel(slotStartIso, occupiedMinutes, slotTimeZone, slotEndIso)} />
              <Summary label="メニュー" value={`${menu.name}（${occupiedMinutes}分）`} />
              <Summary label="担当" value={selectedStaff.display_name} />
              <Summary label="お客様からのご希望" value={customerNote.trim() || '記入なし'} />
            </Card>
            <Card title="お客様に送るもの">
              {!isLineLinked ? (
                <p className="text-ink-faint text-sm">
                  LINEと結びついていないため、自動のお知らせは届きません。
                </p>
              ) : (
                <>
                  {notification.send_line_confirmation ? (
                    <NoticeRow title="いますぐ LINE に送る" detail="日時・メニュー・担当を書いた案内が届きます" />
                  ) : null}
                  {reminderPreview
                    .filter((reminder) => notification[reminder.kind === 'day_before' ? 'day_before' : 'hours_before'])
                    .map((reminder) => (
                      <NoticeRow key={reminder.kind} title={`${scheduleLabel(reminder.scheduledAt, slotTimeZone)} に思い出してもらう`} detail="予約設定から計算した実際の送信予定です" />
                    ))}
                  {!notification.send_line_confirmation
                    && reminderPreview.filter((r) => notification[r.kind === 'day_before' ? 'day_before' : 'hours_before']).length === 0 ? (
                      <p className="text-ink-faint text-xs">
                        お知らせはすべて送らない設定です。登録だけを行います。
                      </p>
                    ) : null}
                </>
              )}
            </Card>
            <p data-booking-slot-check="available" className="border-success bg-success-bg text-success rounded-card border px-4 py-3 text-xs">
              この日時は、確認画面を開く直前に空きを再確認しました。
            </p>
          </div>
          <aside data-design="Right" className="space-y-4">
            <Card title={`${customerLabel}さんにはこう届きます`} note="送る前に、文面をそのまま確かめられます。">
              <BookingConfirmPreview friendName={customerLabel} menuName={menu.name} staffName={selectedStaff.display_name} timeZone={slotTimeZone} startUtc={slotStartIso} deliveryStatus={isLineLinked ? 'not_sent' : 'not_applicable'} />
            </Card>
            <WarningCard title="気をつけること" lines={['LINEと結びついていない方には、自動のお知らせは届きません', 'あとで時間を変えたときは、もう一度お知らせを送ってください']} />
            <RelatedLinks includeConversion={false} />
          </aside>
        </div>
      )}

      {step === 'conflict' && (friend || customer) && menu && selectedStaff && (
        <>
          <section className="border-danger bg-danger-bg text-danger flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{dateLabel(slotStartIso, slotTimeZone)} は {selectedStaff.display_name} がふさがっています</p>
              <p className="mt-1 text-xs">
                {conflictAlternatives
                  ? `${scheduleLabel(conflictAlternatives.conflict.from, slotTimeZone)}〜${scheduleLabel(conflictAlternatives.conflict.to, slotTimeZone)}に${conflictAlternatives.conflict.count}件重なっています（${conflictAlternatives.conflict.source === 'internal_booking' ? '店内予約' : conflictAlternatives.conflict.source === 'google_calendar' ? 'Google予定' : '受付時間外'}）。`
                  : ''}
                時間か担当を変えてください。
              </p>
            </div>
            <Button onClick={() => void recoverConflict()}>空いている時間を選び直す</Button>
          </section>
          <div data-design="Body" className="grid gap-4 xl:grid-cols-4">
            <div data-design="Left" className="min-w-0 space-y-4 xl:col-span-3">
              <Card title="だれの予約か"><Summary label="お客様" value={customerLabel} /><Summary label="LINEとの結びつき" value={friend ? '結びついています' : '未連携の電話客'} /></Card>
              <Card title="いつ・何を" note="時間が重なっています。右の空いている時間から選べます。">
                <Summary label="メニュー" value={`${menu.name}（${occupiedMinutes}分）`} />
                <Summary label="日付" value={dateLabel(slotStartIso, slotTimeZone).split(' ')[0]} />
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
                  {(conflictAlternatives?.nearbySlots ?? slots.filter((slot) => slot.date === date && slot.start !== time).slice(0, 3)).map((slot) => <div key={slot.start} className="border-hairline flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"><span className="text-sm font-semibold">{slot.start} 〜 {slot.end}</span><Button onClick={() => { setTime(slot.start); setStep('input'); setConflictAlternatives(null); setError('') }}>この時間に変える</Button></div>)}
                </div>
              </Card>
              <Card title="ほかの担当なら入れられます">
                {conflictAlternatives?.alternateStaff.length ? (
                  <div className="space-y-2">{conflictAlternatives.alternateStaff.map((candidate) => (
                    <div key={candidate.staffId} className="border-hairline flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                      <span className="text-sm font-semibold">{candidate.displayName}　{candidate.slot.start}〜{candidate.slot.end}</span>
                      <Button onClick={() => { setStaffId(candidate.staffId); setTime(candidate.slot.start); setStep('input'); setConflictAlternatives(null); setError('') }}>この担当に変える</Button>
                    </div>
                  ))}</div>
                ) : <p className="text-ink-faint text-xs">同じ時刻に空いている別担当はいません。</p>}
              </Card>
              <WarningCard title="気をつけること" lines={['重なったまま予約を入れることはできません', '入力したお客様・メニュー・担当・要望は残っています']} />
              <RelatedLinks includeConversion={false} />
            </aside>
          </div>
        </>
      )}

      {step === 'done' && result && (friend || customer) && menu && selectedStaff && (
        <>
          <section className="bg-action-soft text-action rounded-card px-4 py-3 text-xs font-semibold">
            {timeRangeLabel(slotStartIso, occupiedMinutes, slotTimeZone, slotEndIso)} の枠を押さえました。お知らせはリマインダから自動で届きます。
          </section>
          <div data-design="Body" className="grid gap-4 xl:grid-cols-4">
            <div data-design="Left" className="min-w-0 space-y-4 xl:col-span-3">
              <Card title="入れた予約">
                <Summary label="お客様" value={customerLabel} />
                <Summary label="日時" value={timeRangeLabel(slotStartIso, occupiedMinutes, slotTimeZone, slotEndIso)} />
                <Summary label="メニュー" value={`${menu.name}（${occupiedMinutes}分）`} />
                <Summary label="担当" value={selectedStaff.display_name} />
                <Summary label="受けかた" value="電話（代理で入力）" />
                <Summary label="予約ID" value={result.booking_id} />
                <Summary label="Googleカレンダー" value={result.calendar_sync === 'synced' ? '反映済み' : result.calendar_sync === 'failed' ? '反映に失敗' : result.calendar_sync === 'pending' ? '確認中' : '未設定'} />
              </Card>
              <Card title="このあと自動で動くもの">
                <NoticeRow
                  title={`予約確認LINE: ${confirmationOperation ? operationStatusLabel(confirmationOperation.status) : result.line_notification === 'not_applicable' ? '送信しない' : '処理中'}`}
                  detail={confirmationOperation?.status === 'permanent_failed' ? '送信に失敗しました。予約詳細から確認してください' : '送信結果と開封状況は受信箱から確認できます'}
                />
                {result.reminders.map((reminder) => <NoticeRow key={reminder.id} title={`${scheduleLabel(reminder.scheduled_at, slotTimeZone)} にお知らせ`} detail={`リマインダ: ${reminder.status === 'pending' ? '送信予定' : reminder.status}`} />)}
                <Summary label="リマインダの時刻" value={result.reminders.map((item) => scheduleLabel(item.scheduled_at, slotTimeZone)).join(' ／ ') || '今後の送信予定はありません'} />
                {automaticOperations.map((operation) => <Summary key={operation.id} label={operation.kind === 'conversion' ? '成果' : operation.kind === 'mileage' ? 'マイル' : '自動化'} value={operationStatusLabel(operation.status)} />)}
                <Summary label="予約台帳" value="1件追加（電話で受けた予約も同じ台帳へ記録します）" />
              </Card>
              <Card title="次にすること">
                <div className="flex flex-wrap gap-2"><Button variant="primary" href="/booking/bookings">今日の台帳を見る</Button><Button href={`/booking/bookings/detail?id=${encodeURIComponent(result.booking_id)}`}>この予約の詳細を見る</Button><Button onClick={() => { setStep('input'); setResult(null); setTime(''); setIdempotencyKey('') }}>続けてもう1件入れる</Button></div>
              </Card>
            </div>
            <aside data-design="Right" className="space-y-4">
              <Card title="お客様に届くもの" note="案内処理の実績と同じ状態を表示しています。"><BookingConfirmPreview friendName={customerLabel} menuName={menu.name} staffName={selectedStaff.display_name} timeZone={slotTimeZone} startUtc={slotStartIso} deliveryStatus={confirmationOperation?.status ?? result.line_notification} /></Card>
              <RelatedLinks includeConversion />
            </aside>
          </div>
        </>
      )}

      {/* N-401: 閲覧のみの人には確認・登録の操作バーを出さない */}
      {canOperate && (step === 'input' || step === 'confirm' || step === 'conflict') && (
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

/** N-391: 通知の送る／送らないを予約ごとに選ぶトグル。 */
function NotificationToggle({ checked, onChange, title, detail }: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  detail: string
}) {
  return (
    <label className="flex cursor-pointer gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent-deep mt-1 h-4 w-4"
      />
      <div>
        <p className="text-ink text-sm font-medium">{title}</p>
        <p className="text-ink-faint mt-0.5 text-xs">{detail}</p>
      </div>
    </label>
  )
}

function BookingConfirmPreview({ friendName, menuName, staffName, timeZone, startUtc, deliveryStatus }: {
  friendName: string
  menuName: string
  staffName: string
  timeZone?: string
  startUtc: string
  deliveryStatus: string
}) {
  const deliveryLabel = deliveryStatus === 'succeeded' ? '送信済み・開封状況は受信箱で確認できます'
    : deliveryStatus === 'queued' ? '送信処理中です'
      : deliveryStatus === 'scheduled' ? '送信予定です'
        : deliveryStatus === 'permanent_failed' || deliveryStatus === 'failed' ? '送信に失敗しました'
          : deliveryStatus === 'not_applicable' ? 'LINE未連携のため送信しません'
            : '「予約を入れる」を押すと、すぐに届きます'
  return (
    <>
    {/* 送信の状態は動く情報なので、枠の外に見えるまま残す（? には入れない）。 */}
    <p className="text-ink-secondary mb-2 text-center text-xs">{deliveryLabel}</p>
    <LinePreview>
      <div className="bg-canvas rounded-card p-4 text-sm leading-6">
        <p>{friendName}さま</p>
        <p>{dateLabel(startUtc, timeZone)} から、{menuName}をお受けしました。</p>
        <p>担当は{staffName}です。ご来店をお待ちしています。</p>
        <Button href="/booking/bookings" variant="primary" className="mt-3 w-full">予約内容を確認する</Button>
      </div>
    </LinePreview>
    </>
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
        <p><Link href="/booking/bookings" className="text-action font-semibold underline">→ 予約管理</Link>　今日の台帳</p>
        <p><Link href="/booking/menus" className="text-action font-semibold underline">→ 予約設定</Link>　メニューと空き枠</p>
        <p><Link href="/reminders" className="text-action font-semibold underline">→ リマインダ</Link>　前日・開始前のお知らせ</p>
        <p><Link href="/friends" className="text-action font-semibold underline">→ 友だち</Link>　顧客カルテに残ります</p>
        {includeConversion ? <p><Link href="/conversions" className="text-action font-semibold underline">→ コンバージョン</Link>　予約の成果を確認</p> : null}
      </div>
    </Card>
  )
}
