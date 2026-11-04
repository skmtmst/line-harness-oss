// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    adPlatforms: { list: async () => ({ success: true, data: [] }) },
    adCosts: { list: async () => ({ success: true, data: { rows: [], platforms: [], manualEntries: [{ id: 'cost1', sourceLabel: '看板', day: '2026-10-01', amountMinor: 100, currency: 'JPY', createdAt: '2026-10-01T00:00:00Z', cancelledAt: null }] } }) },
    entryRoutes: { list: async () => ({ success: true, data: [] }) },
  } }
})
import Ads from './ads'
afterEach(cleanup)
it('広告費の入力中は移動前に確認する', async () => {
  window.history.replaceState(null, '', '/inflow-links/ads')
  render(<><Ads /><a href="/events">イベントへ</a></>)
  fireEvent.click(await screen.findByRole('button', { name: '費用を手で入れる' }))
  fireEvent.change(screen.getByLabelText('流入元の名前'), { target: { value: '看板' } })
  fireEvent.click(screen.getByRole('link', { name: 'イベントへ' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
})
it('広告費の取り消し理由の入力中は移動前に確認する', async () => {
  window.history.replaceState(null, '', '/inflow-links/ads')
  render(<><Ads /><a href="/events">イベントへ</a></>)
  fireEvent.click(await screen.findByRole('button', { name: /看板の操作/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '取り消す' }))
  fireEvent.change(screen.getByLabelText('取り消す理由'), { target: { value: '金額を間違えた' } })
  fireEvent.click(screen.getByRole('link', { name: 'イベントへ' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
})
