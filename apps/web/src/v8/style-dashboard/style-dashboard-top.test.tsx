// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StyleSchedule, StyleSnapshot } from '@line-crm/shared'

const state = vi.hoisted(() => ({ account: 'a', role: 'admin', get: vi.fn(), save: vi.fn(), reset: vi.fn(), summary: vi.fn(), schedule: vi.fn() }))
const firstRun = vi.hoisted(() => ({ steps: [] as unknown[] }))
vi.mock('@/v8/onboarding/public/use-first-run/index', () => ({ useFirstRun: () => ({ status: 'ready', steps: firstRun.steps, firstRun: null, starter: null, error: null, reload: vi.fn(), watchExpired: false, rewatch: vi.fn() }) }))
vi.mock('@/v8/onboarding/public/style-setup-progress/index', () => ({ useStyleSetupProgress: (_id: string, style: string) => ({ progress: { style, steps: {} }, reload: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account }) }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => state.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/restaurant/dashboard/public/use-store-today/index', () => ({ useStoreToday: () => ({}) }))
vi.mock('@/components/shared/preparing-dialog', () => ({ PREPARING_TITLE: 'preparing', usePreparingDialog: () => ({ open: vi.fn(), dialog: null }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { summary: state.summary, schedule: state.schedule, get: state.get, saveCards: state.save, resetCards: state.reset } }))
vi.mock('@/lib/api', async importOriginal => { const actual = await importOriginal<typeof import('@/lib/api')>(); return { ...actual, bookingApi: { ...actual.bookingApi, getPaymentConfig: vi.fn().mockResolvedValue({ data: {} }) } } })

import StyleDashboard from './style-dashboard'
import { buildStepsFromApi } from '@/v8/settings/getting-started/steps'

const metric = (value: number, unit = '件') => ({ value, status: 'available' as const, unit, formula: '選択した期間の実集計' })
const snapshot: StyleSnapshot = { style: 'restaurant', from: '2026-10-29T15:00:00Z', to: '2026-10-30T15:00:00Z', timeZone: 'Asia/Tokyo', asOf: '2026-10-30T05:00:00Z', dateBasis: 'visit', range: 'today', metrics: { bookings: metric(4), guests: metric(23, '人'), firstTime: metric(2), regular: metric(3), unseated: metric(1), mediaCloseTasks: metric(2), attention: metric(3), freeTables: metric(5, '卓'), noShowRate: metric(0.05, '%') }, previous: {}, items: [], newBookings: [], resultId: 'real' }
const schedule: StyleSchedule = { style: 'restaurant', from: snapshot.from, to: snapshot.to, timeZone: snapshot.timeZone, asOf: snapshot.asOf, range: 'today', display: 'list', calendarView: 'day', entries: [], columns: [], days: [], closures: [], availability: { status: 'available', reason: null, resources: [], slots: [], closedDates: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'admin'
  firstRun.steps = buildStepsFromApi(['accounts', 'featureSet', 'attributes', 'friendAdd', 'scenario', 'firstMessage'].map(key => ({ key, state: 'todo', href: '/getting-started', reason: null })) as Parameters<typeof buildStepsFromApi>[0])
  state.get.mockResolvedValue({ data: { cards: [], version: 2, metricIds: ['bookings', 'attention', 'freeTables', 'noShowRate', 'newBookings'] } })
  state.summary.mockResolvedValue({ data: snapshot })
  state.schedule.mockResolvedValue({ success: true, data: schedule })
})
afterEach(cleanup)

it('上の段を軽くするため読み直しは文字の押し口にする', async () => {
  render(<StyleDashboard style="restaurant" />)
  const reload = await screen.findByRole('button', { name: '読み直す' })
  expect(reload.getAttribute('data-variant')).toBe('text')
})

it('探す欄は正の包みで220pxの幅を保つ', async () => {
  render(<StyleDashboard style="restaurant" />)
  const input = await screen.findByPlaceholderText('名前・タグ・メモで探す')
  expect(input.closest('[data-toolbar-layout]')).toBeNull()
  expect((input.closest('[data-toolbar-search]') as HTMLElement).style.getPropertyValue('--list-search-width')).toBe('220px')
})

it('数の帯の対応待ちの補足は1行に収まる短さにする', async () => {
  render(<StyleDashboard style="restaurant" />)
  expect(await screen.findByText('未配席 1・枠閉じ 2')).toBeTruthy()
  expect(screen.queryByText(/枠を閉じる/)).toBeNull()
})

it('サロンの対応待ちの補足も1行に収まる短さにする', async () => {
  render(<StyleDashboard style="salon" />)
  expect(await screen.findByText('承認待ち・来店未記録')).toBeTruthy()
})

it.each(['restaurant', 'salon', 'consult', 'lesson'] as const)('%sの専用画面も共通の手順を数の帯より先に出す', async style => {
  const view = render(<StyleDashboard style={style} />)
  const title = await screen.findByRole('heading', { name: 'はじめにやること' })
  const card = title.closest('section')!
  expect(card.querySelectorAll('li')).toHaveLength(style === 'restaurant' ? 8 : 6)
  const band = view.container.querySelector('[data-style-dashboard]')!
  expect(card.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
it('専用画面の閲覧のみでもカードを隠さず、設定の操作を灰色で残す', async () => {
  state.role = 'viewer'
  render(<StyleDashboard style="restaurant" />)
  const card = (await screen.findByRole('heading', { name: 'はじめにやること' })).closest('section')!
  expect(card.querySelectorAll('a')).toHaveLength(0)
  expect(card.querySelectorAll('button[aria-disabled="true"]').length).toBeGreaterThan(0)
})
