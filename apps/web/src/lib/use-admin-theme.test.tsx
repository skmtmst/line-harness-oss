// @vitest-environment happy-dom
/*
 * 見た目は常に V8（2026-10-09 V8 固定）。
 *
 * - 画面（試験の外＝NODE_ENV が test 以外）：サーバの描画も最初の描画も v8。
 *   環境変数が無くても、<html> に古い v7 が残っていても、合図が来ても v8 のまま。
 * - 試験の中だけ：使われないまま残した v7 の画面の試験のために、
 *   NEXT_PUBLIC_ADMIN_THEME と <html data-theme> での選択が残る（下の「試験の中だけ」）。
 * - サーバとブラウザの最初の描画が同じなので hydration が壊れない
 */
import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))
vi.mock('@/v8/tags/list', () => ({ default: () => <p data-probe="v8">V8 のタグ一覧</p> }))
vi.mock('@/components/friend-fields/tags-page-v4', () => ({ default: () => <p data-probe="v7">v7 のタグ一覧</p> }))

import TagsPage from '@/app/tags/page'
import { useAdminTheme } from './use-admin-theme'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  document.documentElement.dataset.theme = 'v7'
})
afterEach(() => {
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
  document.documentElement.dataset.theme = 'v7'
})

describe('画面は常に V8（試験の外）', () => {
  it('NODE_ENV=production：変数なし・<html> が v7 でも、サーバの描画も描き込み後も v8', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', '')
    document.documentElement.dataset.theme = 'v7'
    const seen: string[] = []
    function Probe() {
      const theme = useAdminTheme()
      seen.push(theme)
      return <span data-theme-probe={theme} />
    }
    expect(renderToString(<Probe />)).toContain('data-theme-probe="v8"')
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root!: Root
    await act(async () => {
      root = hydrateRoot(container, <Probe />)
    })
    await act(async () => {
      window.dispatchEvent(new Event(ADMIN_THEME_CHANGED_EVENT))
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((theme) => theme === 'v8')).toBe(true)
    await act(async () => { root.unmount() })
  })

  it('NODE_ENV=development（next dev）も v8', () => {
    vi.stubEnv('NODE_ENV', 'development')
    function Probe() {
      return <span data-theme-probe={useAdminTheme()} />
    }
    expect(renderToString(<Probe />)).toContain('data-theme-probe="v8"')
  })
})

describe('試験の中だけ：v7 の画面の試験のための選択口', () => {
  it('検証環境（v8）はサーバの描画で最初から V8 の画面を選ぶ（旧画面を選ばない）', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    const html = renderToString(<TagsPage />)
    expect(html).toContain('data-probe="v8"')
    expect(html).not.toContain('data-probe="v7"')
  })

  it('試験の中で変数なしなら v7 を選べる（タグの入口は V8 だけになった）', () => {
    // タグの入口（app/tags/page.tsx）は 2026-10-09 の V7 削除で V8 だけを出す（mainA）。
    // テーマの仕組みそのもの（変数なしは v7）は rmv7 が V8 固定にするまで残るので、値だけを見る。
    function Probe() {
      return <span data-theme-probe={useAdminTheme()} />
    }
    expect(renderToString(<Probe />)).toContain('data-theme-probe="v7"')
    expect(renderToString(<TagsPage />)).toContain('data-probe="v8"')
  })

  it('検証環境：hydration でサーバと同じ v8 を描き、一度も v7 を経由しない', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    const seen: string[] = []
    function Probe() {
      const theme = useAdminTheme()
      seen.push(theme)
      return <span data-theme-probe={theme}>{theme}</span>
    }
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Probe />)
    document.body.appendChild(container)
    document.documentElement.dataset.theme = 'v8'
    seen.length = 0
    const errors: unknown[] = []
    let root!: Root
    await act(async () => {
      root = hydrateRoot(container, <Probe />, { onRecoverableError: (e) => errors.push(e) })
    })
    expect(errors).toEqual([])
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((t) => t === 'v8')).toBe(true)
    expect(container.querySelector('[data-theme-probe]')?.getAttribute('data-theme-probe')).toBe('v8')
    await act(async () => { root.unmount() })
  })

  it('検証環境は V8 固定：<html> に古い v7 が残っていても v8', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    document.documentElement.dataset.theme = 'v7'
    const seen: string[] = []
    function Probe() {
      seen.push(useAdminTheme())
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root!: Root
    await act(async () => {
      root = hydrateRoot(container, <Probe />)
    })
    await act(async () => {
      window.dispatchEvent(new Event(ADMIN_THEME_CHANGED_EVENT))
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((theme) => theme === 'v8')).toBe(true)
    await act(async () => { root.unmount() })
  })

  it('試験の中で <html> を v8 にすれば、描き込み前に v8 へ揃える', async () => {
    document.documentElement.dataset.theme = 'v8'
    let last = ''
    function Probe() {
      last = useAdminTheme()
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root!: Root
    await act(async () => {
      root = hydrateRoot(container, <Probe />)
    })
    expect(last).toBe('v8')
    await act(async () => { root.unmount() })
  })
})
