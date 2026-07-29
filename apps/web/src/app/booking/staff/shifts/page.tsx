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

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
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

  const load = useCallback(async () => {
    if (!selectedAccountId || !staffId) return
    setLoading(true)
    setError(null)
    setShifts([])
    setStaffMember(null)
    try {
      const [shiftResult, staffResult, locationResult] = await Promise.all([
        bookingApi.getShifts(selectedAccountId, staffId),
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
  }, [selectedAccountId, staffId])

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
  const sortedSelectedDates = useMemo(
    () => [...selectedDates].sort(),
    [selectedDates],
  )

  function moveMonth(offset: number) {
    const next = new Date(monthStart)
    next.setUTCMonth(next.getUTCMonth() + offset)
    setCalendarMonth(next.toISOString().slice(0, 7))
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
            <div className="p-4">
              <div className="grid grid-cols-7 text-center text-xs text-gray-500 mb-2">
                {DAYS.map((day) => (
                  <div key={day.label} className={day.tone}>{day.label}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((date) => {
                  const inMonth = date.startsWith(calendarMonth)
                  const selected = selectedDates.has(date)
                  const shift = shiftByDate.get(date)
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!inMonth}
                      onClick={() => toggleDate(date)}
                      className={`min-h-24 rounded-lg border p-1.5 text-left transition-colors ${
                        !inMonth
                          ? 'border-transparent bg-gray-50 text-gray-300'
                          : selected
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400'
                            : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
                      }`}
                    >
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums ${
                          selected ? 'bg-blue-500 text-white font-semibold' : ''
                        }`}
                      >
                        {Number(date.slice(8, 10))}
                      </span>
                      {shift && (
                        <span className="block mt-1 rounded bg-green-100 text-green-800 p-1 text-[10px] leading-tight">
                          登録済み
                          <br />
                          {shift.location_name ?? '店舗未設定'}
                          <br />
                          {shift.start_time}〜{shift.end_time}
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
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold">登録済みシフト（{shifts.length}日）</h2>
            </div>
            {loading ? (
              <div className="p-10 text-center text-sm text-gray-500">読み込み中…</div>
            ) : shifts.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-500">まだシフトがありません</div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
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
                    {shifts.map((shift) => (
                      <tr key={shift.id}>
                        <td className="px-4 py-2 text-sm tabular-nums">{shift.work_date}</td>
                        <td className="px-4 py-2 text-sm">{shift.location_name ?? '未設定'}</td>
                        <td className="px-4 py-2 text-sm tabular-nums">
                          {shift.start_time}〜{shift.end_time}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => void deleteShift(shift.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
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
