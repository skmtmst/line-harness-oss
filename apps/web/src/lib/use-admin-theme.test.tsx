// @vitest-environment happy-dom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))
vi.mock('@/v8/tags/list', () => ({ default: () => <p data-screen="v8">V8 のタグ一覧</p> }))
import TagsPage from '@/app/tags/page'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

async function assertV8Hydration() {
  const container = document.createElement('div')
  const initial = renderToString(<TagsPage />)
  expect(initial).toContain('data-screen="v8"')
  container.innerHTML = initial
  document.body.appendChild(container)
  const errors: unknown[] = []
  let root!: ReturnType<typeof hydrateRoot>
  try {
    await act(async () => { root = hydrateRoot(container, <TagsPage />, { onRecoverableError: error => errors.push(error) }) })
    await act(async () => { window.dispatchEvent(new Event('lh:admin-theme-changed')) })
    expect(errors).toEqual([])
    expect(container.innerHTML).toBe(initial)
    expect(container.querySelector('[data-screen="v8"]')).not.toBeNull()
  } finally {
    if (root) await act(async () => root.unmount())
  }
}

describe('タグの入口は試験でも実行環境でもV8だけ', () => {
  it('本番は変数なし・古いDOMの値でもV8を描き、通知で切り替わらない', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', '')
    document.documentElement.dataset.theme = 'v7'
    await assertV8Hydration()
  })
  it('開発でも最初からV8を描く', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(renderToString(<TagsPage />)).toContain('data-screen="v8"')
  })
  it('検証の古い環境指定がV8でも現役の入口を描く', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    expect(renderToString(<TagsPage />)).toContain('data-screen="v8"')
  })
  it('試験でも変数なしを理由に旧画面を選ばない', () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', '')
    expect(renderToString(<TagsPage />)).toContain('data-screen="v8"')
  })
  it('サーバとブラウザの最初の描画が同じである', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
    document.documentElement.dataset.theme = 'v8'
    await assertV8Hydration()
  })
  it('古い環境指定とDOMの管理画面値でもV8を保つ', async () => {
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v7')
    document.documentElement.dataset.theme = 'v7'
    await assertV8Hydration()
  })
  it('試験のDOMがV8ならそのまま同じ入口を描く', async () => {
    document.documentElement.dataset.theme = 'v8'
    await assertV8Hydration()
  })
})
