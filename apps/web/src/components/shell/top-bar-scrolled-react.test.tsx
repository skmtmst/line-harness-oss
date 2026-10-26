// @vitest-environment happy-dom
/* 本文（main）を下へ流しても、上の帯は白く（すりガラスに）しない。流す前の見た目のまま。 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

import TopBar from '@/components/shared/top-bar'

afterEach(cleanup)

describe('上の帯は流しても変わらない', () => {
  it('main を下へ流しても、帯に流した印も地の色も付かない', () => {
    const main = document.createElement('main'); main.id = 'main-content'; document.body.append(main)
    const view = render(<TopBar title="友だち" accounts={[]} selectedAccountId="" onAccountChange={() => {}} roleLabel="" userName="" onLogout={() => {}} v8Chrome chromeVariant="shell" crumbs={null} />)
    const header = view.container.querySelector('header')!
    const before = header.outerHTML
    act(() => { main.scrollTop = 120; main.dispatchEvent(new Event('scroll')) })
    expect(header.hasAttribute('data-scrolled')).toBe(false)
    expect(header.outerHTML).toBe(before)
    main.remove()
  })

  it('帯の CSS にすりガラス・流した時の地の色を持たない', () => {
    const css = readFileSync(resolve(__dirname, '../shared/top-bar.module.css'), 'utf8')
    expect(css).not.toMatch(/backdrop-filter|data-scrolled/)
  })
})
