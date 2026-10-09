// @vitest-environment happy-dom
/* B-139：開ける時間。保存で落ちた区間の時刻の欄が赤くなり、その欄へ移る（理由は表の下）。 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
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

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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
