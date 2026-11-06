// @vitest-environment happy-dom
/*
 * 成果地点の一覧の「使う場所を足す」から来たとき、分析はクエリの成果地点をファネルの作る欄へ渡す。
 * 受け取った作る欄が成果の段へ入れることは funnel-form-react.test.tsx が守る。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UNSAVED_ACTION_EVENT } from '@/lib/unsaved-action'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
const state = vi.hoisted(() => ({ query: '', funnelProps: [] as Array<Record<string, unknown>>, list: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/analytics',
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => ({ ...(await importOriginal()), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { analytics: { v6Funnels: { list: state.list, latestRun: vi.fn(async () => ({ success: false, error: 'Not found' })) } } } }))
vi.mock('@/components/shared/list-navigation', async (importOriginal: () => Promise<typeof import('@/components/shared/list-navigation')>) => ({ ...(await importOriginal()), useListNavigationRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/shared/period-picker', () => ({ default: () => null, useReportPeriod: () => ({ days: 30, setDays: vi.fn(), customRange: null, setRange: vi.fn() }) }))

beforeEach(() => {
  state.query = ''
  state.funnelProps.length = 0
  state.list.mockReset().mockResolvedValue({ success: true, data: [] })
})
afterEach(cleanup)

it('分析はクエリの成果地点のIDと名前をファネルへ渡す', async () => {
  vi.doMock('./funnel', () => ({ default: (props: Record<string, unknown>) => { state.funnelProps.push(props); return null } }))
  vi.resetModules()
  const { default: AnalyticsV8 } = await import('./analytics')
  state.query = `tab=funnel&conversionPointId=cp-1&conversionPointName=${encodeURIComponent('商品を買った')}`
  render(<AnalyticsV8 />)
  await waitFor(() => expect(state.funnelProps.at(-1)?.presetConversion).toEqual({ id: 'cp-1', name: '商品を買った' }))
  cleanup()
  state.query = 'tab=funnel'
  render(<AnalyticsV8 />)
  await waitFor(() => expect(state.funnelProps.at(-1)?.presetConversion).toBeNull())
  vi.doUnmock('./funnel')
  vi.resetModules()
})

it('ファネルは渡された成果地点で作る欄を開き、そのまま作る欄へ渡す。変えられない人には開かない', async () => {
  const { default: FunnelV8 } = await import('./funnel')
  const renderForm = vi.fn(() => <p>作る欄</p>)
  render(<FunnelV8 accountId="account-a" canManage presetConversion={{ id: 'cp-1', name: '商品を買った' }} renderForm={renderForm} />)
  expect(await screen.findByText('作る欄')).toBeTruthy()
  expect(renderForm).toHaveBeenLastCalledWith(expect.objectContaining({ presetConversion: { id: 'cp-1', name: '商品を買った' } }))
  cleanup()
  renderForm.mockClear()
  render(<FunnelV8 accountId="account-a" canManage={false} presetConversion={{ id: 'cp-1', name: '商品を買った' }} renderForm={renderForm} />)
  await waitFor(() => expect(state.list).toHaveBeenCalled())
  expect(screen.queryByText('作る欄')).toBeNull()
})

it('作る欄を開く前に画面内の未保存操作を確かめる', async () => {
  const { default: FunnelV8 } = await import('./funnel')
  const listener = vi.fn((event: Event) => event.preventDefault())
  window.addEventListener(UNSAVED_ACTION_EVENT, listener)
  try {
    render(<FunnelV8 accountId="account-a" canManage renderForm={() => <p>作る欄</p>} />)
    fireEvent.click(await screen.findByRole('button', { name: 'ファネルを作る' }))
    expect(listener).toHaveBeenCalledOnce()
    expect(screen.queryByText('作る欄')).toBeNull()
  } finally { window.removeEventListener(UNSAVED_ACTION_EVENT, listener) }
})
