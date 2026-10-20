// @vitest-environment happy-dom
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageChromeProvider, usePageChrome } from '@/components/shell/page-chrome'

vi.mock('next/navigation', () => ({ usePathname: () => '/accounts' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
// 役割・権限は手元の保存値から読む。この試験では空でよい。
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })

import SettingsInnerNav from './settings-inner-nav'

/*
 * ★V8：画面が「設定の中のメニュー」を白い板の中（題の下の左）に置いたら、枠（app-shell）に知らせ、
 * 枠は外のメニューを出さない。画面を離れたら知らせを戻す（次の画面に残さない）。
 */
function Probe({ seen }: { seen: (inline: boolean) => void }) {
  seen(usePageChrome().settingsNavInline)
  return null
}

describe('設定の中のメニュー：中に置く知らせ', () => {
  afterEach(cleanup)

  it('inline で置くと枠に知らせが届き、外すと戻る', () => {
    const seen: boolean[] = []
    const view = render(<PageChromeProvider><SettingsInnerNav inline /><Probe seen={(v) => seen.push(v)} /></PageChromeProvider>)
    expect(seen.at(-1)).toBe(true)
    expect(view.container.querySelector('[data-settings-nav="inline"]')).toBeTruthy()
    view.rerender(<PageChromeProvider><Probe seen={(v) => seen.push(v)} /></PageChromeProvider>)
    expect(seen.at(-1)).toBe(false)
  })

  it('inline を付けなければ知らせない（外のメニューのまま）', () => {
    const seen: boolean[] = []
    render(<PageChromeProvider><SettingsInnerNav /><Probe seen={(v) => seen.push(v)} /></PageChromeProvider>)
    expect(seen.at(-1)).toBe(false)
  })
})
