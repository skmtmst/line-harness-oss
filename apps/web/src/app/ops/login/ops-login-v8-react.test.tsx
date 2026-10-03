// @vitest-environment happy-dom
/*
 * 運営ログインの V8（板 D9JALJ）。
 * V8 では「または」の区切りを出さず、パスワード認証の次に
 * 認証アプリの6桁を入れる順路を書く。v7 はそのまま。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsLoginPage from './page'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<OpsLoginPage />) })
}

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  delete document.documentElement.dataset.theme
})

describe('運営ログインのV8（D9JALJ）', () => {
  it('板IDを持ち、「または」を出さず6桁の順路を書く', async () => {
    document.documentElement.dataset.theme = 'v8'
    await render()
    expect(host.querySelector('[data-design-node="D9JALJ"]')).not.toBeNull()
    expect(host.textContent).not.toContain('または')
    expect(host.textContent).toContain('ログインの次に、認証アプリの6桁の数字を入れます')
    // LINEで入る口は残す（LINEで登録した運営メンバーを締め出さない）。
    expect(host.textContent).toContain('LINE でログイン')
  })

  it('v7は「または」のまま', async () => {
    await render()
    expect(host.querySelector('[data-design-node="InTGF"]')).not.toBeNull()
    expect(host.textContent).toContain('または')
  })
})
