// @vitest-environment happy-dom
/*
 * IDEA-03「検索から配信へ進むときは対象条件を引き継ぐ」の受け取り側。
 * 友だち一覧が `/broadcasts/new?condition=<JSON>` で渡した条件を、配信作成が
 * 形を確かめてから最初の宛先の条件にする。壊れた値・空の条件は採用せず知らせる。
 * 渡す側は friends-list-behavior.test.tsx が見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const mocks = vi.hoisted(() => ({
  query: '',
  formProps: [] as Array<Record<string, unknown>>,
  tagsList: vi.fn(),
  audience: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))
vi.mock('@/lib/use-feature-access', () => ({ useFeatureAccess: () => true }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'admin' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }) }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { ...actual.api.tags, list: mocks.tagsList },
      analytics: { ...actual.api.analytics, audience: mocks.audience },
    },
  }
})
// 作成フォームの中身は別の試験が見る。ここでは渡された最初の条件だけを受け取る。
vi.mock('@/components/broadcasts/broadcast-form', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.formProps.push(props)
    return <div data-testid="broadcast-form" />
  },
}))

import NewBroadcastPage from '../broadcasts/new/page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.formProps.length = 0
  mocks.tagsList.mockResolvedValue({ success: true, data: [] })
  mocks.audience.mockResolvedValue({
    success: true,
    data: { id: 'aud-1', sourceKind: 'funnel', selectionKey: null, memberCount: 3, expiresAt: '2026-12-31T00:00:00.000Z' },
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function openWith(query: string): Promise<unknown> {
  mocks.query = query
  await act(async () => { root.render(<NewBroadcastPage />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
  expect(mocks.formProps.length).toBeGreaterThan(0)
  return mocks.formProps.at(-1)?.initialCondition ?? null
}

const condition = (value: unknown) => `condition=${encodeURIComponent(JSON.stringify(value))}`
const WARNING = '引き継がれた絞り込み条件を読めませんでした'

describe('一覧 → 配信作成の条件の受け取り', () => {
  it('形の正しい条件はそのまま最初の宛先の条件にする', async () => {
    const handed = { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }, { type: 'chat_status', value: 'unread' }] }
    expect(await openWith(condition(handed))).toEqual(handed)
    expect(host.textContent).not.toContain(WARNING)
  })

  it.each([
    ['JSONとして読めない', 'condition=%7Bbroken'],
    ['形が違う', condition({ operator: 'XOR', rules: [] })],
    ['空の条件（全員に広がる）', condition({ operator: 'AND', rules: [] })],
  ])('%s値は採用せず、条件なしで開いたことを知らせる', async (_label, query) => {
    expect(await openWith(query)).toBeNull()
    expect(host.textContent).toContain(WARNING)
  })

  it('分析の対象者で開いたときは対象者の条件を渡す', async () => {
    expect(await openWith('audienceId=aud-1')).toEqual({ operator: 'AND', rules: [{ type: 'analytics_audience', value: { audienceId: 'aud-1' } }] })
    expect(mocks.audience).toHaveBeenCalledWith('aud-1', 'acc-1')
  })
})
