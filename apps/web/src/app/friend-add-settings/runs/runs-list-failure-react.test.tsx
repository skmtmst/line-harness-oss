// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- 実DOMと失敗応答を最小mockで対照する */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ accountId: 'account-1', params: '' }))
const apiMocks = vi.hoisted(() => ({ runs: vi.fn(), get: vi.fn(), stop: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.params),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: state.accountId, accounts: [{ id: 'account-1' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', () => ({ api: { friendAddRules: apiMocks } }))

const { default: FriendAddRunsPage } = await import('./page')

function statusError(status: number) {
  return { status, message: `API error: ${status}` }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.accountId = 'account-1'
  state.params = ''
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<FriendAddRunsPage />)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

/**
 * M009: 実行結果の読み込み失敗が一律「通信を確認して」になる。
 * 403 は権限、404 は選び直し。「通信を確認」は通信断だけ。
 */
describe('M009 実行結果の一覧の読み込み失敗（本物のReact）', () => {
  it('403は権限不足と分かる（通信障害と誤認させない）', async () => {
    apiMocks.runs.mockRejectedValue(statusError(403))
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain('実行結果を表示できませんでした')
    expect(text).toContain('権限')
    expect(text).not.toContain('通信を確認')
  })

  it('404は選び直しを案内する', async () => {
    apiMocks.runs.mockRejectedValue(statusError(404))
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain('見つかりません')
    expect(text).toContain('選び直してください')
    expect(text).not.toContain('通信を確認')
  })

  it('通信断だけ「通信を確認して」になる', async () => {
    apiMocks.runs.mockRejectedValue(new TypeError('fetch failed'))
    await render()
    expect(host.textContent ?? '').toContain('通信を確認して')
  })
})
