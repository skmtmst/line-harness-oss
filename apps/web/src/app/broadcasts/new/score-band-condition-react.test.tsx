// @vitest-environment happy-dom
/*
 * R300: 行動スコアの帯から一斉配信の作成へ来たときの宛先の条件。
 *
 * 帯のリンクは `scoreMin` / `scoreMax` を直に付けてくる。`scoredOnly=1` が
 * 付いていれば、作成フォームへ渡す最初の条件にも「点数がついている人だけ」を
 * 載せる。載せないと未採点の0点の人にまで届く。
 * 渡す側は app/mileage/score-band-handoff-react.test.tsx が見る。
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
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, list: mocks.tagsList } } }
})
// 作成フォームの中身は別の試験が見る。ここでは渡された最初の条件だけを受け取る。
vi.mock('@/components/broadcasts/broadcast-form', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.formProps.push(props)
    return <div data-testid="broadcast-form" />
  },
}))

import NewBroadcastPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.formProps.length = 0
  mocks.tagsList.mockResolvedValue({ success: true, data: [] })
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

describe('R300: 帯から来た配信の宛先', () => {
  it('scoredOnly=1 なら、点数範囲に「点数がついている人だけ」を添えて渡す', async () => {
    expect(await openWith('scoreMin=10&scoreMax=29&scoredOnly=1')).toEqual({
      operator: 'AND',
      rules: [{ type: 'score_range', value: { min: 10, max: 29, scoredOnly: true } }],
    })
  })

  it('scoredOnly が無ければ、点数範囲だけを渡す', async () => {
    expect(await openWith('scoreMax=9')).toEqual({
      operator: 'AND',
      rules: [{ type: 'score_range', value: { min: null, max: 9 } }],
    })
  })

  it('点数範囲が無ければ、scoredOnly だけで条件を作らない', async () => {
    expect(await openWith('scoredOnly=1')).toBeNull()
  })
})
