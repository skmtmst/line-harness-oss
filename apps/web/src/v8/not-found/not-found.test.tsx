// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/no-such-page' }))

import NotFoundV8 from './not-found'

/** ★V8 見つからない画面（板 Nx5dz）。戻る道を2つ（前のページ・ダッシュボード）出す。 */
describe('見つからない画面（V8）', () => {
  it('題・説明・前のページへ戻る（副）・ダッシュボードへ（主）', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<NotFoundV8 />))
    expect(host.querySelector('[data-design-node="Nx5dz"]')).not.toBeNull()
    expect(host.querySelector('h2')?.textContent).toBe('ページが見つかりません')
    expect(host.textContent).toContain('URL がまちがっているか、ページが移動・削除された可能性があります。')
    const dashboard = [...host.querySelectorAll('a')].find((a) => a.textContent === 'ダッシュボードへ')
    expect(dashboard?.getAttribute('href')).toBe('/')
    const back = [...host.querySelectorAll('button')].find((b) => b.textContent === '前のページへ戻る')
    expect(back).toBeTruthy()
    act(() => back!.click())
    // 直接開いた（履歴が1つ）ときはダッシュボードへ
    expect(router.back.mock.calls.length + router.push.mock.calls.length).toBe(1)
    act(() => root.unmount())
    host.remove()
  })
})
