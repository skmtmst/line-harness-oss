// @vitest-environment happy-dom
/*
 * サイトスクリプト（計測状況）の描画契約。設計 ★V7「監査の直し」D。
 *
 * - 読み込み中：未接続とも失敗とも決めつけない
 * - 未接続：灰色の地＋「未接続」の札＋つなぎ方。0を出さない
 * - 正常：最後に受け取った時刻＋今日の件数（緑は正常の意味だけ）
 * - 読めない：赤を使わない読み込めなかった表示＋最後に受け取った時刻＋確かめ方
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

import SiteScript from './site-script'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const SUMMARY_EMPTY = {
  todayEvents: 0,
  todayPageViews: 0,
  linkedEvents: 0,
  unlinkedEvents: 0,
  pathCount: 0,
  eventTypeCount: 0,
  lastEventAt: null,
}
// 18:02（日本時間）に受け取ったことにする。
const SUMMARY_ACTIVE = { ...SUMMARY_EMPTY, todayEvents: 5, pathCount: 2, lastEventAt: '2026-09-26T09:02:00.000Z' }
const PAGES = [{ host: 'shop.example.com', path: '/thanks', views: 4, visitors: 3 }]

let mode: 'empty' | 'active' | 'failing' = 'empty'
let gated = false
let gate: Array<() => void> = []
function releaseAll() {
  gate.splice(0).forEach((resolve) => resolve())
}

function text(): string {
  return host.textContent ?? ''
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

beforeEach(() => {
  mode = 'empty'
  gated = false
  gate = []
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const raw = typeof input === 'string' ? input : (input as Request).url
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost')
    if (mode === 'failing' && url.pathname !== '/api/client-errors') {
      return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // 読み込み中の絵を確かめられるよう、止めておける。
    if (gated) await new Promise<void>((resolve) => { gate.push(resolve) })
    if (url.pathname === '/api/site/summary') {
      return new Response(
        JSON.stringify({ success: true, data: mode === 'active' ? SUMMARY_ACTIVE : SUMMARY_EMPTY }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.pathname === '/api/site/pages') {
      return new Response(
        JSON.stringify({ success: true, data: mode === 'active' ? PAGES : [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.pathname === '/api/measurement-sites') {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.pathname === '/api/site/tracking-key') {
      return new Response(
        JSON.stringify({ success: true, data: { accountId: 'acc-1', trackingKey: 'hk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('サイトスクリプトの計測状況', () => {
  it('読み込み中は未接続とも失敗とも出さない', async () => {
    gated = true
    await act(async () => { root.render(<SiteScript />) })
    expect(text()).toContain('サイトの計測状況を読み込んでいます')
    expect(text()).not.toContain('未接続')
    expect(text()).not.toContain('読み込めませんでした')
    gated = false
    releaseAll()
    await settle()
  })

  it('未接続：札とつなぎ方を出し、件数の0を並べない', async () => {
    await act(async () => { root.render(<SiteScript />) })
    await settle()
    await settle()

    expect(text()).toContain('未接続')
    expect(text()).toContain('数字は出しません')
    const card = host.querySelector('[aria-label="サイトの計測は未接続"]')
    expect(card).toBeTruthy()
    expect(card?.textContent).not.toMatch(/今日は \d+件/)
    const button = Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes('つなぎ方を見る'))
    expect(button).toBeTruthy()
    await act(async () => { button!.click() })
    await settle()
  })

  it('正常：最後に受け取った時刻と今日の件数を出す', async () => {
    mode = 'active'
    await act(async () => { root.render(<SiteScript />) })
    await settle()

    expect(text()).toContain('動いています')
    expect(text()).toContain('最後にデータが届いたのは 9/26 18:02')
    expect(text()).toContain('今日は 5件')
    expect(host.querySelector('[aria-label="サイトの計測は未接続"]')).toBeFalsy()
    expect(text()).toContain('/thanks')
  })

  it('読めない：赤を使わず、読み直しで復帰できる', async () => {
    mode = 'failing'
    await act(async () => { root.render(<SiteScript />) })
    await settle()

    expect(text()).toContain('サイトの計測を読み込めませんでした')
    expect(text()).toContain('確かめ方を見る')
    expect(host.querySelector('.text-danger')).toBeFalsy()
    const retry = Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()

    mode = 'active'
    await act(async () => { retry!.click() })
    await settle()
    expect(text()).toContain('動いています')
  })

  it('読めなくなっても、最後に受け取った時刻は残す', async () => {
    mode = 'active'
    await act(async () => { root.render(<SiteScript />) })
    await settle()
    expect(text()).toContain('動いています')

    mode = 'failing'
    const check = Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes('いま届いているか確かめる'))
    await act(async () => { check!.click() })
    await settle()

    expect(text()).toContain('サイトの計測を読み込めませんでした')
    expect(text()).toContain('最後に受け取ったのは 9/26 18:02')
  })
})
