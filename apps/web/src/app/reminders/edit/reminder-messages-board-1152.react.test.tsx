// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 1152 幅の板の印（V8.pen の地図）。板が 1100px を切ったら（画面幅で約 1352px
 * 未満）、手順③の外枠に板 `r1l0bT` を付ける。広い板では `p5YuP` のまま。
 */

let narrowMatches = false
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/reminders/edit',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccount: { id: 'account-1', name: '公式A' },
    selectedAccountId: 'account-1',
    loading: false,
  }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))

import ReminderEditV8 from './edit-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: narrowMatches && query.includes('1351'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    configurable: true,
  })
}

const step = {
  stableStepId: 'step-1',
  offsetMinutes: 0,
  offsetDays: 1,
  sendAtTime: '18:00',
  messageType: 'text',
  messageContent: '{名前}さん、こんにちは。',
}

const settings = {
  name: '予約前日のご案内',
  description: null,
  folderId: null,
  triggerType: 'booking',
  triggerFieldId: null,
  triggerEventId: null,
  repeatYearly: false,
  leapYearPolicy: 'feb28',
  deliveryMode: 'all',
  steps: [step],
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    let body: unknown = { success: true, data: {} }
    if (path.includes('/api/reminders/') && path.includes('/draft')) {
      body = { success: true, data: { reminderId: 'r-1', settings } }
    } else if (path.startsWith('/api/friend-fields')) {
      body = { success: true, data: [] }
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

beforeEach(() => {
  narrowMatches = false
  document.documentElement.dataset.theme = 'v8'
  installMatchMedia()
  installFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function eventually(check: () => void, timeout = 5000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

async function renderMessages() {
  render(<ReminderEditV8 reminderId="r-1" stage="messages" />)
  await eventually(() => {
    if (!document.body.textContent?.includes('通知の中身')) throw new Error('stage not loaded')
  })
}

describe('リマインダ手順③の1152幅の印', () => {
  it('狭い板では外枠に r1l0bT', async () => {
    narrowMatches = true
    await renderMessages()
    const page = document.body.querySelector('[data-design-node="r1l0bT"]')
    expect(page).not.toBeNull()
  })

  it('広い板では p5YuP のまま', async () => {
    narrowMatches = false
    await renderMessages()
    const page = document.body.querySelector('[data-design-node="p5YuP"]')
    expect(page).not.toBeNull()
  })
})
