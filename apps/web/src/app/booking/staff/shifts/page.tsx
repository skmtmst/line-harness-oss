'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import {
  bookingApi,
  type BookingLocation,
  type BookingShift,
  type BookingStaff,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const DAYS: Array<{ key: DayKey; label: string; tone: string }> = [
  { key: 'sun', label: '日', tone: 'text-red-500' },
  { key: 'mon', label: '月', tone: '' },
  { key: 'tue', label: '火', tone: '' },
  { key: 'wed', label: '水', tone: '' },
  { key: 'thu', label: '木', tone: '' },
  { key: 'fri', label: '金', tone: '' },
  { key: 'sat', label: '土', tone: 'text-blue-500' },
]

type TemplateEntry = { start: string; end: string; location_id: string }

const DEFAULT_TEMPLATE: Record<DayKey, TemplateEntry | null> = {
  sun: null,
  mon: { start: '10:00', end: '19:00', location_id: '' },
  tue: { start: '10:00', end: '19:00', location_id: '' },
  wed: { start: '10:00', end: '19:00', location_id: '' },
  thu: { start: '10:00', end: '19:00', location_id: '' },
  fri: { start: '10:00', end: '19:00', location_id: '' },
  sat: { start: '10:00', end: '19:00', location_id: '' },
}

