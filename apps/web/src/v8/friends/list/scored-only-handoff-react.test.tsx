// @vitest-environment happy-dom
/*
 * R300: 行動スコアの帯から来た友だち一覧は、点数がついている人だけを数える。
 *
 * URL の `scoredOnly=1` を読み、検索の口へ渡し、帯にそのことを示し、
 * ［この条件で配信を作成］へも同じ条件を載せるかを本物の React で確かめる。
 * 渡す側（行動スコアのタブ）は app/mileage/score-band-handoff-react.test.tsx が見る。
 */
import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/friends',
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={String(href)} {...props}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false }) }))
vi.mock('@/lib/operators-cache', () => ({ loadOperators: async () => [] }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: { list: fx.list },
      friendStats: { get: async () => ({ success: false }) },
      tags: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

import List from './list'
import { flushListUrlState } from '@/components/shared/list-url-state'

beforeEach(() => {
  fx.list.mockReset().mockResolvedValue({ success: true, data: { items: [], total: 0 } })
  flushListUrlState()
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/friends')
})

function lastListParams(): Record<string, unknown> {
  return (fx.list.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>
}

function handoffCondition(container: HTMLElement): unknown {
  const href = container.querySelector('a[data-broadcast-handoff]')?.getAttribute('href') ?? ''
  const raw = new URL(href, 'https://admin.test').searchParams.get('condition')
  return raw ? JSON.parse(raw) : null
}

it('帯から来たときは点数がついている人だけを検索し、帯と配信の条件にも載せる', async () => {
  window.history.replaceState(null, '', '/friends?scoreMax=9&scoredOnly=1')
  const view = render(<List />)

  await waitFor(() => expect(fx.list).toHaveBeenCalled())
  expect(lastListParams()).toMatchObject({ scoreMax: 9, scoredOnly: true })
  await waitFor(() => expect(view.container.textContent).toContain('行動スコア：9 点以下（点数がついている人のみ）'))
  expect(handoffCondition(view.container)).toMatchObject({
    rules: [{ type: 'score_range', value: { max: 9, scoredOnly: true } }],
  })
})

it('点数の範囲だけで来たときは、未採点の人を外す条件を勝手に足さない', async () => {
  window.history.replaceState(null, '', '/friends?scoreMax=9')
  const view = render(<List />)

  await waitFor(() => expect(fx.list).toHaveBeenCalled())
  expect(lastListParams().scoreMax).toBe(9)
  expect(lastListParams().scoredOnly).toBeUndefined()
  await waitFor(() => expect(view.container.textContent).toContain('行動スコア：9 点以下'))
  expect(view.container.textContent).not.toContain('点数がついている人のみ')
  const rule = (handoffCondition(view.container) as { rules: Array<{ value: Record<string, unknown> }> }).rules[0]
  expect(rule.value.scoredOnly).toBeUndefined()
})
