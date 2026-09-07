'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  bookingApi,
  type BookingAvailabilitySlot,
  type BookingResource,
  type BookingSettings,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

type LoadStatus = 'loading' | 'ready' | 'error'
type PreviewMark = '○' | '×' | '休'

const DAYS = [
  { weekday: 1, label: '月曜日' },
  { weekday: 2, label: '火曜日' },
  { weekday: 3, label: '水曜日' },
  { weekday: 4, label: '木曜日' },
  { weekday: 5, label: '金曜日' },
  { weekday: 6, label: '土曜日' },
  { weekday: 0, label: '日曜日' },
] as const

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function previewDates(): Array<{ date: string; day: number }> {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return { date: isoDate(date), day: date.getUTCDate() }
  })
}

function shortTime(value: string): string {
  return value.replace(/^0/, '')
}

function openHours(intervals: Array<{ start: string; end: string }>): string {
  if (intervals.length === 0) return '—'
  return `${shortTime(intervals[0].start)} 〜 ${shortTime(intervals[intervals.length - 1].end)}`
}

function breakHours(intervals: Array<{ start: string; end: string }>): string {
  if (intervals.length < 2) return intervals.length === 0 ? '—' : 'なし'
  return intervals.slice(0, -1).map((interval, index) => (
    `${shortTime(interval.end)} 〜 ${shortTime(intervals[index + 1].start)}`
  )).join(' / ')
}

