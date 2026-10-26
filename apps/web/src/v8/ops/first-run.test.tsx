// @vitest-environment happy-dom
/*
 * 運営ダッシュボードの「最初の10分（新しいお店）」。数と割合を出し、
 * 閲覧のみの人には口を呼ばずに段ごと隠し、代理ログイン中（403）も隠すことを守る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import OpsFirstRunCard from './dashboard/first-run'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const FUNNEL = {
  period: 'month', periodLabel: '今月', accounts: 12,
  stages: [
    { key: 'started', count: 12, percent: 100 },
    { key: 'style', count: 10, percent: 83.3 },
    { key: 'starter', count: 9, percent: 75 },
    { key: 'follow', count: 6, percent: 50 },
    { key: 'firstMessage', count: 5, percent: 41.7 },
  ],
  minutesToFirstMessage: { median: 8, p75: 14, reached: 5 },
  withinTenMinutesPercent: 25,
  allStepsDone: { count: 2, percent: 16.7 },
}

let readOnly = false
let funnelStatus = 200
let calls: string[] = []
let root: Root
let host: HTMLDivElement

beforeEach(() => {
  readOnly = false
  funnelStatus = 200
  calls = []
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/api/ops/me')) return json({ success: true, data: { id: 'ops-1', name: '検証 太郎', email: null, readOnly, totpEnabled: true, lineLinked: false, legacy: false, impersonation: null } })
    if (url.includes('/api/ops/dashboard/first-run')) {
      return funnelStatus === 200
        ? json({ success: true, data: FUNNEL })
        : json({ success: false, error: '代理ログイン中は、このまとめは見られません' }, funnelStatus)
    }
    return json({ success: false, error: 'unexpected' }, 404)
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

async function settle(turns = 12) {
  for (let i = 0; i < turns; i += 1) await act(async () => { await Promise.resolve() })
}
const text = () => document.body.textContent ?? ''

describe('最初の10分（新しいお店）', () => {
  it('分の中央値・75%点・10分以内・6段の全部と、段ごとの数を出す', async () => {
    await act(async () => { root.render(<OpsFirstRunCard period="prev_month" />) })
    await settle()
    expect(calls.some((url) => url.endsWith('/api/ops/dashboard/first-run?period=prev_month'))).toBe(true)
    for (const label of ['最初の1通まで（中央値）', '8 分', '14 分', '25%', '16.7%', 'アカウントを作った', '最初の1通が届いた', '41.7%']) {
      expect(text()).toContain(label)
    }
    expect(document.querySelectorAll('[data-part="funnel-row"]')).toHaveLength(5)
  })

  it('閲覧のみの人には口を呼ばずに出さない', async () => {
    readOnly = true
    await act(async () => { root.render(<OpsFirstRunCard period="month" />) })
    await settle()
    expect(calls.some((url) => url.includes('/first-run'))).toBe(false)
    expect(text()).not.toContain('最初の10分')
  })

  it('代理ログイン中（403）は段ごと隠す', async () => {
    funnelStatus = 403
    await act(async () => { root.render(<OpsFirstRunCard period="month" />) })
    await settle()
    expect(calls.some((url) => url.includes('/first-run'))).toBe(true)
    expect(text()).not.toContain('最初の10分')
  })

  it('ほかの失敗は「もう一度」を出す', async () => {
    funnelStatus = 500
    await act(async () => { root.render(<OpsFirstRunCard period="month" />) })
    await settle()
    expect(text()).toContain('最初の10分を読み込めませんでした')
    expect(text()).toContain('もう一度読み込む')
  })
})
