// @vitest-environment happy-dom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import ListView from './list'

const fixture = vi.hoisted(() => ({
  allPages: vi.fn(),
  board: null as null | { loadPrintEntries: () => Promise<Array<{ status: string }>>; printContext: string },
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account' }) }))
vi.mock('@/lib/api/helpers/reservation-board', () => ({
  reservationBoardApi: { floors: async () => ({ data: [] }) },
  allBoardPages: fixture.allPages,
}))
vi.mock('@/components/shared/reservation-board', () => ({ default: (props: NonNullable<typeof fixture.board>) => {
  fixture.board = props
  return <div />
} }))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T03:00:00Z'))
  fixture.allPages.mockReset().mockResolvedValue([{ status: 'confirmed' }, { status: 'cancelled' }])
})
afterEach(() => { cleanup(); vi.useRealTimers(); fixture.board = null })

it.each([
  ['upcoming', '2026-10-13T15:00:00.000Z', '2100-01-01T00:00:00Z', '今後の予約'],
  ['past', '1970-01-01T00:00:00Z', '2026-10-13T15:00:00.000Z', '過去の予約'],
  ['all', '1970-01-01T00:00:00Z', '2100-01-01T00:00:00Z', 'すべての予約'],
])('印刷も画面の期間 %s・状態・店舗を使って全ページを読む', async (period, from, to, label) => {
  render(<ListView view="list" rows={[]} total={0} tables={[]} page={1} period={period} status="confirmed"
    busy={false} canWrite={false} canImport={false} day={new Date()} storeId="store" storeName="試験店"
    onView={vi.fn()} onPeriod={vi.fn()} onStatus={vi.fn()} onPage={vi.fn()} onImport={vi.fn()}
    onCreate={vi.fn()} onEdit={vi.fn()} onOpen={vi.fn()} onCancel={vi.fn()} onRestore={vi.fn()} />)
  expect(await fixture.board!.loadPrintEntries()).toEqual([{ status: 'confirmed' }])
  expect(fixture.allPages).toHaveBeenCalledWith('seats', 'account', from, to, 'store')
  expect(fixture.board!.printContext).toContain(label)
})
