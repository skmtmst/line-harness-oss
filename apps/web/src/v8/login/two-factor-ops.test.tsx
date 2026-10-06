// @vitest-environment happy-dom
import React, { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwoFactorLoginPage from '@/app/login/two-factor/page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * ★V8-B 運営 ログイン 2段目（tOPeY）。入口の分け方を見張る：
 * V8 かつ運営から来たとき（?next=ops）だけ「6桁の確認」。管理画面の2段目と v7 は今のまま。
 */
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/login/two-factor',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: 'テスト統括' }) }))

let host: HTMLDivElement
let root: Root

async function open(url: string, theme: 'v7' | 'v8') {
  window.history.replaceState(null, '', url)
  document.documentElement.dataset.theme = theme
  await act(async () => { root.render(<TwoFactorLoginPage />) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

describe('運営 ログイン 2段目（V8 の入口）', () => {
  it('V8 で運営から来たら「6桁の確認」を出し、ログインのボタンを押せる', async () => {
    await open('/login/two-factor?next=ops#lh_2fa=challenge-1&lh_method=password', 'v8')
    expect(host.querySelector('[data-design-node="tOPeY"]')).not.toBeNull()
    expect(host.textContent).toContain('6桁の確認')
    expect(host.textContent).toContain('認証アプリが使えないときは、運営のオーナーに連絡してください。')
    const login = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('ログイン'))
    expect(login?.hasAttribute('disabled')).toBe(false)
  })

  it('V8 でも管理画面の2段目（next なし）は今のまま', async () => {
    await open('/login/two-factor#lh_2fa=challenge-1', 'v8')
    expect(host.textContent).not.toContain('6桁の確認')
    expect(host.textContent).toContain('二段階認証')
  })

  it('v7 では運営から来ても今のまま', async () => {
    await open('/login/two-factor?next=ops#lh_2fa=challenge-1', 'v7')
    expect(host.textContent).not.toContain('6桁の確認')
    expect(host.textContent).toContain('二段階認証')
  })
})
