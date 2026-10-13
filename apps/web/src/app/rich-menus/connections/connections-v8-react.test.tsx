// @vitest-environment happy-dom
/*
 * 切替のつながり V8（板 wxIQ7）。
 * V8 の見出し・板ID・右の「いまの状態」を出し、旧設定でも旧画面へ戻さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RichMenuConnectionsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ get: vi.fn(), role: 'owner', readOnly: false, permissionKeys: [] as string[] }))
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: { richMenuGroups: { get: mocks.get }, staff: { me: async () => ({ success: true, data: { id: 'connections-qa', role: mocks.role, readOnly: mocks.readOnly, permissionKeys: mocks.permissionKeys } }) } },
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'group-1' : null) }),
  // V8 は src/v8/rich-menus/connections（右上の「…」から移るので useRouter を使う）。
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  mocks.role = 'owner'; mocks.readOnly = false; mocks.permissionKeys = []
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
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-template-region=heading] button[aria-expanded]')!.click() })
    expect(host.textContent).toContain('タブで行き来できるメニューの関係')
    expect(host.textContent).toContain('いまの状態')
    expect(host.textContent).toContain('公開中')
    // つながりの図：入口のメニューと、行き来の札（タブB ⇄ タブA）。
    expect(host.textContent).toContain('このメニュー・タブA')
    expect(host.textContent).toContain('タブB ⇄ タブA')
  })

  it('旧設定が残っていても現役V8へ固定する', async () => {
    document.documentElement.dataset.theme = 'v7'
    await render()
    expect(host.querySelector('[data-design-node="DIUbO"]')).toBeNull()
    expect(host.querySelector('[data-design-node="wxIQ7"]')).not.toBeNull()
  })
  it('本人APIが閲覧のみなら編集・修正・追加を隠し、状態と詳しく見るを残す', async () => {
    mocks.readOnly = true
    await render()
    expect(host.querySelector('[data-read-only-notice]')).not.toBeNull()
    expect(host.querySelector('a[href*="step=buttons"]')).toBeNull()
    expect([...host.querySelectorAll('a')].some(node => node.textContent?.includes('編集する'))).toBe(false)
    expect(host.textContent).toContain('詳しく見る')
    expect(host.textContent).toContain('いまの状態')
    expect(mocks.get).toHaveBeenCalledWith('group-1')
  })
  it('編集を任されたstaffは既存の編集と追加を使える', async () => {
    mocks.role = 'staff'; mocks.permissionKeys = ['/rich-menus']
    await render()
    expect(host.querySelector('[data-read-only-notice]')).toBeNull()
    expect(host.querySelector('a[href*="step=buttons"]')).not.toBeNull()
    expect(host.textContent).toContain('編集する')
    expect(host.textContent).toContain('切替先のメニューを足す')
  })

  it('狭い板の入口は画像でなく状態と操作を同じ窓から読める', async () => {
    await render()
    const open = [...host.querySelectorAll('button')].find(node => node.textContent?.includes('状態と操作を見る'))!
    expect(open).toBeTruthy()
    await act(async () => { open.click() })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('いまの状態と操作')
    expect(dialog.textContent).toContain('いまの状態')
    expect(dialog.textContent).toContain('公開中')
    expect(dialog.textContent).toContain('編集する')
    expect(dialog.textContent).not.toContain('LINEの見え方')
  })

})
