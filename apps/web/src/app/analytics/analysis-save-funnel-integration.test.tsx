// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ list: vi.fn(), latestRun: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: {
  conversions: { definitions: async () => ({ success: true, data: { items: [] } }) },
  tags: { list: async () => ({ success: true, data: [] }) },
  forms: { list: async () => ({ success: true, data: [] }) },
  analytics: { v6Funnels: { list: net.list, latestRun: net.latestRun }, saved: { create: vi.fn() } },
} }))
vi.mock('@/v8/analytics/analytics', async () => {
  const { default: Funnel } = await import('@/v8/analytics/funnel')
  return { default: ({ slots }: { slots: { renderSave: (props: unknown) => React.ReactNode; renderFunnelForm: (props: unknown) => React.ReactNode } }) => <Funnel accountId="a" canManage renderSave={props => slots.renderSave({ ...props, accountId: 'a', sourceKind: 'funnel' })} renderForm={props => slots.renderFunnelForm({ ...props, accountId: 'a' })} /> }
})
import AnalyticsPage from './page'
beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState(null, '', '/analytics?tab=funnel')
  net.list.mockResolvedValue({ success: true, data: [{ id: 'flow', name: '購入まで', status: 'active', windowDays: 30, currentVersion: { id: 'v1', versionNumber: 1 } }] })
  net.latestRun.mockResolvedValue({ success: true, data: { runId: 'run-1', state: 'available', stateReason: null, groups: [], cohortFrom: '2026-10-01', cohortTo: '2026-10-31', dataCutoffAt: '2026-10-31', versionNumber: 1 } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('保存名を入力中にファネルを作ると確認し、続行で保持・破棄で窓を開く', async () => {
  render(<AnalyticsPage />)
  fireEvent.click(await screen.findByText('この結果を保存する'))
  fireEvent.click(await screen.findByRole('button', { name: 'この分析を保存' }))
  fireEvent.change(screen.getByLabelText('保存する分析名'), { target: { value: '入力途中の分析名' } })
  fireEvent.click(screen.getByRole('button', { name: 'ファネルを作る' }))
  let leave = screen.getByRole('dialog', { name: '保存していない変更があります' })
  expect(screen.queryByRole('dialog', { name: 'ファネルを作る' })).toBeNull()
  fireEvent.click(within(leave).getByRole('button', { name: '編集を続ける' }))
  expect(screen.getByLabelText('保存する分析名')).toHaveProperty('value', '入力途中の分析名')
  fireEvent.click(screen.getByRole('button', { name: 'ファネルを作る' }))
  leave = screen.getByRole('dialog', { name: '保存していない変更があります' })
  fireEvent.click(within(leave).getByRole('button', { name: '保存せずに移る' }))
  expect(await screen.findByRole('dialog', { name: 'ファネルを作る' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
})
