// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
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
vi.mock('@/v8/booking-menus/channels-tab', () => ({ default: () => <p>予約経路の内容</p> }))
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
    state.editable = false; verifiedStaffRole('viewer')
    const { container } = await draw()
    await waitFor(() => expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy())
    expect(container.querySelector('[data-design-node="C9fv7A"]')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '予約メニューを作る' })).toBeNull()
    expect(screen.queryByRole('button', { name: /保存する/ })).toBeNull()
    cleanup(); state.editable = true; verifiedStaffRole('owner')
    await draw()
    await waitFor(() => expect(screen.getByRole('link', { name: '予約メニューを作る' })).toBeTruthy())
  })

  it('閲覧のみの受付枠には保存の帯を出さない', async () => {
    state.tab = 'hours'; state.editable = false; verifiedStaffRole('viewer')
    const { container } = await draw()
    expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
    expect(container.querySelector('[data-template-region="footer"]')).toBeNull()
  })

  it('受付枠の見本を共通の窓で開き、実際のお客さま画面への入口も保つ', async () => {
    state.tab = 'hours'; state.narrow = true
    await draw()
    expect(screen.getAllByRole('link', { name: 'お客さまに見える画面を確かめる' }).some(link => !link.closest('[role="dialog"]'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'LINEでの見え方を見る' }))
    const dialog = screen.getByRole('dialog', { name: 'お客さまの予約画面' })
    expect(dialog.textContent).toContain('お客さまに見える画面を確かめる')
    expect(dialog.querySelector('a')?.getAttribute('href')).toContain('test-liff')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

afterEach(() => { verifiedStaffRole(null) })

it('予約経路の常設説明は題横の説明から読めて、別のタブには混ぜない', async () => {
  state.tab = 'channels'
  await draw()
  expect(screen.getByText('予約経路の内容')).toBeTruthy()
  expect(screen.queryByText(/いちばん確かなのは/)).toBeNull()
  const help = screen.getByRole('button', { name: '画面の説明' })
  expect(help.closest('header')?.contains(screen.getByRole('heading', { name: '予約設定' }))).toBe(true)
  fireEvent.click(help)
  await waitFor(() => expect(document.getElementById(help.getAttribute('aria-describedby')!)).toHaveProperty('textContent', expect.stringContaining('スタッフの Google カレンダー')))
  expect(document.getElementById(help.getAttribute('aria-describedby')!)).toHaveProperty('textContent', expect.stringContaining('Google カレンダーに書き出せない入り口は、予約通知メールを取り込みアドレスへ転送して読み取ります（見本のメールがそろった媒体から順に）。'))
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(help.getAttribute('aria-expanded')).toBe('false'))
  cleanup(); state.tab = 'hours'; await draw()
  const otherHelp = screen.getByRole('button', { name: '画面の説明' })
  fireEvent.click(otherHelp)
  expect(document.getElementById(otherHelp.getAttribute('aria-describedby')!)).not.toHaveProperty('textContent', expect.stringContaining('いちばん確かなのは'))
})