function shortDate(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${Number(match[1])}/${Number(match[2])}` : value
}

export default function StaffShiftsPage() {
  usePageTitle('予約設定')
  const { selectedAccountId, selectedAccount } = useAccount()
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [resources, setResources] = useState<BookingResource[]>([])
  const [slots, setSlots] = useState<BookingAvailabilitySlot[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [previewError, setPreviewError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [addingClosed, setAddingClosed] = useState(false)
  const [closedFrom, setClosedFrom] = useState('')
  const [closedTo, setClosedTo] = useState('')
  const [closedReason, setClosedReason] = useState('')
  const [savingClosed, setSavingClosed] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const previewUrl = selectedAccount?.liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(selectedAccount.liffId)}&page=salon-book`
    : null
  const dates = useMemo(previewDates, [])

  useEffect(() => {
    const requestId = ++requestRef.current
    if (!selectedAccountId) {
      setSettings(null)
      setSlots([])
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    setPreviewError(false)
    setSaveError(null)

    void Promise.all([
      bookingApi.getSettings(selectedAccountId),
      bookingApi.listMenus(selectedAccountId),
      bookingApi.listResources(selectedAccountId),
    ]).then(async ([settingsResult, menuResult, resourcesResult]) => {
      if (requestId !== requestRef.current) return
      if (!settingsResult.success) throw new Error(settingsResult.error)
      setSettings(settingsResult.data)
      setResources(resourcesResult.data.resources)
      setLoadStatus('ready')

      const menu = menuResult.menus.find((item) => item.is_active)
      if (!menu) {
        setSlots([])
        return
      }
      try {
        const availability = await bookingApi.getAvailability(selectedAccountId, {
          menuId: menu.id,
          from: dates[0].date,
          to: dates[dates.length - 1].date,
        })
        if (requestId !== requestRef.current) return
        setSlots(availability.by_staff.flatMap((item) => item.slots))
      } catch {
        if (requestId !== requestRef.current) return
        setSlots([])
        setPreviewError(true)
      }
    }).catch(() => {
      if (requestId !== requestRef.current) return
      setSettings(null)
      setResources([])
      setSlots([])
      setLoadStatus('error')
    })

    return () => {
      requestRef.current += 1
    }
  }, [dates, reloadKey, selectedAccountId])

  const storeExceptions = useMemo(
    () => (settings?.exceptions ?? []).filter((item) => !item.scopeKind || item.scopeKind === 'store'),
    [settings],
  )
  const slotDates = useMemo(() => new Set(slots.map((slot) => slot.date)), [slots])
  const preview = useMemo(() => dates.map((item) => {
    const weekday = new Date(`${item.date}T00:00:00.000Z`).getUTCDay()
    const exception = storeExceptions.find((candidate) => {
      const from = candidate.dateFrom || candidate.date || ''
      const to = candidate.dateTo || candidate.date || ''
      return from <= item.date && item.date <= to
    })
    const hours = settings?.businessHours.find((entry) => entry.weekday === weekday)?.intervals ?? []
    let mark: PreviewMark = slotDates.has(item.date) ? '○' : '×'
    if (exception?.kind === 'closed' || (!exception && hours.length === 0)) mark = '休'
    return { ...item, mark }
  }), [dates, settings, slotDates, storeExceptions])

  const closedWeekdays = DAYS.filter((day) => (
    settings?.businessHours.find((entry) => entry.weekday === day.weekday)?.intervals.length === 0
  )).map((day) => day.label)

  async function saveClosedDay() {
    if (!selectedAccountId || !closedFrom || !closedTo || closedFrom > closedTo) {
      setSaveError('開始日と終了日を正しく入れてください。')
      return
    }
    setSavingClosed(true)
    setSaveError(null)
    try {
      const response = await bookingApi.createException(selectedAccountId, {
        scopeKind: 'store',
        dateFrom: closedFrom,
        dateTo: closedTo,
        kind: 'closed',
        intervals: [],
        reason: closedReason.trim() || null,
      })
      if (!response.success) throw new Error(response.error)
      setSettings((current) => current ? {
        ...current,
        exceptions: [...current.exceptions, response.data],
      } : current)
      setAddingClosed(false)
      setClosedFrom('')
      setClosedTo('')
      setClosedReason('')
    } catch {
      setSaveError('休業日を保存できませんでした。入力内容を確かめて、もう一度お試しください。')
    } finally {
      setSavingClosed(false)
    }
  }

  return (
    <div data-design-node="tksPc" className="space-y-4 pb-8">
      <div data-design="Head" className="flex flex-wrap items-center gap-3">
        <nav aria-label="現在位置" className="text-ink-faint text-xs">
          <Link href="/booking/bookings" className="text-accent hover:underline">予約</Link>
          <span className="mx-2">›</span>
          <Link href="/booking/menus" className="text-accent hover:underline">予約設定</Link>
          <span className="mx-2">›</span>
          <span>受付枠</span>
        </nav>
        {previewUrl ? <Button className="ml-auto" href={previewUrl}>お客様に見える画面を確かめる</Button> : null}
      </div>

      <div data-design="Tabs" className="border-hairline flex flex-wrap gap-1 border-b">
        <Link href="/booking/menus" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">メニュー {settings?.menuCount ?? '—'}</Link>
        <span className="border-accent text-ink rounded-t-md border-b-2 px-4 py-2 text-sm font-medium">受付枠</span>
        <a href="#special" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">休業日</a>
        <a href="#rules" className="text-ink-faint rounded-t-md px-4 py-2 text-sm hover:text-ink-secondary">予約のルール</a>
      </div>

      <div data-design="Info" className="bg-info-bg text-info rounded-card px-4 py-3 text-sm">
        何時から何時まで、どの曜日を受けるかです。右に、お客様のLINEに出るカレンダーがそのまま出ます。
      </div>

      {!selectedAccountId ? (
        <ListState kind="empty" title="LINEアカウントを選んでください" description="受付枠を確認するアカウントを選びます。" />
      ) : loadStatus === 'loading' ? (
        <ListState kind="loading" title="受付時間と休業日を読み込んでいます" />
      ) : loadStatus === 'error' || !settings ? (
        <ListState
          kind="error"
          title="受付時間と休業日を表示できませんでした"
          description="保存済みの設定は消えていません。時間をおいて、もう一度読み込んでください。"
          action={<Button onClick={() => setReloadKey((value) => value + 1)}>受付時間と休業日を再読み込み</Button>}
        />
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <section data-design="Week" className="bg-canvas border-hairline overflow-hidden rounded-card border">
              <div className="border-hairline border-b px-4 py-4">
                <h2 className="text-ink font-semibold">曜日ごとの受付時間</h2>
                <p className="text-ink-faint mt-1 text-xs">閉めた曜日は、お客様の画面に出ません。</p>
              </div>
              <DataTable className="rounded-none border-0">
                <thead>
                  <TableHeadRow>
                    <Th>曜日</Th>
                    <Th>受け付ける</Th>
                    <Th>開ける時間</Th>
                    <Th>休けい</Th>
                    <Th>1時間に受けられる数</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {DAYS.map((day) => {
                    const intervals = settings.businessHours.find((item) => item.weekday === day.weekday)?.intervals ?? []
                    const accepts = intervals.length > 0
                    return (
                      <Tr key={day.weekday}>
                        <Td className="whitespace-nowrap font-medium">{day.label}</Td>
                        <Td className="whitespace-nowrap">{accepts ? 'はい' : 'いいえ（定休日）'}</Td>
                        <Td className="whitespace-nowrap tabular-nums">{openHours(intervals)}</Td>
                        <Td className="whitespace-nowrap tabular-nums">{breakHours(intervals)}</Td>
                        <Td className="whitespace-nowrap">{intervals[0]?.capacity ?? '—'}件</Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            </section>

            <section id="special" data-design="Special" className="bg-canvas border-hairline rounded-card border p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <h2 className="text-ink font-semibold">休業日</h2>
                  <p className="text-ink-faint mt-1 text-xs">この日は、曜日の決めごとより優先して閉めます。</p>
                </div>
                <Button className="ml-auto" onClick={() => setAddingClosed((value) => !value)}>休業日を足す</Button>
              </div>
              {addingClosed ? (
                <div className="border-hairline bg-canvas-sunken mt-4 grid gap-3 rounded-control border p-3 sm:grid-cols-3">
                  <label className="text-ink-secondary text-xs">
                    開始日
                    <input aria-label="休業の開始日" type="date" value={closedFrom} onChange={(event) => setClosedFrom(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                  </label>
                  <label className="text-ink-secondary text-xs">
                    終了日
                    <input aria-label="休業の終了日" type="date" value={closedTo} onChange={(event) => setClosedTo(event.target.value)} className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                  </label>
                  <label className="text-ink-secondary text-xs">
                    理由
                    <input aria-label="休業の理由" value={closedReason} onChange={(event) => setClosedReason(event.target.value)} placeholder="例: お盆" className="border-hairline rounded-control mt-1 w-full border bg-canvas px-3 py-2 text-sm" />
                  </label>
                  {saveError ? <p className="text-danger text-xs sm:col-span-2">{saveError}</p> : <span className="sm:col-span-2" />}
                  <Button variant="primary" onClick={() => void saveClosedDay()} disabled={savingClosed}>{savingClosed ? '保存中…' : '休業日を保存'}</Button>
                </div>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {storeExceptions.filter((item) => item.kind === 'closed').length === 0 ? (
                  <p className="text-ink-faint text-sm">休業日はありません</p>
                ) : storeExceptions.filter((item) => item.kind === 'closed').map((item) => {
                  const from = item.dateFrom || item.date || ''
                  const to = item.dateTo || item.date || ''
                  return (
                    <div key={item.id || `${from}-${to}`} className="border-hairline rounded-control border p-3">
                      <p className="text-ink font-semibold tabular-nums">{shortDate(from)}{from !== to ? `〜${shortDate(to)}` : ''}</p>
                      <p className="text-ink-secondary mt-1 text-sm">{item.reason || item.note || '休業日'}</p>
                    </div>
                  )
                })}
              </div>
            </section>

            <section id="rules" data-design="Rules" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">予約のルール</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['何日先まで取れるか', settings.bookingWindowDays, '日'],
                  ['何時間前まで取れるか', settings.cutoffMinutesBefore / 60, '時間'],
                  ['何時間前まで取り消せるか', settings.cancelDeadlineMinutesBefore / 60, '時間'],
                  ['同じ人が同時に持てる予約', settings.maxActiveBookingsPerFriend, '件まで'],
                ].map(([label, value, unit]) => (
                  <div key={label} className="border-hairline rounded-control border p-3">
                    <p className="text-ink-secondary text-xs font-medium">{label}</p>
                    <p className="text-ink mt-2 text-lg font-semibold tabular-nums">{value}</p>
                    <p className="text-ink-faint mt-1 text-xs">{unit}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:w-96 xl:flex-none">
            <section data-design="Preview" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink-secondary text-sm font-semibold">お客様のLINEではこう見えます</h2>
              <div className="bg-info mt-3 rounded-card p-3">
                <div className="bg-canvas rounded-control p-4">
                  <p className="text-ink text-sm font-semibold">ご希望の日をえらんでください</p>
                  <div className="text-ink-faint mt-3 grid grid-cols-7 gap-1 text-center text-xs">
                    {['月', '火', '水', '木', '金', '土', '日'].map((day) => <span key={day} className="font-medium">{day}</span>)}
                    {preview.map((item) => (
                      <span key={item.date} className="bg-canvas-sunken rounded-control py-2" title={item.date}>
                        <span className="block tabular-nums">{item.day}</span>
                        <span className={item.mark === '○' ? 'text-success' : item.mark === '休' ? 'text-ink-faint' : 'text-danger'}>{item.mark}</span>
                      </span>
                    ))}
                  </div>
                  {previewError ? <p className="text-danger mt-3 text-xs">空き状況だけ読み込めませんでした。</p> : null}
                  <dl className="text-ink-secondary mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div className="flex gap-2"><dt className="text-success font-semibold">○</dt><dd>あいています</dd></div>
                    <div className="flex gap-2"><dt className="text-danger font-semibold">×</dt><dd>満席です</dd></div>
                    <div className="flex gap-2"><dt className="font-semibold">休</dt><dd>お休み</dd></div>
                  </dl>
                  <p className="text-ink-faint mt-3 text-xs">○・△・×は受付上限に対する残数を反映しています。</p>
                  <div className="mt-3 space-y-1 text-xs">
                    {slots.slice(0, 6).map((slot) => <div key={`${slot.date}-${slot.start}`} className="flex justify-between"><span>{shortDate(slot.date)} {slot.start}</span><span>残り{slot.remaining}/{slot.capacity}</span></div>)}
                  </div>
                </div>
              </div>
            </section>

            <section data-design="Resources" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">設備ごとの受付上限</h2>
              <div className="mt-3 space-y-2 text-sm">
                {resources.length === 0 ? <p className="text-ink-faint">設備は登録されていません</p> : resources.map((resource) => <div key={resource.id} className="flex justify-between"><span>{resource.name}</span><span>{resource.isActive ? `${resource.capacity}枠` : '停止中'}</span></div>)}
              </div>
            </section>

            <section data-design="Trouble" className="bg-warning-bg text-warning rounded-card p-4">
              <h2 className="font-semibold">よくある困りごと</h2>
              <dl className="mt-3 space-y-3 text-xs leading-5">
                <div>
                  <dt className="font-semibold">閉めている曜日</dt>
                  <dd>{closedWeekdays.length > 0 ? closedWeekdays.join('・') : 'ありません'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">直前の予約が多くて準備できない</dt>
                  <dd>「何時間前まで取れるか」を長くすると減ります。</dd>
                </div>
              </dl>
            </section>

            <section data-design="Links" className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink font-semibold">つながる先</h2>
              <div className="mt-3 space-y-3 text-sm">
                <Link href="/booking/bookings" className="text-accent flex justify-between gap-3"><span>→ 予約管理</span><span className="text-ink-faint text-xs">入った予約の台帳</span></Link>
                <Link href="/rich-menus" className="text-accent flex justify-between gap-3"><span>→ リッチメニュー</span><span className="text-ink-faint text-xs">予約ボタンの飛び先</span></Link>
                <Link href="/reminders" className="text-accent flex justify-between gap-3"><span>→ リマインダ</span><span className="text-ink-faint text-xs">前日・当日のお知らせ</span></Link>
                <Link href="/users" className="text-accent flex justify-between gap-3"><span>→ ログインユーザー</span><span className="text-ink-faint text-xs">担当できる人</span></Link>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
