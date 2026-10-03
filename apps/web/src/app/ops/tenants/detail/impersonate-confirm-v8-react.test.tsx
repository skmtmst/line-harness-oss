// @vitest-environment happy-dom
/*
 * 契約先詳細の代理ログイン開始（組③）。
 * V8 では始める前に確認の小窓を出す。応答が戻るまで二重に押せない。
 * 失敗したら理由を出して、ボタンからやり直せる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsTenantDetailPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), start: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: { ops: { tenant: mocks.tenant, impersonation: { start: mocks.start } } },
}))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'tenant-1' : null) }),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const detail = {
  tenant: {
    id: 'tenant-1', name: '契約先A', status: 'active', featurePacks: [],
    plan_key: null, plan_status: 'active', trial_ends_at: null,
    current_period_ends_at: null, created_at: '2026-09-01T00:00:00.000Z',
  },
  accounts: [],
  members: [],
  audit: [],
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.dataset.theme = 'v8'
  mocks.tenant.mockResolvedValue({ success: true, data: detail })
  mocks.start.mockResolvedValue({
    success: true,
    data: { id: 'imp-1', tenantId: 'tenant-1', mode: 'read', piiRevealed: false, startedAt: '2026-10-03T00:00:00.000Z' },
  })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme })

async function render() {
  await act(async () => { root.render(<OpsTenantDetailPage />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').trim() === label)

describe('代理ログイン開始の確認窓', () => {
  it('始める前に契約先名・閲覧のみ・記録を確かめる', async () => {
    await render()
    expect(mocks.start).not.toHaveBeenCalled()
    await act(async () => { button('代理ログイン')!.click() })
    // いきなり始めず、確認の小窓が出る
    expect(mocks.start).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('「契約先A」に代理ログインする')
    expect(document.body.textContent).toContain('閲覧のみで始まります')
    expect(document.body.textContent).toContain('操作はすべて記録されます')
    await act(async () => { button('代理ログインを始める')!.click() })
    expect(mocks.start).toHaveBeenCalledWith('tenant-1')
  })

  it('失敗したら理由を出して、もう一度押せる', async () => {
    mocks.start.mockResolvedValueOnce({ success: false, error: '代理ログインを始められませんでした' })
    await render()
    await act(async () => { button('代理ログイン')!.click() })
    await act(async () => { button('代理ログインを始める')!.click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('代理ログインを始められませんでした')
    expect(button('代理ログインを始める')!.disabled).toBe(false)
  })
})
