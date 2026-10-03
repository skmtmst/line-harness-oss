// @vitest-environment happy-dom
/*
 * ★V8-B イベント予約の「イベントを作る」（板 `d4adD4`）。
 * V8 の枠（戻る口・題・説明・板ID）で、今の入力（EventWizard）を包む。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/events/event-wizard', () => ({
  default: ({ step }: { step: number }) => <div data-testid="wizard">段階 {step}</div>,
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import EventsNewV8 from './events-new-v8'

const v8css = readFileSync(join(process.cwd(), 'src/app/events/new/events-new-v8.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/app/events/new/events-new-v8.tsx'), 'utf8')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

describe('V8-B イベントを作る（d4adD4）', () => {
  it('V8 の枠で今の入力を包む', async () => {
    await act(async () => {
      root.render(<EventsNewV8 accountId="acc-1" eventId={null} step={1} />)
    })
    expect(document.querySelector('[data-design-node="d4adD4"]'), '板IDの枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('イベントを作る')
    expect(document.querySelector('[data-testid="wizard"]'), '今の入力が中にある').toBeTruthy()
  })

  it('口座が無いときは選ぶ案内になる', async () => {
    await act(async () => {
      root.render(<EventsNewV8 accountId={null} eventId={null} step={1} />)
    })
    expect(document.body.textContent).toContain('アカウントを選択してください')
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', () => {
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).toContain('data-design-node="d4adD4"')
    expect(v8tsx).not.toContain('準備中')
  })
})
