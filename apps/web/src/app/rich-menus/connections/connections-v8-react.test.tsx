// @vitest-environment happy-dom
/*
 * 切替のつながり V8（板 wxIQ7）。
 * V8 では見出し・板ID・右の「いまの状態」を出す。v7 はそのまま。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RichMenuConnectionsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: { richMenuGroups: { get: mocks.get } },
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'group-1' : null) }),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const group = {
  id: 'group-1', accountId: 'account-a', name: '会員ランク上位',
  status: 'published', defaultPageId: 'p1',
  pages: [
    { id: 'p1', name: 'トップ', orderIndex: 0, areas: [{ actionType: 'richmenuswitch', actionData: { targetPageId: 'p2' }, label: '商品へ' }] },
    { id: 'p2', name: '商品', orderIndex: 1, areas: [{ actionType: 'richmenuswitch', actionData: { targetPageId: 'p1' }, label: 'トップへ' }] },
  ],
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue({ success: true, data: group })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme })

async function render() {
  await act(async () => { root.render(<RichMenuConnectionsPage />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('切替のつながりV8（wxIQ7）', () => {
  it('板ID・見出し・いまの状態を出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    await render()
    expect(host.querySelector('[data-design-node="wxIQ7"]')).not.toBeNull()
    expect(host.textContent).toContain('切替のつながり：会員ランク上位')
    expect(host.textContent).toContain('タブで行き来できるメニューの関係')
    expect(host.textContent).toContain('いまの状態')
    expect(host.textContent).toContain('公開中')
  })

  it('v7はDIUbOのまま', async () => {
    await render()
    expect(host.querySelector('[data-design-node="DIUbO"]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="wxIQ7"]')).toBeNull()
  })
})
