// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoursEditor } from '@/v8/restaurant/google/profile-hours'

const weekly = Object.fromEntries(['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map(day => [day, [{ open: '11:00', close: '22:00' }]]))
const profile = { store: { name: '対象店舗' }, aiAvailable: true, closed: false, timeZone: 'Asia/Tokyo', today: { date: '2026-10-11', weekday: 'SUNDAY' }, profile: { title: '対象店舗', regularHours: weekly, specialHours: [] } }

vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: { profile: async () => profile } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

afterEach(cleanup)

describe('曜日別営業時間のスマホ表示（R109）', () => {
  it('曜日ごとに縦並びにし、時刻の欄を全幅で並べる', async () => {
    render(<HoursEditor accountId="account-1" mode="weekly" go={() => {}} />)
    const monday = await screen.findByRole('region', { name: '月曜の営業時間' })
    expect(within(monday).getAllByRole('button').length).toBeGreaterThan(0)
    expect(within(monday).getByRole('button', { name: '月曜 枠1の開始' })).toBeTruthy()
    expect(within(monday).getByRole('button', { name: '月曜 枠1の終了' })).toBeTruthy()
  })
})
