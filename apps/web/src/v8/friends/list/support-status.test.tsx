// @vitest-environment happy-dom
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react'
import React from 'react'
import { afterEach,expect,test,vi } from 'vitest'
import List from './list'
import styles from './list.module.css'
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/friends' }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
let narrow = false
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => narrow }))
vi.mock('@/lib/operators-cache', () => ({ loadOperators: async () => [] }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  const friend = { id: 'one', displayName: '同じマークの人', chatStatus: 'unread', supportMark: { id: 'mark', name: '未対応' }, tags: [], createdAt: '2026-10-01T00:00:00Z', isFollowing: true }
  return { ...actual, api: { ...actual.api,
    friends: { list: async () => ({ success: true, data: { items: [friend, { ...friend, id: 'two', displayName: '別のマークの人', supportMark: { id: 'other', name: '折り返し' } }], total: 2 } }) },
    friendStats: { get: async () => ({ success: false }) }, tags: { list: async () => ({ success: true, data: [] }) }, scenarios: { list: async () => ({ success: true, data: [] }) },
  } }
})
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.removeItem('friends.visibleColumns'); narrow = false })
test('友だち行で同じ対応状態は一度、異なるマークと担当は残す', async () => {
  render(<List />)
  const same = (await screen.findByText('同じマークの人')).closest('tr')!
  const other = screen.getByText('別のマークの人').closest('tr')!
  expect(within(same).getAllByText('未対応')).toHaveLength(1)
  expect(within(other).getAllByText('未対応')).toHaveLength(1)
  expect(within(other).getByTitle('対応マーク：折り返し')).toBeTruthy()
  expect(within(other).getByText('担当：なし')).toBeTruthy()
  expect(same.querySelector('[data-avatar]')?.textContent).toBe('同')
  expect(other.querySelector('[data-avatar]')?.textContent).toBe('別')
  expect(same.tabIndex).toBe(0)
  fireEvent.keyDown(same, { key: 'Enter' })
  expect(push).toHaveBeenCalledWith(expect.stringContaining('/friends/detail?id=one'))
  push.mockClear()
  fireEvent.click(within(same).getByRole('checkbox'))
  expect(push).not.toHaveBeenCalled()
  expect(same.getAttribute('aria-selected')).toBe('true')
  expect((within(same).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(same).getByRole('checkbox'))
  expect(same.hasAttribute('aria-selected')).toBe(false)
  expect((within(same).getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
})

test.each([false, true])('表示列が対応・シナリオ・最新・情報欄の幅に対応する（狭い表示: %s）', async (isNarrow) => {
  narrow = isNarrow
  localStorage.setItem('friends.visibleColumns', JSON.stringify(['support', 'scenario', 'latest', 'fixed:name']))
  const view = render(<List />)
  await screen.findByText('同じマークの人')
  const table = view.container.querySelector('table')!
  const headers = [...table.querySelectorAll('thead th')]
  const columns = [...table.querySelectorAll('colgroup col')]
  for (const [label, expected] of [
    ['対応・担当', isNarrow ? styles.colSupportNarrow : styles.colSupport],
    ['シナリオ', isNarrow ? styles.colScenarioNarrow : styles.colScenario],
    ['最新の受信', isNarrow ? styles.colLatestNarrow : undefined],
    ['名前', isNarrow ? styles.colFieldNarrow : undefined],
  ] as const) {
    const index = headers.findIndex(header => header.textContent?.trim() === label)
    expect(index, label).toBeGreaterThanOrEqual(0)
    const columnIndex = headers.slice(0, index).reduce((sum, header) => sum + header.colSpan, 0)
    if (expected) expect(columns[columnIndex]?.className).toBe(expected)
  }
})
