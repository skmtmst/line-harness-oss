// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ stats: vi.fn(), list: vi.fn(), detectFriendDuplicates: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, duplicates: { stats: net.stats }, identityCandidates: net } }
})
vi.mock('@/components/shared/list-url-state', async original => {
  const actual = await original<typeof import('@/components/shared/list-url-state')>()
  const React = await import('react')
  return { ...actual, useListLocation: () => null, useListUrlValue: (_key: string, initial: unknown) => React.useState(initial) }
})
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => ({ id: 'staff-test' }) }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
import DuplicatesList from './list'

const stats = (overlappingDeliveryCount?: number | null) => ({ success: true, data: {
  totalFollowing: 100, uniquePeople: 90, friendDups: 10, duplicateGroups: 5,
  wastedPerBroadcastYen: 30, msgUnitYen: 3, perAccount: [], overlappingDeliveryCount,
} })
function metric() {
  const label = screen.getByRole('button', { name: '重なって届いた配信の説明' })
  return label.closest('[data-kpi-presentation]')! as HTMLElement
}
beforeEach(() => {
  net.stats.mockReset(); net.list.mockReset(); net.detectFriendDuplicates.mockReset()
  net.list.mockResolvedValue({ success: true, data: { items: [], total: 0, statusCounts: {}, lowConfidenceCount: 0 } })
  net.detectFriendDuplicates.mockResolvedValue({ success: true })
})
afterEach(cleanup)

it.each([1200, 0])('既存GETの余分な実通数%sを人数や金額で代用せず表示する', async count => {
  net.stats.mockResolvedValue(stats(count))
  render(<DuplicatesList />)
  await waitFor(() => expect(within(metric()).getByText(count.toLocaleString('ja-JP'), { exact: true })).toBeTruthy())
  expect(metric().textContent).toContain('通')
  expect(metric().textContent).toContain('配信実績から集計')
  expect(metric().textContent).not.toContain('接続を待っています')
  fireEvent.click(screen.getByRole('button', { name: '重なって届いた配信の説明' }))
  expect(screen.getByText(/1人分を除いた余分な通数/)).toBeTruthy()
})

it.each([null, undefined])('取得不能・旧Worker省略(%s)を0通へ変換しない', async count => {
  net.stats.mockResolvedValue(stats(count))
  render(<DuplicatesList />)
  await screen.findByText('配信実績は未取得です')
  expect(within(metric()).getByText('—', { exact: true })).toBeTruthy()
  expect(within(metric()).queryByText('0', { exact: true })).toBeNull()
})

it('集計失敗は実績未取得とし、既存の再試行で実通数を復元する', async () => {
  net.stats.mockRejectedValueOnce({ status: 503 }).mockResolvedValue(stats(7))
  render(<DuplicatesList />)
  await screen.findByText('配信実績は未取得です')
  expect(within(metric()).getByText('—', { exact: true })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度', exact: true }))
  await waitFor(() => expect(within(metric()).getByText('7', { exact: true })).toBeTruthy())
  expect(net.stats).toHaveBeenCalledTimes(2)
  expect(net.list).toHaveBeenCalledTimes(2)
})

it('読込済み実績の後に403となっても古い通数を表示しない', async () => {
  net.stats.mockResolvedValueOnce(stats(12)).mockRejectedValue({ status: 403 })
  render(<DuplicatesList />)
  await waitFor(() => expect(within(metric()).getByText('12', { exact: true })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'もう一度見直す' }))
  await waitFor(() => expect(metric().textContent).toContain('集計を見る権限がありません'))
  expect(within(metric()).getByText('—', { exact: true })).toBeTruthy()
  expect(within(metric()).queryByText('12', { exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: 'もう一度', exact: true })).toBeNull()
})

it('一時失敗で残る取得済み通数は前回実績と明示し再試行できる', async () => {
  net.stats.mockResolvedValueOnce(stats(4)).mockRejectedValueOnce({ status: 503 }).mockResolvedValue(stats(9))
  render(<DuplicatesList />)
  await waitFor(() => expect(within(metric()).getByText('4', { exact: true })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'もう一度見直す' }))
  await screen.findByText('前回取得した配信実績')
  expect(within(metric()).getByText('4', { exact: true })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度', exact: true }))
  await waitFor(() => expect(within(metric()).getByText('9', { exact: true })).toBeTruthy())
})
