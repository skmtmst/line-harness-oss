// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileBoard from './profile'
import type { GoogleProfileData } from '@/lib/restaurant-google-api'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), syncProfile: vi.fn(), role: 'owner' }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: mocks }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => mocks.role, canManageRole: (role: string) => role === 'owner' }))
const data = {
  stale: true, fetchedAt: '2026-10-10T00:00:00Z', closed: false,
  pendingChangeCount: 0, photoCount: 0, googleUpdates: null, holidays: [], timeZone: 'Asia/Tokyo',
  profile: { title: '試験用店舗', address: null, phone: null, websiteUri: null, regularHours: [], specialHours: [], description: null },
  today: { closed: true, periods: [], date: '2026-10-10', special: false, holidayName: null },
} as unknown as GoogleProfileData
function deferred() {
  let resolve!: (value: GoogleProfileData) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<GoogleProfileData>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(() => { vi.clearAllMocks(); mocks.role = 'owner'; mocks.profile.mockResolvedValue(data) })
afterEach(cleanup)

describe('Googleプロフィールの再取得（実Googleへ送らず保留APIで確認）', () => {
  for (const entry of ['もう一度取得', '同期する']) {
    it(`${entry}から始めた処理中は両入口が取得中・押せない。成功後は戻る`, async () => {
      const pending = deferred()
      mocks.syncProfile.mockReturnValue(pending.promise)
      render(<ProfileBoard accountId="busy-test" go={() => {}} />)
      const retry = await screen.findByRole('button', { name: 'もう一度取得' })
      const sync = screen.getByRole('button', { name: '同期する' })
      fireEvent.click(entry === '同期する' ? sync : retry)
      expect(screen.getAllByRole('button', { name: '取得中…' })).toHaveLength(2)
      for (const button of [retry, sync]) {
        expect(button).toHaveProperty('disabled', true)
        expect(button.getAttribute('aria-busy')).toBe('true')
        fireEvent.click(button)
      }
      expect(mocks.syncProfile).toHaveBeenCalledTimes(1)
      await act(async () => { pending.resolve(data) })
      expect(retry).toHaveProperty('disabled', false)
      expect(sync).toHaveProperty('disabled', false)
      expect(retry.getAttribute('aria-busy')).toBeNull()
    })
  }
  it('描画が更新される前に別の入口から要求されても1回だけ実行する', async () => {
    const pending = deferred()
    mocks.syncProfile.mockReturnValue(pending.promise)
    render(<ProfileBoard accountId="busy-test" go={() => {}} />)
    const retry = await screen.findByRole('button', { name: 'もう一度取得' })
    const sync = screen.getByRole('button', { name: '同期する' })
    act(() => { retry.click(); sync.click(); retry.click() })
    expect(mocks.syncProfile).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(data) })
  })
  it('失敗後も前回の情報を保ち、両入口から再試行できる', async () => {
    const pending = deferred()
    mocks.syncProfile.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...data, stale: false })
    render(<ProfileBoard accountId="busy-test" go={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'もう一度取得' }))
    await act(async () => { pending.reject(new Error('試験用の接続失敗')) })
    expect(screen.getByText('試験用店舗')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'もう一度取得' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: '同期する' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: '同期する' }))
    await screen.findByRole('button', { name: '同期する' })
    expect(mocks.syncProfile).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'もう一度取得' })).toBeNull()
  })
  it('閲覧のみでは店舗を変更する操作を出さない', async () => {
    mocks.role = 'viewer'
    render(<ProfileBoard accountId="busy-test" go={() => {}} />)
    await screen.findByText('試験用店舗')
    expect(screen.queryByRole('button', { name: 'プロフィールを編集' })).toBeNull()
    expect(screen.queryByRole('button', { name: '営業時間を変更' })).toBeNull()
    expect(screen.getByText(/閲覧のみです/)).toBeTruthy()
  })
})
