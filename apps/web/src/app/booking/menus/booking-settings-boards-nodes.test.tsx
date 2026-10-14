// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ tab: 'menus', editable: true, narrow: false }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`tab=${state.tab}`),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccount: { liffId: 'test-liff' } }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/booking-menus/lib/edit-permission', () => ({ useBookingEdit: () => state.editable }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => state.narrow }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { ...actual.api.staff, list: async () => ({ data: [] }) } }, bookingApi: {
    ...actual.bookingApi,
    listMenus: async () => ({ menus: [] }),
    getSettings: async () => ({ success: true, data: { exceptions: [], businessHours: [], menuCount: 0 } }),
    listStaff: async () => ({ staff: [] }), listResources: async () => ({ resources: [] }),
    getAvailability: async () => ({ by_staff: [], closed_dates: [] }),
  } }
})
import Settings from '@/v8/booking-menus/settings'

afterEach(cleanup)
beforeEach(() => { state.tab = 'menus'; state.editable = true; state.narrow = false })
const draw = async () => { const result = render(<Settings accountId="a" />); await act(async () => { await Promise.resolve() }); return result }

describe('予約設定の板と、型が渡す権限・見本', () => {
  it('狭いメニューと受付枠はそれぞれP6EdLWとVFxWUの同じ作る型に入る', async () => {
    state.narrow = true
    const menus = await draw()
    expect(menus.container.querySelector('[data-page-template="create"][data-design-node="P6EdLW"]')).toBeTruthy()
    cleanup(); state.tab = 'hours'
    const hours = await draw()
    expect(hours.container.querySelector('[data-page-template="create"][data-design-node="VFxWU"]')).toBeTruthy()
  })

  it('閲覧のみはC9fv7Aの通知を出し、メニューを作る口を隠す', async () => {
    state.editable = false
    const { container } = await draw()
    await waitFor(() => expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy())
    expect(container.querySelector('[data-design-node="C9fv7A"]')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '予約メニューを作る' })).toBeNull()
    expect(screen.queryByRole('button', { name: /保存する/ })).toBeNull()
    cleanup(); state.editable = true
    await draw()
    await waitFor(() => expect(screen.getByRole('link', { name: '予約メニューを作る' })).toBeTruthy())
  })

  it('閲覧のみの受付枠には保存の帯を出さない', async () => {
    state.tab = 'hours'; state.editable = false
    const { container } = await draw()
    expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
    expect(container.querySelector('[data-template-region="footer"]')).toBeNull()
  })

  it('受付枠の見本を共通の窓で開き、実際のお客さま画面への入口も保つ', async () => {
    state.tab = 'hours'; state.narrow = true
    await draw()
    fireEvent.click(screen.getByRole('button', { name: 'LINEでの見え方を見る' }))
    const dialog = screen.getByRole('dialog', { name: 'お客さまの予約画面' })
    expect(dialog.textContent).toContain('お客さまに見える画面を確かめる')
    expect(dialog.querySelector('a')?.getAttribute('href')).toContain('test-liff')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
