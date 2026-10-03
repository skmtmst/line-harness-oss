// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EmergencyControlV8 from './control-v8'

/*
 * ★V8-B 運用状態の緊急コントロール（板 `OHwbU`）の契約。
 * 新しい制御タブに切り替わり、何を止めますか・止めるアカウント・
 * 記録の表が出ること、権限が無い人には閲覧のみの帯が出て止める操作が
 * 押せない形になること、止める確認の窓は「停止」の言葉が合うまで
 * 進めないことを実DOMで固定する。
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={String(href)}>{children}</a>
  ),
}))

const impact = {
  broadcast_dispatch: { itemCount: 3, friendCount: 120, friendCountIsPartial: false, nearestScheduledAt: null, pendingCount: 0 },
  scenario_dispatch: { itemCount: 2, friendCount: 45, friendCountIsPartial: false, nearestScheduledAt: null, pendingCount: 0 },
  reminder_dispatch: { itemCount: 1, friendCount: 10, friendCountIsPartial: false, nearestScheduledAt: null, pendingCount: 0 },
  automation_actions: { itemCount: 0, friendCount: 0, friendCountIsPartial: false, nearestScheduledAt: null, pendingCount: 0 },
  auto_reply_dispatch: { itemCount: 1, friendCount: null, friendCountIsPartial: false, nearestScheduledAt: null, pendingCount: 0 },
}

const controlBase = {
  scopeKey: 'all',
  lineAccountId: null,
  version: 7,
  states: {
    broadcast_dispatch: 'running',
    scenario_dispatch: 'running',
    reminder_dispatch: 'running',
    automation_actions: 'running',
    auto_reply_dispatch: 'running',
  },
  activeIncidentId: null,
  reason: null,
  actorId: null,
  stoppedAt: null,
  updatedAt: '2026-10-02T06:00:00.000Z',
}

let canControl = true

const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  canControl = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/operations/control/preview')) {
      return response({
        success: true,
        data: {
          control: controlBase,
          counts: {},
          impact,
          permissions: { canControl },
          calculatedAt: '2026-10-02T06:00:00.000Z',
        },
      })
    }
    if (url.includes('/api/operations/history')) {
      return response({ success: true, data: [] })
    }
    return response({ success: false, error: 'not mocked' }, 500)
  }))
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
  vi.unstubAllGlobals()
})

test('記録の読み込み中は表の形の骨組みが出て「読み込み中」の文字は無い', async () => {
  vi.useFakeTimers()
  try {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/operations/control/preview')) {
        return response({
          success: true,
          data: {
            control: controlBase,
            counts: {},
            impact,
            permissions: { canControl },
            calculatedAt: '2026-10-02T06:00:00.000Z',
          },
        })
      }
      // 記録だけ返さず、読み込み中のままにする。
      if (url.includes('/api/operations/history')) return new Promise<Response>(() => {})
      return response({ success: false, error: 'not mocked' }, 500)
    }))
    await act(async () => {
      root?.render(<EmergencyControlV8 accounts={[]} />)
    })
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    expect(host?.querySelector('[aria-label="止めた・戻した記録を読み込んでいます"]')).not.toBeNull()
    expect(host?.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
    expect(host?.textContent).not.toContain('読み込み中')
  } finally {
    vi.useRealTimers()
  }
})

async function renderControl() {
  await act(async () => {
    root?.render(<EmergencyControlV8 accounts={[]} />)
  })
  /* 口（preview・history）の応答が返って描き終わるまで待つ。 */
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

test('新しい制御タブ（OHwbU）が出る', async () => {
  await renderControl()
  expect(host?.querySelector('[data-design-node="OHwbU"]')).not.toBeNull()
  expect(host?.textContent).toContain('何を止めますか')
  expect(host?.textContent).toContain('止めた・戻した記録')
})

test('権限が無い人には閲覧のみの帯が出て止められない', async () => {
  canControl = false
  await renderControl()
  expect(host?.textContent).toContain('閲覧のみで見ています')
  const stopButton = Array.from(host?.querySelectorAll('button') ?? [])
    .find((button) => button.textContent === '選んだものを止める')
  expect(stopButton?.hasAttribute('disabled')).toBe(true)
})

test('止める確認の窓は「停止」の言葉が合うまで進めない', async () => {
  await renderControl()
  const stopButton = Array.from(host?.querySelectorAll('button') ?? [])
    .find((button) => button.textContent === '選んだものを止める')
  expect(stopButton).toBeDefined()
  await act(async () => {
    ;(stopButton as HTMLButtonElement | undefined)?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  /* 確認の窓は body 直下に出る（ポータル）。 */
  expect(document.body.textContent).toContain('選んだものを止めますか？')
  const proceed = Array.from(document.body.querySelectorAll('button'))
    .find((button) => button.textContent === '配信を緊急停止する')
  expect(proceed?.hasAttribute('disabled')).toBe(true)
})
