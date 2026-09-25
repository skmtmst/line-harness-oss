// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsAnnouncementsPage from './page'
import { previewLabel, toLocalInput, toPublishAt } from './format'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

/** ★V6 37-7 お知らせ配信。作成欄・送り方・宛先の見込み・一覧（LINE送達／画面で既読）が API の形どおりに出ること。 */

const sent = {
  id: 'a1', subject: '9月20日 深夜のメンテナンスのお知らせ', body: '本文', audienceKind: 'all', audiencePlans: [], audienceTenantIds: [],
  audienceLabel: '全契約先', channels: ['line', 'screen', 'email'], channelLabels: ['LINE', '画面', 'メール'], status: 'sent', statusLabel: '送信済み',
  publishAt: null, sentAt: '2026-09-17T10:00:00.000+09:00', recipientsTotal: 24, lineSent: 21, lineFailed: 0, mailSent: 24, mailFailed: 0,
  screenRead: 5, screenTotal: 24, lastError: null, createdByName: '運営 太郎', createdAt: '2026-09-17T09:00:00.000+09:00', updatedAt: '2026-09-17T10:00:00.000+09:00',
}
const draft = { ...sent, id: 'a2', subject: '料金改定のご案内（下書き）', status: 'draft', statusLabel: '下書き', sentAt: null, recipientsTotal: 0, lineSent: 0, mailSent: 0, screenRead: 0, screenTotal: 0 }

let host: HTMLDivElement
let root: Root
let calls: Array<{ url: string; method: string; body: unknown }>
let lineConfigured = true

beforeEach(() => {
  calls = []
  lineConfigured = true
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ url, method, body })
    let payload: unknown
    if (url.endsWith('/api/ops/announcements/preview')) payload = { success: true, data: { tenants: 12, staff: 24, lineLinked: 21, withEmail: 24 } }
    else if (url.endsWith('/api/ops/announcements') && method === 'POST') payload = { success: true, data: { ...sent, id: 'a3', recipientsTotal: 24, lineSent: 21, mailSent: 24 } }
    else if (url.endsWith('/api/ops/announcements')) payload = { success: true, data: [sent, draft], linked: { linked: 21, total: 24 }, noticeLineConfigured: lineConfigured }
    else if (url.includes('/api/ops/tenants')) payload = { success: true, data: [] }
    else payload = { success: true, data: null }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('表記の決まり', () => {
  it('公開日時は日本時間の ISO に、宛先の見込みは送り方に合わせて出す', () => {
    expect(toPublishAt('2026-09-20T02:00')).toBe('2026-09-20T02:00:00+09:00')
    expect(toPublishAt('')).toBeNull()
    expect(toLocalInput('2026-09-20T02:00:00+09:00')).toBe('2026-09-20T02:00')
    expect(toLocalInput(null)).toBe('')
    expect(previewLabel(null, ['line'])).toBe('宛先を数えています…')
    expect(previewLabel({ tenants: 12, staff: 24, lineLinked: 21, withEmail: 24 }, ['line', 'email']))
      .toBe('12件の契約先・24人の権限者。うち契約者専用LINEに登録済みの21人へ届きます。メールは24人に届きます')
    expect(previewLabel({ tenants: 12, staff: 24, lineLinked: 21, withEmail: 24 }, ['screen'])).toBe('12件の契約先・24人の権限者')
  })
})

describe('画面', () => {
  it('一覧に状態・LINE送達・画面で既読が出て、下書きだけ直す／消すが出る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    const text = host.textContent ?? ''
    expect(text).toContain('契約者専用LINEの登録 21人 / 24人')
    expect(text).toContain('9月20日 深夜のメンテナンスのお知らせ')
    expect(text).toContain('送信済み')
    expect(text).toContain('21 / 24')
    expect(text).toContain('5 / 24')
    expect(text).toContain('下書き')
    expect(text).toContain('12件の契約先・24人の権限者')
    expect(Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === '直す')).toHaveLength(1)
    expect(calls.some((c) => c.url.endsWith('/api/ops/announcements/preview') && c.method === 'POST')).toBe(true)
    expect(host.querySelector('[data-design-node="q2CokV"]')).not.toBeNull()
  })

  it('件名・本文を入れて「今すぐ送る」→確認の窓→送信。mode=send と送り方が API に渡る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    const subject = host.querySelector<HTMLInputElement>('input[placeholder^="例："]')!
    const body = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => { setValue(subject, 'メンテナンスのお知らせ'); setValue(body, '本文です') })
    await act(async () => { button('今すぐ送る')!.click() })
    await flush()
    expect(document.body.textContent).toContain('今すぐ送りますか？')
    await act(async () => { button('送る')!.click() })
    await flush()
    const post = calls.find((c) => c.url.endsWith('/api/ops/announcements') && c.method === 'POST')!
    expect(post.body).toMatchObject({ subject: 'メンテナンスのお知らせ', body: '本文です', audienceKind: 'all', channels: ['line', 'screen'], mode: 'send', publishAt: null })
    expect(host.textContent).toContain('送りました（24人。LINE 21・メール 24）')
  })

  it('公開日時を入れると主ボタンが「配信を予約する」になり、mode=schedule で送る', async () => {
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    await act(async () => {
      setValue(host.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, '予約のお知らせ')
      setValue(host.querySelector<HTMLTextAreaElement>('textarea')!, '本文')
    })
    // 公開日時の選択（★V7）で 2026-09-20 02:00 を選ぶ。値は今までどおり日本時間の文字列。
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="公開日時（日本時間）"]')!.click()
    })
    const picker = host.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
    await act(async () => {
      picker.querySelector<HTMLButtonElement>('button[aria-label="日付"]')!.click()
    })
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find((b) =>
        (b.getAttribute('aria-label') ?? '').startsWith('2026年9月20日（日）'),
      )!.click()
    })
    await act(async () => {
      const hour = picker.querySelector<HTMLSelectElement>('select[aria-label="時"]')!
      hour.value = '02'
      hour.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(button('今すぐ送る')).toBeUndefined()
    await act(async () => { button('配信を予約する')!.click() })
    await flush()
    const post = calls.find((c) => c.url.endsWith('/api/ops/announcements') && c.method === 'POST')!
    expect(post.body).toMatchObject({ mode: 'schedule', publishAt: '2026-09-20T02:00:00+09:00' })
  })

  it('契約者専用LINEが未設定なら注意を出し、LINE を含む送信は止める', async () => {
    lineConfigured = false
    await act(async () => { root.render(<OpsAnnouncementsPage />) })
    await flush()
    expect(host.textContent).toContain('契約者専用LINEのアカウントが未設定です')
    await act(async () => {
      setValue(host.querySelector<HTMLInputElement>('input[placeholder^="例："]')!, 'x')
      setValue(host.querySelector<HTMLTextAreaElement>('textarea')!, 'y')
    })
    await act(async () => { button('今すぐ送る')!.click() })
    await flush()
    await act(async () => { button('送る')!.click() })
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で指定してください')
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/ops/announcements'))).toBe(false)
  })
})
