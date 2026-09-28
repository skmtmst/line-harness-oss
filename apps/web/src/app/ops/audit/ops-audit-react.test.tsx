// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsAuditPage from './page'
import type { OpsAuditRow } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** ★V6 37-8 監査ログ。監査 R158（日付範囲のはみ出し）と R159（CSVの範囲）を守る。 */

const row = (index: number): OpsAuditRow => ({
  id: `log-${index}`,
  created_at: '2026-09-27T03:00:00.000Z',
  staff_name: '運営 太郎',
  tenant_name: '株式会社サンプル',
  action: 'tenant.status.change',
  reason: 'テスト',
  ip: '203.0.113.1',
  visible_to_tenant: false,
} as OpsAuditRow)

let host: HTMLDivElement
let root: Root
let calls: Array<{ url: string }>
let totalRows = 0

beforeEach(() => {
  calls = []
  totalRows = 120
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push({ url })
    const params = new URL(url).searchParams
    const limit = Number(params.get('limit') ?? '50')
    const offset = Number(params.get('offset') ?? '0')
    const slice = Array.from({ length: Math.max(0, Math.min(limit, totalRows - offset)) }, (_, i) => row(offset + i))
    return new Response(JSON.stringify({ success: true, data: slice, total: totalRows }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('日付範囲の折返し（R158）', () => {
  it('開始・終了の欄は狭い画面で2段になる形（折返し＋幅追従）', async () => {
    await act(async () => { root.render(<OpsAuditPage />) })
    await flush()
    const from = document.querySelector('button[aria-label="開始日"]')!
    // DateField の器（1段上）→ 欄の包み（w-full sm:w-52）→ 日付範囲の行（flex-wrap）
    const fieldWrap = from.closest('div')!.parentElement!
    const group = fieldWrap.parentElement!
    expect(fieldWrap.className).toContain('w-full')
    expect(fieldWrap.className).toContain('sm:w-52')
    expect(group.className).toContain('flex-wrap')
  })
})

describe('CSVで書き出す（R159）', () => {
  it('表示中の50件ではなく、いまの条件の全件をページを追って取得して書き出す', async () => {
    const createdUrls: Blob[] = []
    const anchorClicks: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => { createdUrls.push(blob); return 'blob:audit' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchorClicks.push(this.download)
    })

    await act(async () => { root.render(<OpsAuditPage />) })
    await flush()
    // 範囲が画面に出る（一覧の件数の1か所。見出しの横では繰り返さない m22d）
    expect(host.textContent).toContain('120件中 1〜50件を表示')
    expect(host.textContent).not.toContain('いまの条件の全')

    const csvButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('CSVで書き出す'))!
    await act(async () => { csvButton.click() })
    await flush()

    // 1ページ50件ではなく、大きい limit で全件を取りにいく
    const exportCalls = calls.filter((c) => c.url.includes('limit=500'))
    expect(exportCalls.length).toBeGreaterThanOrEqual(1)
    const blob = createdUrls[0]
    const text = await blob.text()
    // 見出し 1 行 + 全 120 行
    expect(text.trim().split('\n').length).toBe(121)
    expect(anchorClicks[0]).toMatch(/^musubo-audit-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(host.textContent).toContain('いまの条件の 120 件を書き出しました')
  })
})
