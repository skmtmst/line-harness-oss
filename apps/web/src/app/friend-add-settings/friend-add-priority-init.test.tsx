// @vitest-environment happy-dom
/*
 * 全ルート監査 A3（2026-09-25）: `?view=new` の優先順位の初期値が
 * 1000000 になっていた。いちばん最後に動く受け皿（優先順位 999999）を
 * 含めて最大+1していたため。通常設定の最後の次の番号にし、
 * 「1000000番目」の表示も出さない。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight component mocks for interaction coverage */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ list: vi.fn(), conflicts: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('step=basic'),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/dialog', () => ({ default: () => null }))
vi.mock('@/components/shared/icon-button', () => ({ default: () => null }))
vi.mock('@/components/shared/list-state', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('@/components/shared/select-field', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({ default: () => null }))
vi.mock('@/components/shared/text-field', () => ({
  TextField: (props: any) => <input {...props} />,
  TextArea: (props: any) => <textarea {...props} />,
}))
vi.mock('@/components/shared/button', () => ({
  default: ({ href, children, ...props }: any) => (href ? <a href={href}>{children}</a> : <button {...props}>{children}</button>),
}))
vi.mock('@/lib/api', () => ({ api: { friendAddRules: { list: (...a: unknown[]) => api.list(...a), conflicts: (...a: unknown[]) => api.conflicts(...a) } } }))

const { default: Editor } = await import('./friend-add-rule-editor')

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const options = { routes: [], scenarios: [], tags: [], folders: [] }

describe('friend-add 新規の優先順位の初期値', () => {
  it('受け皿を除いた最後の次の番号になり「○番目」を出さない', async () => {
    api.list.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 'rule-shop', priority: 1, isFallback: false },
          { id: 'rule-instagram', priority: 2, isFallback: false },
          { id: 'rule-fallback', priority: 999999, isFallback: true },
        ],
        options,
      },
    })
    api.conflicts.mockResolvedValue({
      success: true,
      data: {
        rules: [
          { id: 'rule-shop', priority: 1 },
          { id: 'rule-instagram', priority: 2 },
          { id: 'rule-fallback', priority: 999999 },
        ],
        conflicts: [],
      },
    })
    await act(async () => {
      root.render(<Editor />)
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.resolve()
    })
    const priorityInput = host.querySelector('input[type="number"]') as HTMLInputElement | null
    expect(priorityInput?.value).toBe('3')
    expect(host.textContent).not.toContain('番目')
  })
})
