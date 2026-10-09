// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminThemeDefault, adminThemeLocked } from './admin-theme-default'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

// テーマの関数と実際のページ入口は差し替えない。V7が選ばれたらその場で失敗する。
vi.mock('@/v8/webinars/list', () => ({ default: () => <p data-screen="v8">ウェビナー</p> }))
vi.mock('@/app/webinars/list-v8', () => ({ default: () => { throw new Error('旧画面が選ばれた') } }))
vi.mock('next/font/google', () => ({ Inter: () => ({ variable: 'inter' }), Noto_Sans_JP: () => ({ variable: 'noto' }) }))
vi.mock('@/components/app-shell', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/client-error-reporter', () => ({ default: () => null }))
vi.mock('@/components/shared/toast', () => ({ default: () => null }))

import WebinarsPage from '@/app/webinars/page'
import RootLayout from '@/app/layout'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

describe.each(['production', 'development'])('%sの画面はV8固定', (environment) => {
  it.each([undefined, 'v7', 'v8'])('環境の選択=%s・保存済みV7でも最初の描画から旧画面を選ばない', async (choice) => {
    vi.stubEnv('NODE_ENV', environment)
    vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', choice)
    // Node 26のglobalStorageを避け、ブラウザのStorageを試験へ渡す。
    const storage = new Window({ url: 'http://localhost' }).localStorage
    storage.setItem('lh-admin-theme', 'v7')
    vi.stubGlobal('localStorage', storage)
    expect(window.localStorage).toBe(storage)
    // 古い値の読み取り・更新通知がV7の入口を開かないことも確認する。
    document.documentElement.dataset.theme = 'v7'
    const storageRead = vi.spyOn(storage, 'getItem')
    expect(adminThemeDefault()).toBe('v8')
    expect(adminThemeLocked()).toBe(true)
    const page = renderToString(<WebinarsPage />)
    const layout = renderToString(<RootLayout><WebinarsPage /></RootLayout>)
    expect(page).toContain('data-screen="v8"')
    expect(layout).toContain('data-theme="v8"')
    expect(layout).not.toContain('<script')

    const container = document.createElement('div')
    container.innerHTML = page
    document.body.appendChild(container)
    const errors: unknown[] = []
    let root!: ReturnType<typeof hydrateRoot>
    try {
      await act(async () => {
        root = hydrateRoot(container, <WebinarsPage />, { onRecoverableError: (error) => errors.push(error) })
      })
      await act(async () => {
        window.dispatchEvent(new Event(ADMIN_THEME_CHANGED_EVENT))
      })
      expect(errors).toEqual([])
      expect(container.querySelector('[data-screen="v8"]')).not.toBeNull()
      expect(storageRead).not.toHaveBeenCalled()
    } finally {
      if (root) await act(async () => root.unmount())
    }
  })
})
