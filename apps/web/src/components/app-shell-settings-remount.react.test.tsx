// @vitest-environment happy-dom
import React, { useEffect } from 'react'
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageChromeProvider, useSettingsNavInline } from './shell/page-chrome'

vi.mock('next/navigation', () => ({ usePathname: () => '/staff', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('./shell/app-top-bar', () => ({ default: () => null }))
vi.mock('./layout/settings-inner-nav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout/settings-inner-nav')>()
  return { ...actual, default: () => <nav data-outer-settings-nav="" /> }
})

import { Workspace } from './app-shell'

/*
 * ★V8：設定の画面が「設定の中のメニュー」を板の中に置く（inline）と、枠は外のメニューを外す。
 * そのとき本文を作り直すと、作り直しのたびに inline の知らせが消えて付いてを繰り返し、
 * 「Maximum update depth exceeded」で画面が落ちた（2026-10-07 設定の作業で見つかった）。
 * 外のメニューの有る無しで、本文は1回しか作られないこと。
 */
let mounts = 0
function InlinePage() {
  useSettingsNavInline(true)
  useEffect(() => { mounts += 1 }, [])
  return <p data-page="">ログインユーザー</p>
}

describe('外枠：設定の画面で外のメニューを外しても本文を作り直さない', () => {
  afterEach(() => { cleanup(); mounts = 0 })

  it('板の中にメニューを置いた画面は1回だけ作られ、外のメニューは出ない', () => {
    const view = render(<PageChromeProvider><Workspace><InlinePage /></Workspace></PageChromeProvider>)
    expect(view.container.querySelector('[data-page]')).toBeTruthy()
    expect(view.container.querySelector('[data-outer-settings-nav]')).toBeNull()
    expect(mounts).toBe(1)
  })

  it('まだ移っていない画面（inline なし）は外のメニューが出る', () => {
    const view = render(<PageChromeProvider><Workspace><p data-page="">機能設定</p></Workspace></PageChromeProvider>)
    expect(view.container.querySelector('[data-outer-settings-nav]')).toBeTruthy()
    expect(view.container.querySelector('[data-settings-split]')).toBeTruthy()
  })
})
