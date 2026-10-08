// @vitest-environment happy-dom
/*
 * テーマの初期値（V8 移行で崩れる原因②）。
 *
 * 以前は React の初期テーマが常に v7 で、検証環境（NEXT_PUBLIC_ADMIN_THEME=v8）でも
 * `<html data-theme="v8">` の下で最初に v7 の旧画面（tags-page-v4 など）を選び、
 * レイアウト効果で V8 に描き直していた（旧画面のちらつき・旧画面の取得）。
 *
 * - 検証環境：サーバの描画もブラウザの最初の描画も v8（旧画面を一度も選ばない）
 * - 本番（変数なし）：今までどおり v7 で始まり、このブラウザの記憶（v8）があれば揃える
 * - サーバとブラウザの最初の描画が同じなので hydration が壊れない
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))
vi.mock('@/v8/tags/list', () => ({ default: () => <p data-probe="v8">V8 のタグ一覧</p> }))
vi.mock('@/components/friend-fields/tags-page-v4', () => ({ default: () => <p data-probe="v7">v7 のタグ一覧</p> }))

import TagsPage from '@/app/tags/page'
import { useAdminTheme } from './use-admin-theme'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  document.documentElement.dataset.theme = 'v7'
})
afterEach(() => {
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
  document.documentElement.dataset.theme = 'v7'
})

describe('テーマの初期値は環境の既定（layout.tsx と同じ）', () => {
  it('検証環境（v8）はサーバの描画で最初から V8 の画面を選ぶ（旧画面を選ばない）', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    const html = renderToString(<TagsPage />)
    expect(html).toContain('data-probe="v8"')
    expect(html).not.toContain('data-probe="v7"')
  })

  it('本番（変数なし）は今までどおり v7 の画面で始まる', () => {
    const html = renderToString(<TagsPage />)
    expect(html).toContain('data-probe="v7"')
    expect(html).not.toContain('data-probe="v8"')
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
    await act(async () => {
      hydrateRoot(container, <Probe />, { onRecoverableError: (e) => errors.push(e) })
    })
    expect(errors).toEqual([])
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((t) => t === 'v8')).toBe(true)
    expect(container.querySelector('[data-theme-probe]')?.getAttribute('data-theme-probe')).toBe('v8')
  })

  it('検証環境は V8 固定：<html> に古い v7 が残っていても v8', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    document.documentElement.dataset.theme = 'v7'
    let last = ''
    function Probe() {
      last = useAdminTheme()
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      hydrateRoot(container, <Probe />)
    })
    expect(last).toBe('v8')
  })

  it('本番：このブラウザで v8 を選んでいれば（<html> が v8）、描き込み前に v8 へ揃える', async () => {
    document.documentElement.dataset.theme = 'v8'
    let last = ''
    function Probe() {
      last = useAdminTheme()
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      hydrateRoot(container, <Probe />)
    })
    expect(last).toBe('v8')
  })
})
