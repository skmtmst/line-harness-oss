// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ list: vi.fn(), latestRun: vi.fn(), setStatus: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ api: { analytics: { v6Funnels: net } } }))
vi.mock('./parts', () => ({ RANGES: [{days:30,label:'過去30日'}], downloadCsv: vi.fn(), formatAnalyticsDate: vi.fn(), formatAnalyticsDateTime: vi.fn(), rangeFor: vi.fn(), useRegisterExport: vi.fn() }))
import FunnelV8 from './funnel'

const funnel = { id: 'flow', name: '購入まで', status: 'active', windowDays: 30, migrationState: 'ready', currentVersion: { id: 'v1', versionNumber: 1 } }
beforeEach(() => {
  net.list.mockReset().mockResolvedValue({ success: true, data: [funnel] })
  net.latestRun.mockReset().mockResolvedValue({ success: false, error: 'Not found' })
  net.setStatus.mockReset().mockResolvedValue({ success: true })
})
afterEach(cleanup)

it('削除は確認後に保管し、過去の結果を残して選ぶ一覧から外す', async () => {
  render(<FunnelV8 accountId="a" canManage />)
  fireEvent.click(await screen.findByText('定義の操作と集計の詳細', { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '削除する', exact: true }))
  expect(net.setStatus).not.toHaveBeenCalled()
  const dialog = screen.getByRole('alertdialog')
  expect(dialog.textContent).toContain('過去の結果は残ります')
  net.list.mockResolvedValue({ success: true, data: [{ ...funnel, status: 'archived' }] })
  fireEvent.click(within(dialog).getByRole('button', { name: '削除する', exact: true }))
  await waitFor(() => expect(net.setStatus).toHaveBeenCalledWith('a', 'flow', { status: 'archived', expectedStatus: 'active' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('button', { name: '結果を見る' })).toBeTruthy()
})

it('競合時は確認窓と理由を残し、キャンセルでは呼ばない', async () => {
  net.setStatus.mockResolvedValue({ success: false, error: 'analytics_funnel_status_conflict' })
  render(<FunnelV8 accountId="a" canManage />)
  fireEvent.click(await screen.findByText('定義の操作と集計の詳細', { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '削除する', exact: true }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '削除する', exact: true }))
  await waitFor(() => expect(screen.getByRole('alertdialog').textContent).toContain('他の人が先に変更'))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセル' }))
  expect(net.setStatus).toHaveBeenCalledTimes(1)
})

it('閲覧のみには削除の操作を出さない', async () => {
  render(<FunnelV8 accountId="a" canManage={false} />)
  fireEvent.click(await screen.findByText('定義の操作と集計の詳細', { exact: true }))
  expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
})
