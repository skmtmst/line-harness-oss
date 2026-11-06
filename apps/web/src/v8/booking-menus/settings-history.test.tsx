// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./lib/edit-permission', () => ({ useBookingEdit: () => true }))
vi.mock('./tabs/menus-tab', async () => {
  const { useV8TabEdit } = await import('./tabs/shared')
  return { MenusTabV8: () => { useV8TabEdit({ dirty: true, saving: false, subject: '書きかけ', onSave: () => {}, onReset: () => {} }); return <p>編集中</p> } }
})
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { ...actual.api.staff, list: async () => ({ success: true, data: [] }) } }, bookingApi: { ...actual.bookingApi, listMenus: async () => ({ menus: [] }), getSettings: async () => ({ settings: null }), listStaff: async () => ({ staff: [] }) } }
})
import Settings from './settings'
afterEach(cleanup)
it('予約設定のタブ切替は履歴を増やさない', () => {
  render(<Settings accountId={null} />)
  fireEvent.click(screen.getByRole('tab', { name: '受付枠' }))
  expect(router.replace).toHaveBeenCalledWith('/booking/menus?tab=hours')
  expect(router.push).not.toHaveBeenCalled()
})

it('書きかけを捨てる確認後のタブ切替も履歴を置き換える', async () => {
  router.push.mockClear(); router.replace.mockClear()
  render(<Settings accountId="a" />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('tab', { name: '受付枠' }))
  expect(router.replace).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '捨てて移る' }))
  expect(router.replace).toHaveBeenCalledWith('/booking/menus?tab=hours')
  expect(router.push).not.toHaveBeenCalled()
})
