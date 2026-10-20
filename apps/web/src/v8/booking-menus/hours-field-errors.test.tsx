// @vitest-environment happy-dom
/* ：開ける時間。保存で落ちた区間の時刻の欄が赤くなり、その欄へ移る（理由は表の下）。 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const tab = vi.hoisted(() => ({ onSave: null as null | (() => void) }))
const saveSettings = vi.hoisted(() => vi.fn())
vi.mock('./tabs/shared', async (importOriginal: () => Promise<typeof import('./tabs/shared')>) => {
  const actual = await importOriginal()
  return { ...actual, useV8TabEdit: (options: { onSave: () => void }) => { tab.onSave = options.onSave } }
})
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, bookingApi: { ...actual.bookingApi, saveSettings } }
})

import { HoursTabV8 } from './tabs/hours-tab'
import type { BookingSettings } from '@/lib/api'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); saveSettings.mockClear() })

it('7曜日を継続設定のスイッチで切り替え、休みと開ける時間を同じ保存口へ送る', async () => {
  saveSettings.mockClear()
  const settings = { version: 3, timeZone: 'Asia/Tokyo', bookingWindowDays: 30, cutoffMinutesBefore: 60, businessHoursConfigured: true, exceptions: [], businessHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00', capacity: 1 }] }] } as unknown as BookingSettings
  saveSettings.mockResolvedValue({ success: true, data: settings })
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [], staff: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  const props = { accountId: 'a', settings, settingsStatus: 'ready' as const, settingsError: null, resources: [], resourcesStatus: 'ready' as const, resourcesError: null, canEdit: true, menus: [], onSaved: () => {}, onReload: () => {}, onResourceSaved: () => {}, onResourceCreated: () => {}, onResourceDeleted: () => {}, onResourcesRetry: () => {} }
  const { rerender } = render(<HoursTabV8 {...props} />)
  expect(screen.queryByText('1〜1000')).toBeNull()
  expect(screen.getByLabelText('月曜日の開始時刻（1区間目）').parentElement?.querySelector('button')).toBeNull()
  // 曜日の入り切りは保存してから効くのでチェック（決まり14・絵 ）。スイッチは置かない。
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  expect(screen.getAllByRole('checkbox', { name: /曜日を開ける/ })).toHaveLength(7)
  fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を開ける' }))
  expect((screen.getByRole('checkbox', { name: '月曜日を開ける' }) as HTMLInputElement).checked).toBe(false)
  await act(async () => { await tab.onSave!() })
  expect(saveSettings.mock.calls[0][1].businessHours.find((day: { weekday: number }) => day.weekday === 1).intervals).toEqual([])
  fireEvent.click(screen.getByRole('checkbox', { name: '月曜日を開ける' }))
  await act(async () => { await tab.onSave!() })
  expect(saveSettings.mock.calls[1][1].businessHours.find((day: { weekday: number }) => day.weekday === 1).intervals).toEqual([{ start: '09:00', end: '18:00', capacity: 1 }])
  rerender(<HoursTabV8 {...props} canEdit={false} />)
  expect(screen.queryByRole('switch')).toBeNull()
})

it('行の注記を畳んでも受付数の範囲外を保存せず、欄へ理由をつなぐ', async () => {
  const settings = { version: 3, businessHoursConfigured: true, exceptions: [], businessHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00', capacity: 1 }] }] } as unknown as BookingSettings
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [], staff: [] }), { headers: { 'Content-Type': 'application/json' } }))
  render(<HoursTabV8 accountId="a" settings={settings} settingsStatus="ready" settingsError={null} resources={[]} resourcesStatus="ready" resourcesError={null} canEdit menus={[]} onSaved={() => {}} onReload={() => {}} onResourceSaved={() => {}} onResourceCreated={() => {}} onResourceDeleted={() => {}} onResourcesRetry={() => {}} />)
  const capacity = screen.getByLabelText('月曜日の同時受付数（1区間目）')
  fireEvent.change(capacity, { target: { value: '1001' } })
  await act(async () => { await tab.onSave!() })
  expect(saveSettings).not.toHaveBeenCalled()
  expect(capacity.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('同時に受け付ける数は1〜1000件で入力してください。')).toBeTruthy()
})

it('月曜の1区間目が逆さまなら送らず、開始・終了の欄を赤くし、終了の欄へ移る', async () => {
  const settings = {
    version: 3, timeZone: 'Asia/Tokyo', bookingWindowDays: 30, cutoffMinutesBefore: 60, businessHoursConfigured: true, exceptions: [],
    businessHours: [{ weekday: 1, intervals: [{ start: '18:00', end: '09:00', capacity: 1 }] }],
  } as unknown as BookingSettings
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [], staff: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<HoursTabV8 accountId="a" settings={settings} settingsStatus="ready" settingsError={null} resources={[]} resourcesStatus="ready" resourcesError={null} canEdit menus={[]} onSaved={() => {}} onReload={() => {}} onResourceSaved={() => {}} onResourceCreated={() => {}} onResourceDeleted={() => {}} onResourcesRetry={() => {}} />)
  await act(async () => { tab.onSave!() })
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(saveSettings).not.toHaveBeenCalled()
  const end = screen.getByLabelText('月曜日の終了時刻（1区間目）')
  expect(end.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByLabelText('月曜日の開始時刻（1区間目）').getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(end)
  expect(screen.getByText(/終了は同じ日の開始より後に/)).toBeTruthy()
})
