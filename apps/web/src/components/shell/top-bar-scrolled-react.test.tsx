// @vitest-environment happy-dom
/* 本文（main）を下へ流した時だけ、上の帯をすりガラスにする。一番上では今のまま。 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

import TopBar from '@/components/shared/top-bar'

afterEach(cleanup)

describe('上の帯のすりガラス', () => {
  it('main を下へ流すと data-scrolled が付き、一番上へ戻すと外れる', () => {
    const main = document.createElement('main'); main.id = 'main-content'; document.body.append(main)
    const view = render(<TopBar title="友だち" accounts={[]} selectedAccountId="" onAccountChange={() => {}} roleLabel="" userName="" onLogout={() => {}} v8Chrome chromeVariant="shell" crumbs={null} />)
    const header = view.container.querySelector('header')!
    expect(header.hasAttribute('data-scrolled')).toBe(false)
    act(() => { main.scrollTop = 120; main.dispatchEvent(new Event('scroll')) })
    expect(header.hasAttribute('data-scrolled')).toBe(true)
    act(() => { main.scrollTop = 0; main.dispatchEvent(new Event('scroll')) })
    expect(header.hasAttribute('data-scrolled')).toBe(false)
    main.remove()
  })
})
