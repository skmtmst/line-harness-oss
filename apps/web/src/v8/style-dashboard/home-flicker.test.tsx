// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({ loading: true, error: null as string | null, accounts: [] as Array<{ id: string }>, selectedAccountId: null as string | null }))
const styleGet = vi.hoisted(() => ({ fn: vi.fn() as (...args: unknown[]) => Promise<unknown> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => account }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { get: (...args: unknown[]) => styleGet.fn(...args) } }))
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>, opts?: { loading?: () => React.ReactNode }) =>
    function DynamicStub(props: Record<string, unknown>) {
      const [Comp, setComp] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null)
      React.useEffect(() => { loader().then((m) => setComp(() => m.default)) }, [])
      if (!Comp) return (opts?.loading ? opts.loading() : null) as React.ReactElement | null
      return <Comp {...props} />
    },
}))
vi.mock('@/v8/dashboard/index', () => ({
  DashboardV8: () => <div data-design-node="WQmep" data-screen="standard"><div data-template-region="heading"><h1>ダッシュボード</h1></div></div>,
}))
vi.mock('@/v8/style-dashboard/style-dashboard', () => ({
  default: ({ style }: { style: string }) => (
    <div data-design-node={`style-${style}`} data-screen="industry">
      <div data-template-region="heading"><h1>ダッシュボード</h1></div>
    </div>
  ),
}))
import HomeDashboard from './home'

function sample() {
  const h1s = [...document.querySelectorAll('[data-template-region="heading"] h1')].map((e) => e.textContent)
  const boards = [...document.querySelectorAll('[data-page-template="dashboard"]')].map((e) => e.getAttribute('data-design-node') ?? '(loading)')
  for (const e of document.querySelectorAll('[data-screen]')) boards.push(e.getAttribute('data-design-node') ?? '(loading)')
  return { h1s, boards }
}

beforeEach(() => {
  localStorage.clear()
  account.loading = true; account.error = null; account.accounts = []; account.selectedAccountId = null
})
afterEach(cleanup)

it('開いてから落ち着くまで題と画面の種類が変わらない（飲食店・遅い応答）', async () => {
  let resolveStyle!: (value: unknown) => void
  styleGet.fn = vi.fn(() => new Promise((resolve) => { resolveStyle = resolve }))
  const seen: Array<{ h1s: Array<string | null>; boards: string[] }> = []
  const view = render(<HomeDashboard />)
  seen.push(sample())
  // 店の一覧が届き、店が選ばれる。業種はまだ読み途中。
  await act(async () => {
    account.loading = false; account.accounts = [{ id: 'acc-a' }]; account.selectedAccountId = 'acc-a'
    view.rerender(<HomeDashboard />)
  })
  await waitFor(() => expect(styleGet.fn).toHaveBeenCalled())
  seen.push(sample())
  // 業種が届く（飲食店）。
  await act(async () => { resolveStyle({ success: true, data: { style: 'restaurant', version: 2 } }) })
  await waitFor(() => expect(document.querySelector('[data-design-node="style-restaurant"]')).not.toBeNull())
  seen.push(sample())
  // 題は最初から最後までダッシュボードだけ。
  for (const s of seen) {
    expect(s.h1s.length).toBeGreaterThan(0)
    for (const h1 of s.h1s) expect(h1).toBe('ダッシュボード')
  }
  // 画面は読み込み中→飲食店だけ。標準の盤や別の業種は出ない。
  const boards = seen.flatMap((s) => s.boards)
  expect(boards).not.toContain('WQmep')
  expect(new Set(boards.filter((b) => b !== '(loading)'))).toEqual(new Set(['style-restaurant']))
  expect(seen[seen.length - 1].boards).toContain('style-restaurant')
})

it('店が1件も無い時は共通画面を出す（読み込み中のまま止めない）', async () => {
  styleGet.fn = async () => ({ success: true, data: { style: 'standard', version: 2 } })
  const view = render(<HomeDashboard />)
  await act(async () => {
    account.loading = false; account.accounts = []; account.selectedAccountId = null
    view.rerender(<HomeDashboard />)
  })
  await waitFor(() => expect(document.querySelector('[data-design-node="WQmep"]')).not.toBeNull())
  expect(document.querySelector('[data-template-region="heading"] h1')?.textContent).toBe('ダッシュボード')
})
