// @vitest-environment happy-dom
/*
 * V8-B 代理ログイン中（閲覧のみ）`VtJQ6` の帯。
 * 差し替えるのは見た目だけ。書き込みへの切り替え・個人情報の表示・
 * 終える先は今のまま。書き込み中の帯は変えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/hq',
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import ImpersonationBar from './impersonation-bar'

const READ_STATE = {
  id: 'imp-1',
  tenantId: 'tenant-1',
  tenantName: '然 -NEN- 本部',
  mode: 'read',
  piiRevealed: false,
  startedAt: '2026-10-15T15:20:00+09:00',
} as const

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => {
    root.render(<ImpersonationBar initial={{ ...READ_STATE, mode: 'read' }} />)
  })
  return host
}

describe('代理ログイン帯のV8（VtJQ6）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('閲覧のみの帯に板IDと3つの口を出す', () => {
    const host = render()
    expect(host.querySelector('[data-design-node="VtJQ6"]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="WXp5T"]')).toBeNull()
    for (const label of ['代理ログイン中', '閲覧のみ', '個人情報を表示する', '書き込みに切り替える', '代理ログインを終える']) {
      expect(host.textContent).toContain(label)
    }
  })
})