export default function StaffShiftsPage() {
  const sp = useSearchParams()
  const id = sp.get('staff_id') ?? ''
  const { selectedAccountId } = useAccount()
  const [staffMember, setStaffMember] = useState<BookingStaff | null>(null)
  const [shifts, setShifts] = useState<BookingShift[]>([])
  const [locations, setLocations] = useState<BookingLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tpl, setTpl] = useState(DEFAULT_TEMPLATE)
  const [weeks, setWeeks] = useState(4)
  // toISOString は UTC なので 00:00〜09:00 JST に開いた場合、初期値が前日になる。
  // JST 基準の YYYY-MM-DD に補正。
  const [fromDate, setFromDate] = useState(
    new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
  )
  const [generating, setGenerating] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(fromDate.slice(0, 7))
  const [single, setSingle] = useState({
    work_date: fromDate,
    start_time: '10:00',
    end_time: '19:00',
    location_id: '',
  })

  const load = useCallback(async () => {
    if (!selectedAccountId || !id) return
    setLoading(true)
    setError(null)
    // 前 staff/account の表示が残ったまま fetch 失敗 → stale な staff 名・shift
    // 削除ボタンが現 URL に紐付いて見えてしまうのを防ぐ。
    setShifts([])
    setStaffMember(null)
    try {
      const [r, sList, locationList] = await Promise.all([
        bookingApi.getShifts(selectedAccountId, id),
        bookingApi.listStaff(selectedAccountId),
        bookingApi.listLocations(selectedAccountId),
      ])
      setShifts(r.shifts)
      setStaffMember(sList.staff.find((s) => s.id === id) ?? null)
      const activeLocations = locationList.locations.filter((location) => location.is_active)
      setLocations(activeLocations)
      const defaultLocationId = activeLocations[0]?.id ?? ''
      setTpl((current) =>
        Object.fromEntries(
          Object.entries(current).map(([key, value]) => [
            key,
            value && !value.location_id
              ? { ...value, location_id: defaultLocationId }
              : value,
          ]),
        ) as Record<DayKey, TemplateEntry | null>,
      )
      setSingle((current) => ({
        ...current,
        location_id: current.location_id || defaultLocationId,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  async function generate() {
    if (!selectedAccountId) return
    // staff_id 不在ガード: 古いブックマークや URL 手編集での POST `/staff//shifts/generate`
    // を防ぐ。エラーを表示してユーザーに staff 一覧へ戻るよう促す。
    if (!id) {
      setError('staff_id が指定されていません。スタッフ一覧から開き直してください。')
      return
    }
    if (locations.length === 0) {
      setError('先に「店舗管理」で甲府店・渋谷店を登録してください。')
      return
    }
    if (Object.values(tpl).some((entry) => entry && !entry.location_id)) {
      setError('出勤日に勤務店舗を選択してください。')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const r = await bookingApi.generateShifts(selectedAccountId, id, {
        from_date: fromDate,
        weeks,
        weekly_template: tpl,
      })
      setSavedAt(Date.now())
      console.info(`generated ${r.inserted} shifts`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  async function saveSingle() {
    if (!selectedAccountId || !id) return
    if (!single.location_id || !single.work_date || !single.start_time || !single.end_time) {
      setError('店舗・日付・開始時間・終了時間をすべて入力してください。')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      await bookingApi.putShifts(selectedAccountId, id, [single])
      setSavedAt(Date.now())
      setCalendarMonth(single.work_date.slice(0, 7))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const monthStart = new Date(`${calendarMonth}-01T00:00:00Z`)
  const calendarStart = new Date(monthStart)
  calendarStart.setUTCDate(1 - monthStart.getUTCDay())
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart)
    date.setUTCDate(calendarStart.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
  const shiftByDate = new Map(shifts.map((shift) => [shift.work_date, shift]))

  function moveMonth(offset: number) {
    const next = new Date(`${calendarMonth}-01T00:00:00Z`)
    next.setUTCMonth(next.getUTCMonth() + offset)
    setCalendarMonth(next.toISOString().slice(0, 7))
  }

  function editDate(date: string) {
    const existing = shiftByDate.get(date)
    setSingle({
      work_date: date,
      start_time: existing?.start_time ?? '10:00',
      end_time: existing?.end_time ?? '19:00',
      location_id: existing?.location_id ?? locations[0]?.id ?? '',
    })
  }

  async function deleteShift(shiftId: string) {
    if (!selectedAccountId) return
    if (!confirm('このシフトを削除しますか？')) return
    await bookingApi.deleteShift(selectedAccountId, id, shiftId)
    await load()
  }

  return (
    <div>
      <Header
        title="シフト管理"
        description={
          staffMember
            ? `「${staffMember.display_name}」の出勤シフト`
            : '曜日テンプレから一括生成、または個別編集'
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {savedAt && Date.now() - savedAt < 3000 && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          シフトを生成しました
        </div>
      )}

      {!selectedAccountId ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          サイドバーでアカウントを選択してください
        </div>
      ) : !id ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          staff_id が指定されていません。
          <a href="/booking/staff" className="ml-1 text-blue-600 underline">
            スタッフ一覧
          </a>
          から開き直してください。
        </div>
      ) : (
        <div className="space-y-4">
          {locations.length === 0 && !loading && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              シフト登録の前に
              <a href="/booking/locations" className="mx-1 font-medium underline">店舗管理</a>
              で甲府店・渋谷店を追加してください。
            </div>
          )}

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">店舗別シフトカレンダー</h2>
                <p className="text-xs text-gray-500 mt-1">日付を選び、勤務店舗と時間を登録します</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => moveMonth(-1)} className="px-2 py-1 border rounded">←</button>
                <span className="text-sm font-medium tabular-nums">{calendarMonth}</span>
                <button onClick={() => moveMonth(1)} className="px-2 py-1 border rounded">→</button>
              </div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-7 text-center text-xs text-gray-500 mb-1">
                {DAYS.map((day) => <div key={day.key} className={day.tone}>{day.label}</div>)}
              </div>
              <div className="grid grid-cols-7 border-l border-t border-gray-200">
                {calendarDays.map((date) => {
                  const shift = shiftByDate.get(date)
                  const inMonth = date.startsWith(calendarMonth)
                  return (
                    <button
                      key={date}
                      onClick={() => editDate(date)}
                      className={`min-h-20 border-r border-b border-gray-200 p-1 text-left hover:bg-green-50 ${
                        inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'
                      } ${single.work_date === date ? 'ring-2 ring-inset ring-green-500' : ''}`}
                    >
                      <span className="text-xs tabular-nums">{Number(date.slice(8, 10))}</span>
                      {shift && (
                        <span className="block mt-1 rounded bg-green-100 text-green-800 p-1 text-[10px] leading-tight">
                          {shift.location_name ?? '店舗未設定'}
                          <br />
                          {shift.start_time}〜{shift.end_time}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
                <label className="text-xs text-gray-600">
                  日付
                  <input
                    type="date"
                    value={single.work_date}
                    onChange={(e) => {
                      setSingle({ ...single, work_date: e.target.value })
                      if (e.target.value) setCalendarMonth(e.target.value.slice(0, 7))
                    }}
                    className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  勤務店舗
                  <select
                    value={single.location_id}
                    onChange={(e) => setSingle({ ...single, location_id: e.target.value })}
                    className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">選択してください</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  開始
                  <input
                    type="time"
                    value={single.start_time}
                    onChange={(e) => setSingle({ ...single, start_time: e.target.value })}
                    className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  終了
                  <input
                    type="time"
                    value={single.end_time}
                    onChange={(e) => setSingle({ ...single, end_time: e.target.value })}
                    className="mt-1 block border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  onClick={() => void saveSingle()}
                  disabled={generating || locations.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: '#06C755' }}
                >
                  この日のシフトを保存
                </button>
              </div>
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
          {/* テンプレ生成 */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold">曜日テンプレから一括生成</h2>
              <p className="text-xs text-gray-500 mt-1">
                既に同じ日のシフトがあれば skip されます
              </p>
            </div>
            <div className="p-4 space-y-2">
              {DAYS.map((d) => {
                const cur = tpl[d.key]
                return (
                  <div key={d.key} className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={cur !== null}
                      onChange={(e) =>
                        setTpl({
                          ...tpl,
                          [d.key]: e.target.checked
                            ? {
                                start: '10:00',
                                end: '19:00',
                                location_id: locations[0]?.id ?? '',
                              }
                            : null,
                        })
                      }
                      className="w-4 h-4"
                    />
                    <span className={`w-6 font-medium ${d.tone}`}>{d.label}</span>
                    {cur ? (
                      <>
                        <select
                          value={cur.location_id}
                          onChange={(e) =>
                            setTpl({ ...tpl, [d.key]: { ...cur, location_id: e.target.value } })
                          }
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        >
                          <option value="">店舗</option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>{location.name}</option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={cur.start}
                          onChange={(e) => setTpl({ ...tpl, [d.key]: { ...cur, start: e.target.value } })}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <span className="text-gray-400">〜</span>
                        <input
                          type="time"
                          value={cur.end}
                          onChange={(e) => setTpl({ ...tpl, [d.key]: { ...cur, end: e.target.value } })}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">休み</span>
                    )}
                  </div>
                )
              })}
              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-100 mt-3">
                <label className="text-xs text-gray-600 flex items-center gap-2">
                  開始日
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </label>
                <label className="text-xs text-gray-600 flex items-center gap-2">
                  週数
                  <input
                    type="number"
                    value={weeks}
                    onChange={(e) => setWeeks(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-16 tabular-nums focus:outline-none focus:ring-2 focus:ring-green-500"
                    min={1}
                    max={52}
                  />
                </label>
                <button
                  onClick={generate}
                  disabled={generating}
                  className="ml-auto px-4 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {generating ? '生成中…' : '生成'}
                </button>
              </div>
            </div>
          </section>

          {/* 登録済みシフト */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold">登録済みシフト ({shifts.length} 日)</h2>
            </div>
            {loading ? (
              <div className="p-12 text-center text-sm text-gray-500">読み込み中…</div>
            ) : shifts.length === 0 ? (
              <div className="p-12 text-center text-sm text-gray-500">まだシフトがありません</div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">日付</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">店舗</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">開始</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">終了</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shifts.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm tabular-nums">{s.work_date}</td>
                        <td className="px-4 py-2 text-sm">{s.location_name ?? '未設定'}</td>
                        <td className="px-4 py-2 text-sm tabular-nums">{s.start_time}</td>
                        <td className="px-4 py-2 text-sm tabular-nums">{s.end_time}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => deleteShift(s.id)}
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
        </div>
      )}
    </div>
  )
}
