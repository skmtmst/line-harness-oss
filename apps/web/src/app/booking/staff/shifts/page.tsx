'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import {
  bookingApi,
  type BookingLocation,
  type BookingShift,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const DAYS = [
  { label: '日', tone: 'text-red-500' },
  { label: '月', tone: '' },
  { label: '火', tone: '' },
  { label: '水', tone: '' },
  { label: '木', tone: '' },
  { label: '金', tone: '' },
  { label: '土', tone: 'text-blue-500' },
]

const LOCATION_TONES = [
  {
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    calendar: 'bg-indigo-50 text-indigo-900 border-indigo-300',
    dot: 'bg-indigo-500',
  },
  {
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
    calendar: 'bg-amber-50 text-amber-900 border-amber-300',
    dot: 'bg-amber-500',
  },
  {
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    calendar: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  {
    badge: 'bg-rose-100 text-rose-800 border-rose-200',
    calendar: 'bg-rose-50 text-rose-900 border-rose-300',
    dot: 'bg-rose-500',
  },
] as const

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

function monthRange(month: string): { from: string; to: string } {
  const start = new Date(`${month}-01T00:00:00Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  end.setUTCDate(0)
  return {
    from: `${month}-01`,
    to: end.toISOString().slice(0, 10),
  }
}

function compactShiftTime(startTime: string, endTime: string): string {
  const compact = (value: string) => value.endsWith(':00') ? value.slice(0, 2) : value
  return `${compact(startTime)}–${compact(endTime)}`
}

export default function StaffShiftsPage() {
  const sp = useSearchParams()
  const staffId = sp.get('staff_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [staffMember, setStaffMember] = useState<BookingStaff | null>(null)
  const [shifts, setShifts] = useState<BookingShift[]>([])
  const [locations, setLocations] = useState<BookingLocation[]>([])
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [calendarMonth, setCalendarMonth] = useState(jstToday().slice(0, 7))
  const [locationId, setLocationId] = useState('')
  const [startTime, setStartTime] = useState('11:00')
  const [endTime, setEndTime] = useState('19:00')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [editingShift, setEditingShift] = useState<BookingShift | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId || !staffId) return
    setLoading(true)
    setError(null)
    setShifts([])
    setStaffMember(null)
    try {
      const range = monthRange(calendarMonth)
      const [shiftResult, staffResult, locationResult] = await Promise.all([
        bookingApi.getShifts(selectedAccountId, staffId, range.from, range.to),
        bookingApi.listStaff(selectedAccountId),
        bookingApi.listLocations(selectedAccountId),
      ])
      setShifts(shiftResult.shifts)
      setStaffMember(staffResult.staff.find((staff) => staff.id === staffId) ?? null)
      const activeLocations = locationResult.locations.filter((location) => location.is_active)
      setLocations(activeLocations)
      setLocationId((current) => current || activeLocations[0]?.id || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [calendarMonth, selectedAccountId, staffId])

  useEffect(() => {
    void load()
  }, [load])

  const monthStart = useMemo(
    () => new Date(`${calendarMonth}-01T00:00:00Z`),
    [calendarMonth],
  )
  const calendarDays = useMemo(() => {
    const first = new Date(monthStart)
    first.setUTCDate(1 - monthStart.getUTCDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first)
      date.setUTCDate(first.getUTCDate() + index)
      return date.toISOString().slice(0, 10)
    })
  }, [monthStart])
  const shiftByDate = useMemo(
    () => new Map(shifts.map((shift) => [shift.work_date, shift])),
    [shifts],
  )
  const locationToneById = useMemo(() => {
    const result = new Map<string, (typeof LOCATION_TONES)[number]>()
    const ordered = [...locations].sort((a, b) => {
      const aPriority = a.name.includes('渋谷') ? 0 : a.name.includes('甲府') ? 1 : 2
      const bPriority = b.name.includes('渋谷') ? 0 : b.name.includes('甲府') ? 1 : 2
      return aPriority - bPriority || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja')
    })
    ordered.forEach((location, index) => {
      result.set(location.id, LOCATION_TONES[index % LOCATION_TONES.length])
    })
    return result
  }, [locations])
  const sortedSelectedDates = useMemo(
    () => [...selectedDates].sort(),
    [selectedDates],
  )

  function moveMonth(offset: number) {
    const next = new Date(monthStart)
    next.setUTCMonth(next.getUTCMonth() + offset)
    setCalendarMonth(next.toISOString().slice(0, 7))
    setSelectedDates(new Set())
    setSavedMessage(null)
  }

  function toggleDate(date: string) {
    if (!date.startsWith(calendarMonth)) return
    setSavedMessage(null)
    setSelectedDates((current) => {
      const next = new Set(current)
      if (next.has(date)) {
        next.delete(date)
      } else {
        if (next.size === 0) {
          const existing = shiftByDate.get(date)
          if (existing) {
            setLocationId(existing.location_id ?? locations[0]?.id ?? '')
            setStartTime(existing.start_time)
            setEndTime(existing.end_time)
          }
        }
        next.add(date)
      }
      return next
    })
  }

  function removeSelectedDate(date: string) {
    setSelectedDates((current) => {
      const next = new Set(current)
      next.delete(date)
      return next
    })
  }

  function editShift(shift: BookingShift) {
    setSavedMessage(null)
    setEditingShift(shift)
  }

  async function saveEditedShift(values: {
    location_id: string
    start_time: string
    end_time: string
  }) {
    if (!selectedAccountId || !staffId || !editingShift) return
    setSaving(true)
    setError(null)
    try {
      await bookingApi.putShifts(selectedAccountId, staffId, [{
        work_date: editingShift.work_date,
        ...values,
      }])
      setEditingShift(null)
      await load()
      setSavedMessage(`${editingShift.work_date}のシフトを更新しました。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function saveSelected() {
    if (!selectedAccountId || !staffId) return
    if (selectedDates.size === 0) {
      setError('カレンダーからシフトを登録する日付を選択してください。')
      return
    }
    if (!locationId) {
      setError('予約枠（甲府店／渋谷店）を選択してください。')
      return
    }
    if (!startTime || !endTime || startTime >= endTime) {
      setError('開始時間より後の終了時間を設定してください。')
      return
    }
    const overwriteCount = sortedSelectedDates.filter((date) => shiftByDate.has(date)).length
    if (
      overwriteCount > 0 &&
      !confirm(`選択した日付のうち${overwriteCount}日には既存シフトがあります。同じ時間・予約枠で上書きしますか？`)
    ) {
      return
    }

    setSaving(true)
    setError(null)
    setSavedMessage(null)
    try {
      await bookingApi.putShifts(
        selectedAccountId,
        staffId,
        sortedSelectedDates.map((workDate) => ({
          work_date: workDate,
          start_time: startTime,
          end_time: endTime,
          location_id: locationId,
        })),
      )
      const count = selectedDates.size
      setSelectedDates(new Set())
      await load()
      setSavedMessage(`${count}日分のシフトを一括登録しました。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteShift(shiftId: string) {
    if (!selectedAccountId || !staffId) return
    if (!confirm('この日のシフトを削除しますか？')) return
    try {
      await bookingApi.deleteShift(selectedAccountId, staffId, shiftId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <Header
        title="シフト管理"
        description={
          staffMember
            ? `「${staffMember.display_name}」の出勤日・予約枠を一括登録`
            : 'カレンダーから複数日を選択して一括登録'
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {savedMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          {savedMessage}
        </div>
      )}

      {!selectedAccountId ? (
        <EmptyState>サイドバーでアカウントを選択してください</EmptyState>
      ) : !staffId ? (
        <EmptyState>
          スタッフが指定されていません。
          <a href="/booking/staff" className="ml-1 text-blue-600 underline">スタッフ一覧</a>
          から開き直してください。
        </EmptyState>
      ) : locations.length === 0 && !loading ? (
        <EmptyState>
          先に
          <a href="/booking/locations" className="mx-1 text-blue-600 underline">店舗管理</a>
          で甲府店・渋谷店を登録してください。
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">日付を複数選択</h2>
                <p className="text-xs text-gray-500 mt-1">
                  同じ時間・予約枠で登録したい日付をすべてクリックしてください
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => moveMonth(-1)} className="px-3 py-1.5 border rounded-lg text-sm">←</button>
                <span className="font-semibold tabular-nums">{calendarMonth.replace('-', '年')}月</span>
                <button onClick={() => moveMonth(1)} className="px-3 py-1.5 border rounded-lg text-sm">→</button>
              </div>
            </div>
            <div className="p-2 sm:p-4">
              <div className="grid grid-cols-7 text-center text-xs text-gray-500 mb-2">
                {DAYS.map((day) => (
                  <div key={day.label} className={day.tone}>{day.label}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                {calendarDays.map((date) => {
                  const inMonth = date.startsWith(calendarMonth)
                  const selected = selectedDates.has(date)
                  const shift = shiftByDate.get(date)
                  const shiftTone = shift?.location_id
                    ? locationToneById.get(shift.location_id)
                    : undefined
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!inMonth}
                      onClick={() => toggleDate(date)}
                      className={`min-h-16 rounded-md border p-1 text-left transition-colors sm:min-h-24 sm:rounded-lg sm:p-1.5 ${
                        !inMonth
                          ? 'border-transparent bg-gray-50 text-gray-300'
                          : selected
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400'
                            : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
                      }`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums sm:h-7 sm:w-7 sm:text-sm ${
                          selected ? 'bg-blue-500 text-white font-semibold' : ''
                        }`}
                      >
                        {Number(date.slice(8, 10))}
                      </span>
                      {shift && (
                        <span
                          className={`block mt-0.5 rounded border p-0.5 text-[9px] leading-tight sm:mt-1 sm:p-1 sm:text-[10px] ${
                            shiftTone?.calendar ?? 'border-gray-200 bg-gray-100 text-gray-700'
                          }`}
                        >
                          <span className="sm:hidden">{shift.location_name?.replace('店', '') ?? '登録'}</span>
                          <span className="block whitespace-nowrap text-[8px] font-semibold sm:hidden">
                            {compactShiftTime(shift.start_time, shift.end_time)}
                          </span>
                          <span className="hidden sm:inline">
                            登録済み
                            <br />
                            {shift.location_name ?? '店舗未設定'}
                            <br />
                            {shift.start_time}〜{shift.end_time}
                          </span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-semibold">選択した日付へ一括登録</h2>
                <p className="text-xs text-gray-500 mt-1">
                  選択中: <strong className="text-blue-600">{selectedDates.size}日</strong>
                </p>
              </div>
              {selectedDates.size > 0 && (
                <button
                  onClick={() => setSelectedDates(new Set())}
                  className="text-xs text-gray-500 hover:underline"
                >
                  選択をすべて解除
                </button>
              )}
            </div>

            {sortedSelectedDates.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {sortedSelectedDates.map((date) => (
                  <button
                    key={date}
                    onClick={() => removeSelectedDate(date)}
                    className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs"
                    title="クリックして選択解除"
                  >
                    {date} ×
                  </button>
                ))}
              </div>
            )}

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-gray-600">
                予約枠（店舗）
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">予約できる店舗を選択</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-gray-600">
                開始時間
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-gray-600">
                終了時間
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              onClick={() => void saveSelected()}
              disabled={saving || selectedDates.size === 0}
              className="mt-4 w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '一括登録中…' : `${selectedDates.size}日分のシフトを一括登録`}
            </button>
          </section>

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {calendarMonth.replace('-', '年')}月の登録済みシフト（{shifts.length}日）
                </h2>
                <p className="mt-1 text-xs text-gray-500">表示中の月だけを読み込んでいます</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {locations.map((location) => {
                  const tone = locationToneById.get(location.id)
                  return (
                    <span key={location.id} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                      <span className={`h-2.5 w-2.5 rounded-full ${tone?.dot ?? 'bg-gray-400'}`} />
                      {location.name}
                    </span>
                  )
                })}
              </div>
            </div>
            {loading ? (
              <div className="p-10 text-center text-sm text-gray-500">読み込み中…</div>
            ) : shifts.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-500">まだシフトがありません</div>
            ) : (
              <>
              <div className="divide-y divide-gray-100 sm:hidden">
                {shifts.map((shift) => {
                  const tone = shift.location_id
                    ? locationToneById.get(shift.location_id)
                    : undefined
                  return (
                    <article key={shift.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold tabular-nums text-gray-900">{shift.work_date}</p>
                          <p className="mt-1 text-sm tabular-nums text-gray-600">
                            {shift.start_time}〜{shift.end_time}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            tone?.badge ?? 'border-gray-200 bg-gray-100 text-gray-700'
                          }`}
                        >
                          <span className={`h-2 w-2 rounded-full ${tone?.dot ?? 'bg-gray-400'}`} />
                          {shift.location_name ?? '未設定'}
                        </span>
                      </div>
                      <div className="mt-3 flex justify-end gap-2 border-t border-gray-100 pt-3">
                        <button
                          onClick={() => editShift(shift)}
                          className="min-h-10 rounded-lg border border-blue-200 px-4 text-xs font-semibold text-blue-600"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => void deleteShift(shift.id)}
                          className="min-h-10 rounded-lg border border-red-200 px-4 text-xs font-semibold text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-2 text-left text-xs text-gray-500">日付</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500">予約枠</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500">時間</th>
                      <th className="px-4 py-2 text-right text-xs text-gray-500">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shifts.map((shift) => {
                      const tone = shift.location_id
                        ? locationToneById.get(shift.location_id)
                        : undefined
                      return (
                      <tr key={shift.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm tabular-nums">{shift.work_date}</td>
                        <td className="px-4 py-2 text-sm">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              tone?.badge ?? 'border-gray-200 bg-gray-100 text-gray-700'
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full ${tone?.dot ?? 'bg-gray-400'}`} />
                            {shift.location_name ?? '未設定'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm tabular-nums">
                          {shift.start_time}〜{shift.end_time}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => editShift(shift)}
                            className="mr-3 text-xs font-semibold text-blue-600 hover:underline"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => void deleteShift(shift.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </section>
        </div>
      )}
      {editingShift && (
        <ShiftEditModal
          shift={editingShift}
          locations={locations}
          saving={saving}
          onSave={saveEditedShift}
          onClose={() => setEditingShift(null)}
        />
      )}
    </div>
  )
}

function ShiftEditModal({
  shift,
  locations,
  saving,
  onSave,
  onClose,
}: {
  shift: BookingShift
  locations: BookingLocation[]
  saving: boolean
  onSave: (values: { location_id: string; start_time: string; end_time: string }) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    location_id: shift.location_id ?? locations[0]?.id ?? '',
    start_time: shift.start_time,
    end_time: shift.end_time,
  })
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!form.location_id) {
      setError('店舗を選択してください。')
      return
    }
    if (!form.start_time || !form.end_time || form.start_time >= form.end_time) {
      setError('終了時間は開始時間より後に設定してください。')
      return
    }
    setError(null)
    await onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <div className="w-full rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-green-700">登録済みシフトを編集</p>
            <h2 className="mt-1 text-lg font-bold text-gray-900">{shift.work_date}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xl text-gray-600"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <label className="block text-sm font-semibold text-gray-700">
            店舗
            <select
              value={form.location_id}
              onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              className="mt-2 block min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-base"
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <div className="grid w-full grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-end gap-2 rounded-2xl bg-gray-50 p-3">
            <label className="block w-full min-w-0 text-sm font-semibold text-gray-700">
              開始時間
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="mt-2 block h-14 w-full min-w-0 max-w-full appearance-none rounded-xl border border-gray-300 bg-white px-2 text-center text-base font-semibold text-gray-900"
              />
            </label>
            <span className="mb-4 text-center text-lg font-bold text-gray-400" aria-hidden="true">〜</span>
            <label className="block w-full min-w-0 text-sm font-semibold text-gray-700">
              終了時間
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="mt-2 block h-14 w-full min-w-0 max-w-full appearance-none rounded-xl border border-gray-300 bg-white px-2 text-center text-base font-semibold text-gray-900"
              />
            </label>
          </div>
          {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-xl border border-gray-300 font-semibold text-gray-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="min-h-12 rounded-xl bg-green-600 font-bold text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
      {children}
    </div>
  )
}
