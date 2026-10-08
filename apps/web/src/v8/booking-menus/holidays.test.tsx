// @vitest-environment happy-dom
/*
 * 監査 WEB055/056：休業日のタブ。
 * - 056：31日より長い休みも、32日目から先を休みとして扱う（打ち切らない）
 * - 055：削除の失敗は、開いている削除の確認の中に出し、窓を閉じない
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingException, BookingSettings } from '@/lib/api'
import { closedOn, closedRanges, closedSpan } from './lib/closed-ranges'

const net = vi.hoisted(() => ({ deleteException: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, bookingApi: { ...actual.bookingApi, deleteException: net.deleteException } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

const { HolidaysTabV8 } = await import('./tabs/holidays-tab')

afterEach(() => { cleanup(); vi.clearAllMocks() })

const exception = (id: string, dateFrom: string, dateTo: string): BookingException => ({
  id, lineAccountId: 'a', scopeKind: 'store', scopeId: null, date: null, dateFrom, dateTo, kind: 'closed',
  intervals: [], reason: '改装', note: null, version: 1, createdAt: '', updatedAt: '',
})

describe('長い休み（WEB056）', () => {
  it('45日の休みの40日目も休み', () => {
    const ranges = closedRanges([exception('e1', '2026-12-01', '2027-01-14')])
    expect(closedOn(ranges, '2027-01-09')?.id).toBe('e1')
    expect(closedOn(ranges, '2027-01-15')).toBeUndefined()
    expect(closedSpan(ranges)).toEqual({ from: '2026-12-01', to: '2027-01-14' })
  })
})

describe('休業日の削除の失敗（WEB055）', () => {
  it('失敗の理由を削除の確認の中に出し、窓は開いたまま', async () => {
    const { ApiError } = await import('@/lib/api')
    net.deleteException.mockRejectedValue(new ApiError(500, 'down'))
    const item = exception('e1', '2026-10-20', '2026-10-20')
    const settings = { exceptions: [item] } as unknown as BookingSettings
    render(<HolidaysTabV8 accountId="a" settings={settings} status="ready" error={null} exceptions={[item]} closedWeekdays={[]} bookingCountOnClosed={0} canEdit onSaved={() => undefined} onReload={() => undefined} />)
    await act(async () => { screen.getByRole('button', { name: '削除' }).click() })
    await act(async () => { screen.getByRole('button', { name: '休業日を削除する' }).click() })
    await waitFor(() => expect(net.deleteException).toHaveBeenCalled())
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'))
    expect(dialog.textContent).toContain('削除')
    expect(dialog.textContent).toContain('休業日を消せませんでした')
  })
})
