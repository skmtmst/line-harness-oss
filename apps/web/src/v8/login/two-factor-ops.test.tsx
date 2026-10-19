// @vitest-environment happy-dom
import { trustedChallengeUrl } from '@/test-utils/trusted-auth-handoff'
import React, { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwoFactorLoginPage from '@/app/login/two-factor/page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * ★V8-B 運営 ログイン 2段目。入口の分け方を見張る：
 * 運営も管理画面もV8の6桁入力に固定し、運営の戻り先と権限確認は区別する。
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
  window.history.replaceState(null, '', trustedChallengeUrl(url))
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
    expect(host.querySelector('button[aria-label="6桁の確認の説明"]')).toBeNull()
    expect(host.textContent).toContain('パスワードを確かめました。')
    expect(host.textContent).toContain('認証アプリが使えないときは、運営のオーナーに連絡してください。')
    const login = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('ログイン'))
    expect(login?.hasAttribute('disabled')).toBe(false)
    const recover = [...host.querySelectorAll('button')].find(button => button.textContent === '回復コードを使う')
    await act(async () => { recover?.click() })
    expect(host.querySelector('h1')?.textContent).toBe('回復コードでログイン')
    expect(host.textContent).toContain('登録の時に控えた回復コードを1つ入れてください。')
    const back = [...host.querySelectorAll('button')].find(button => button.textContent === '6桁のコードで入る')
    await act(async () => { back?.click() })
    expect(host.querySelector('h1')?.textContent).toBe('6桁の確認')
    expect(host.textContent).toContain('認証アプリに出ている6桁を入れてください。')
  })

  it('LINEで認証したときは、パスワードを確認したとは案内しない', async () => {
    await open('/login/two-factor?next=ops#lh_2fa=challenge-1&lh_method=line', 'v8')
    expect(host.textContent).toContain('LINEでのログインを確かめました。')
    expect(host.textContent).not.toContain('パスワードを確かめました。')
  })

  it('認証の情報が無いときは、確認済みの案内を出さずログインのやり直しを案内する', async () => {
    await open('/login/two-factor?next=ops', 'v8')
    expect(host.textContent).toContain('ログインの情報が見つかりませんでした。')
    expect(host.textContent).not.toContain('パスワードを確かめました。')
  })

  it('管理画面の2段目もV8で出し、LINEでのログイン方法を保つ', async () => {
    await open('/login/two-factor#lh_2fa=challenge-1', 'v8')
    expect(host.textContent).toContain('二段階認証')
    expect(host.textContent).toContain('LINEログイン')
  })

  it('旧テーマ属性が残っても運営はV8で出す', async () => {
    await open('/login/two-factor?next=ops#lh_2fa=challenge-1', 'v7')
    expect(host.textContent).toContain('6桁の確認')
    expect(host.querySelector('[data-design-node="tOPeY"]')).not.toBeNull()
  })
})
