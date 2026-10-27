// @vitest-environment happy-dom
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react'
import React from 'react'
import { afterEach,expect,test,vi } from 'vitest'
import List from './list'
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/friends' }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/operators-cache', () => ({ loadOperators: async () => [] }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  const friend = { id: 'one', displayName: '止めた人', chatStatus: 'resolved', supportMark: null, tags: [], createdAt: '2026-10-01T00:00:00Z', isFollowing: true, activeScenario: { name: '新規のあいさつ', status: 'paused' }, latestMessage: null, firstTrackedLinkName: null }
  const running = { ...friend, id: 'two', displayName: '動いている人', activeScenario: { name: '稼働中', status: 'active' } }
  const none = { ...friend, id: 'three', displayName: 'シナリオの無い人', activeScenario: null }
  return { ...actual, api: { ...actual.api,
    friends: { list: async () => ({ success: true, data: { items: [friend, running, none], total: 3 } }) },
    friendStats: { get: async () => ({ success: false }) }, tags: { list: async () => ({ success: true, data: [] }) }, scenarios: { list: async () => ({ success: true, data: [] }) },
  } }
})
afterEach(() => { cleanup(); sessionStorage.clear() })
test('シナリオの状態は地の色の札、値の無い所は薄い灰の — を1つだけ出す', async () => {
  render(<List />)
  const paused = (await screen.findByText('止めた人')).closest('tr')!
  const running = screen.getByText('動いている人').closest('tr')!
  const none = screen.getByText('シナリオの無い人').closest('tr')!
  const badge = (row: HTMLElement, text: string) => [...row.querySelectorAll('[data-design-node="xRvDB"]')].find((el) => el.textContent === text) as HTMLElement | undefined
  expect(badge(paused, '停止中')?.dataset.tone).toBe('neutral')
  expect(within(paused).getByText('新規のあいさつ')).toBeTruthy()
  expect(badge(running, '有効')?.dataset.tone).toBe('success')
  expect(running.textContent).not.toContain('稼働中')
  expect(badge(none, '停止中')).toBeUndefined()
  expect(badge(none, '有効')).toBeUndefined()
  for (const row of [paused, running, none]) {
    expect(row.textContent).not.toContain('受信なし')
    expect(row.textContent).not.toContain('未設定')
  }
  expect(none.textContent?.match(/—/g)).toHaveLength(4)
})
