// @vitest-environment happy-dom
/*
 * 16：顔の丸は写真（あれば）・星は付いている行だけ。閲覧のみの行に
 * 押せない薄い星を並べない。付け直すと赤くなる。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/friends' }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'viewer', canManageRole: () => false }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/operators-cache', () => ({ loadOperators: async () => [] }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: {
        list: async () => ({
          success: true,
          data: {
            items: [
              { id: 'f1', displayName: '星あり', pictureUrl: 'https://example.com/a.png', chatStatus: 'unread', supportMark: null, tags: [], createdAt: '2026-10-01T00:00:00Z', isFollowing: true, metadata: { __attention: '1' } },
              { id: 'f2', displayName: '星なし', pictureUrl: null, chatStatus: 'read', supportMark: null, tags: [], createdAt: '2026-10-01T00:00:00Z', isFollowing: true, metadata: {} },
            ],
            total: 2,
          },
        }),
      },
      friendStats: { get: async () => ({ success: false }) },
      tags: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

import List from './list'

afterEach(() => { cleanup(); sessionStorage.clear() })

test('閲覧のみ：星は付いている行だけに出し、無い行には置かない', async () => {
  render(<List />)
  await screen.findByText('星あり')
  const starred = screen.getByTitle('注目')
  expect(starred.tagName).toBe('SPAN')
  // 星なしの行に星の印は無い（付けていない行の薄い星を出さない）。
  expect(document.querySelectorAll('[title="注目"]')).toHaveLength(1)
})
