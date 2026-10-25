// @vitest-environment happy-dom
import { trustedChallengeUrl } from '@/test-utils/trusted-auth-handoff'
import React, { act, type ReactNode } from 'react'
import { fireEvent } from '@testing-library/react'
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

describe('二段階認証の6桁（自動で確かめる・間違い・回復コード・戻る）', () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  let bodies: Array<Record<string, unknown>> = []
  let verifyAnswer: () => Response

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
    bodies = []
    verifyAnswer = () => json({ success: true, data: { sessionToken: 'session-1' }, csrfToken: 'csrf-1' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/api/auth/two-factor/verify')) {
        if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return verifyAnswer()
      }
      return json({ success: false, error: 'unexpected' }, 500)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openAdmin() {
    await open('/login/two-factor#lh_2fa=challenge-1&lh_method=password', 'v8')
  }

  function slots() {
    return [...host.querySelectorAll('input[aria-label$="桁目"], input[aria-label$="文字目"]')] as HTMLInputElement[]
  }

  it('6桁そろうと押さずに確かめ、正しいコードでログインへ進む', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    try {
      await openAdmin()
      await act(async () => {
        fireEvent.change(slots()[0], { target: { value: '482917' } })
        await Promise.resolve()
      })
      expect(bodies[0]).toMatchObject({ challengeToken: 'challenge-1', code: '482917' })
      expect(host.textContent).toContain('確認しています…')
      expect(host.querySelector('[role="status"]')?.textContent).toBe('確認できました')
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)) })
      expect(assign).toHaveBeenCalledTimes(1)
      expect(String(assign.mock.calls[0][0])).toContain('lh_session=session-1')
    } finally {
      assign.mockRestore()
    }
  })

  it('間違えると赤い理由を出し、四角を空にして1つ目へ戻る', async () => {
    verifyAnswer = () => json({ success: false, error: '認証コードが正しくありません' }, 400)
    await openAdmin()
    await act(async () => {
      fireEvent.change(slots()[0], { target: { value: '000000' } })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('コードが違います。もう一度入れてください')
    expect(slots().map((input) => input.value).join('')).toBe('')
    expect(document.activeElement).toBe(slots()[0])
  })

  it('回復コードを使う道とログインへ戻る道を小さなリンクから開く', async () => {
    await openAdmin()
    const toggle = [...host.querySelectorAll('button')].find((button) => button.textContent === 'コードが使えない場合')
    await act(async () => { toggle?.click() })
    const back = [...host.querySelectorAll('a')].find((link) => link.textContent === 'ログインに戻る')
    expect(back?.getAttribute('href')).toBe('/login')
    const useRecovery = [...host.querySelectorAll('button')].find((button) => button.textContent === '回復コードを使う')
    await act(async () => { useRecovery?.click() })
    expect(host.querySelector('h1')?.textContent).toBe('回復コードでログイン')
    expect(slots()).toHaveLength(8)
    expect(host.textContent).toContain('回復コード（8文字）')
    const useDigits = [...host.querySelectorAll('button')].find((button) => button.textContent === '6桁のコードで入る')
    await act(async () => { useDigits?.click() })
    expect(host.querySelector('h1')?.textContent).toBe('二段階認証')
    expect(slots()).toHaveLength(6)
  })
})
