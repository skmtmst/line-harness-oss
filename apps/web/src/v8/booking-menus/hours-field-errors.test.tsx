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
import type { StaffMember } from '@line-crm/shared'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import { expectPermissionLocked } from '@/test-utils/permission-locked-control'

afterEach(() => { cleanup(); forgetStaffIdentity(); vi.unstubAllGlobals(); saveSettings.mockClear() })

it('7曜日を設定のスイッチで切り替え、休みと開ける時間を同じ保存口へ送る', async () => {
  saveSettings.mockClear()
  const settings = { version: 3, timeZone: 'Asia/Tokyo', bookingWindowDays: 30, cutoffMinutesBefore: 60, businessHoursConfigured: true, exceptions: [], businessHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00', capacity: 1 }] }] } as unknown as BookingSettings
  saveSettings.mockResolvedValue({ success: true, data: settings })
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [], staff: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  const props = { accountId: 'a', settings, settingsStatus: 'ready' as const, settingsError: null, resources: [], resourcesStatus: 'ready' as const, resourcesError: null, canEdit: true, menus: [], onSaved: () => {}, onReload: () => {}, onResourceSaved: () => {}, onResourceCreated: () => {}, onResourceDeleted: () => {}, onResourcesRetry: () => {} }
  const { rerender } = render(<HoursTabV8 {...props} />)
  expect(screen.queryByText('1〜1000')).toBeNull()
  expect(screen.getByLabelText('月曜日の開始時刻（1区間目）').parentElement?.querySelector('button')).toBeNull()
  // スイッチを切り替えても、保存するまでは設定のAPIを呼ばない。
  expect(screen.getAllByRole('switch', { name: /曜日を開ける/ })).toHaveLength(7)
  fireEvent.click(screen.getByRole('switch', { name: '月曜日を開ける' }))
  expect(screen.getByRole('switch', { name: '月曜日を開ける' }).getAttribute('aria-checked')).toBe('false')
  await act(async () => { await tab.onSave!() })
  expect(saveSettings.mock.calls[0][1].businessHours.find((day: { weekday: number }) => day.weekday === 1).intervals).toEqual([])
  fireEvent.click(screen.getByRole('switch', { name: '月曜日を開ける' }))
  await act(async () => { await tab.onSave!() })
  expect(saveSettings.mock.calls[1][1].businessHours.find((day: { weekday: number }) => day.weekday === 1).intervals).toEqual([{ start: '09:00', end: '18:00', capacity: 1 }])
  act(() => rememberStaffIdentity({ id: 'viewer', role: 'viewer' } as StaffMember))
  rerender(<HoursTabV8 {...props} canEdit={false} />)
  expect(screen.getAllByRole('switch')).toHaveLength(7)
  for (const control of screen.getAllByRole('switch')) await expectPermissionLocked(control)
  await act(async () => { await tab.onSave!() })
  expect(saveSettings).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('switch', { name: '月曜日を開ける' }).getAttribute('aria-checked')).toBe('true')
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

it('複数曜日へ確認後だけ写し、休みと元の値を保ち、保存前にはAPIを呼ばない', async () => {
  const original = [{ start: '09:00', end: '12:00', capacity: 2 }, { start: '13:00', end: '18:00', capacity: 3 }]
  const settings = { version: 3, businessHoursConfigured: true, exceptions: [], businessHours: [
    { weekday: 1, intervals: original },
    { weekday: 2, intervals: [{ start: '10:00', end: '11:00', capacity: 1 }] },
    { weekday: 3, intervals: [{ start: '10:00', end: '11:00', capacity: 1 }] },
  ] } as unknown as BookingSettings
  saveSettings.mockResolvedValue({ success: true, data: settings })
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [], staff: [] }), { headers: { 'Content-Type': 'application/json' } }))
  render(<HoursTabV8 accountId="a" settings={settings} settingsStatus="ready" settingsError={null} resources={[]} resourcesStatus="ready" resourcesError={null} canEdit menus={[]} onSaved={() => {}} onReload={() => {}} onResourceSaved={() => {}} onResourceCreated={() => {}} onResourceDeleted={() => {}} onResourcesRetry={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '月曜日の時間をほかの曜日に写す' }))
  expect(screen.queryByRole('checkbox', { name: '日曜日', exact: true })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: '火曜日', exact: true }))
  fireEvent.click(screen.getByRole('checkbox', { name: '水曜日', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '上書きする曜日を確認する' }))
  expect(screen.getByText(/火曜日・水曜日に写します/)).toBeTruthy()
  expect(saveSettings).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル', exact: true }))
  expect((screen.getByLabelText('火曜日の開始時刻（1区間目）') as HTMLInputElement).value.replace(/\s/g, '')).toBe('10:00')
  fireEvent.click(screen.getByRole('button', { name: '上書きする曜日を確認する' }))
  fireEvent.click(screen.getByRole('button', { name: '選んだ曜日に写す' }))
  expect(saveSettings).not.toHaveBeenCalled()
  expect((screen.getByLabelText('火曜日の開始時刻（2区間目）') as HTMLInputElement).value.replace(/\s/g, '')).toBe('13:00')
  expect(screen.getByRole('switch', { name: '日曜日を開ける' }).getAttribute('aria-checked')).toBe('false')
  await act(async () => { await tab.onSave!() })
  const sent = saveSettings.mock.calls[0][1].businessHours
  expect(sent.find((day: { weekday: number }) => day.weekday === 2).intervals).toEqual(original)
  expect(sent.find((day: { weekday: number }) => day.weekday === 3).intervals).toEqual(original)
  expect(sent.find((day: { weekday: number }) => day.weekday === 0).intervals).toEqual([])
  expect(settings.businessHours[1].intervals[0].start).toBe('10:00')
})
