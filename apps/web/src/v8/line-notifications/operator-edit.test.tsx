// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OPERATOR_EVENT_OPTIONS } from '@/app/line-notifications/operator-event-options'
import { EVENT_OPTIONS, eventPlaceLabel } from './operator-words'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/*
 * ★V8 運用者へのお知らせを なおす（板 hiBO8）・作る（gjUz3）の動き。
 * - ?id= で開くと、保存ずみの名前で題が「「〇〇」を編集する」になり、選んでいない人も並ぶ
 * - 受け取るスタッフは、選ぶ・外すで「選択 N人」が変わる
 * - きっかけの写しは正本（app/line-notifications/operator-event-options.ts）と同じ
 */
const search = { value: 'id=rule-9' }
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/line-notifications/operator/new',
  useSearchParams: () => new URLSearchParams(search.value),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

import OperatorEditV8 from './operator-edit'

const recipients = {
  items: [
    { id: 'a', name: '高田 誠', lineLinked: true, emailVerified: false, channels: { line: true, email: false, dashboard: true }, canReceive: true },
    { id: 'b', name: '山本 健', lineLinked: false, emailVerified: false, channels: { line: false, email: false, dashboard: true }, canReceive: true },
    { id: 'c', name: '佐藤 杏', lineLinked: true, emailVerified: false, channels: { line: true, email: false, dashboard: true }, canReceive: true },
  ],
  summary: { staff: 3, canReceive: 3, line: 2, email: 0, dashboard: 3, unavailable: 0 },
}
const rule = {
  id: 'rule-9', name: '新しい予約が入りました', eventType: 'booking_created', version: 3,
  conditions: { recipientIds: ['a', 'b'], importance: 'important', dedupeMinutes: 10 },
  channels: ['dashboard', 'line', 'email'],
}
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root | null = null
let host: HTMLDivElement | null = null
const store = new Map<string, string>()

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) }, clear: () => store.clear() },
  })
  store.set('lh_staff_role', 'admin')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('recipients-preview')) return json({ success: true, data: recipients })
    if (url.includes('/api/notifications/teams')) return json({ success: true, data: [] })
    if (url.includes('/operator-rules/rule-9')) return json({ success: true, data: rule })
    if (url.includes('/operator-rules') && (init?.method ?? 'GET') === 'POST') return json({ success: true, data: { ...rule, id: 'rule-new', version: 1 } })
    if (url.endsWith('/api/staff')) return json({ success: true, data: [{ id: 'a', name: '高田 誠', role: 'admin' }, { id: 'b', name: '山本 健', role: 'staff' }] })
    return json({ success: false, error: 'not mocked' })
  }))
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  store.clear()
  search.value = 'id=rule-9'
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => { root?.render(<OperatorEditV8 />) })
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('運用者へのお知らせを なおす（hiBO8）', () => {
  test('保存ずみの名前で題を出し、選んでいない人も並べて数を数える', async () => {
    await render()
    expect(host?.querySelector('[data-design-node="hiBO8"]')).not.toBeNull()
    expect(host?.querySelector('h1')?.textContent).toBe('「新しい予約が入りました」を編集する')
    const rows = Array.from(host?.querySelectorAll('ul[class*=staffList] > li') ?? []).map((li) => li.textContent ?? '')
    expect(rows.length).toBe(3)
    expect(rows[1]).toContain('LINE 未ログイン')
    expect(host?.textContent).toContain('選択 2人／LINEで受け取れる 1人／管理画面で受け取れる 2人')
    // 保存ずみの「メールでも送る」を戻す。
    const mail = Array.from(host?.querySelectorAll('label') ?? []).find((label) => label.textContent?.includes('メールでも送る'))
    expect(mail?.querySelector('input')?.checked).toBe(true)
    expect(host?.textContent).toContain('予約管理で見る ›')
  })

  test('作るときは題が「運用者へのお知らせを作る」で、全員を選んでおく', async () => {
    search.value = ''
    await render()
    expect(host?.querySelector('[data-design-node="gjUz3"]')).not.toBeNull()
    expect(host?.querySelector('h1')?.textContent).toBe('運用者へのお知らせを作る')
    expect(host?.textContent).toContain('選択 3人／LINEで受け取れる 2人')
  })
})

describe('公開前の確認の窓（sDXNy）', () => {
  test('要約は題と値の2列、宛先の行は名前・役割・札。ボタンは届く人数を言う', async () => {
    search.value = ''
    await render()
    const publish = Array.from(host?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('運用者へのお知らせを公開'))
    await act(async () => {
      ;(publish as HTMLButtonElement).click()
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    })
    const dialog = document.body.querySelector('[data-design-node="sDXNy"]')
    expect(dialog).not.toBeNull()
    const lines = Array.from(dialog?.querySelectorAll('p[class*=confirmLine]') ?? []).map((p) => Array.from(p.children).map((c) => c.textContent))
    expect(lines).toEqual([
      ['お知らせ', '新しい予約が入りました'],
      ['宛先', '選んだスタッフ 3 人'],
      ['LINE が届く人', '2 人（1 人は LINE 未登録）'],
    ])
    const rows = Array.from(dialog?.querySelectorAll('li[class*=confirmRow]') ?? []).map((li) => Array.from(li.children).map((c) => c.textContent))
    expect(rows).toEqual([
      ['高田 誠', '管理者', 'LINE'],
      ['山本 健', 'スタッフ', '画面だけ'],
      ['佐藤 杏', '', 'LINE'],
    ])
    expect(dialog?.textContent).toContain('LINE 未登録の人には、管理画面のお知らせだけで届きます。')
    const send = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('公開して'))
    expect(send?.textContent).toBe('公開して 2 人に LINE で送る')
  })
})

test('きっかけの写しは正本と同じ（ずれると公開しても届かない）', () => {
  expect(EVENT_OPTIONS).toEqual(OPERATOR_EVENT_OPTIONS)
  for (const option of EVENT_OPTIONS) expect(eventPlaceLabel(option.value)).not.toBe('管理画面')
})

test('お知らせの公開中は窓の×・Esc・戻って直すを止める', async () => {
  search.value = ''
  const previousFetch = globalThis.fetch
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/publish')
    ? new Promise<Response>(r => { resolve = r }) : previousFetch(input, init))
  await render()
  await act(async () => {
    const publish = [...host!.querySelectorAll('button')].find(b => b.textContent?.includes('運用者へのお知らせを公開'))!
    publish.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  await act(async () => {
    const send = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('公開して 2 人'))!
    send.click()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  const dialog = document.querySelector('[data-design-node="sDXNy"]')!
  expect(dialog.querySelector('button[aria-label="閉じる"]')?.hasAttribute('disabled')).toBe(true)
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(document.querySelector('[data-design-node="sDXNy"]')).toBeTruthy()
  await act(async () => resolve(json({ success: true, data: rule })))
})
