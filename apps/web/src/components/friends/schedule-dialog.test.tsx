// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/*
 * ★V8 `MyJP7` 予約して送る。
 * - 友だち一覧の行の「…」→「予約して送る」で小窓が開く（受信箱を開かない）
 * - 予約ボタンの文字は「10/2 9:00 に予約」の形
 * - 選んだ日時の札が押された形になり、文と日時で予約の口を呼ぶ
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {} }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))

import FriendRowMenu from './friend-row-menu'
import { formatReserveLabel } from './schedule-dialog'

let root: Root
let host: HTMLDivElement
const calls: Array<{ url: string; body: unknown }> = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') calls.push({ url, body: JSON.parse(String(init.body)) })
    const data = url.includes('/api/templates')
      ? [{ id: 't-1', name: '前日のご案内', messageType: 'text', messageContent: '明日のご予約をお待ちしています。' }]
      : { id: 'sched-1' }
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('押す相手が無い')
  await act(async () => { (el as HTMLElement).click() })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const byText = (text: string) => Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === text)

describe('予約して送る（MyJP7）', () => {
  it('ボタンの文字は「月/日 時:分 に予約」（時に0を付けない）', () => {
    expect(formatReserveLabel('2026-10-02T09:00')).toBe('10/2 9:00 に予約')
    expect(formatReserveLabel('2026-10-12T13:30')).toBe('10/12 13:30 に予約')
  })

  it('行の「…」から開き、テンプレートの文と選んだ日時で予約する', async () => {
    await act(async () => { root.render(<FriendRowMenu friendId="f-1" friendName="ソラ" attention={false} canEdit allowedActions={['template']} onAction={() => {}} />) })
    await click(host.querySelector('button[aria-label="ソラのその他操作"]'))
    await click(byText('予約して送る'))
    expect(document.body.querySelector('[role="dialog"] h2')?.textContent).toBe('ソラさんに予約して送る')
    await click(byText('テンプレートを選択'))
    await click(Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((b) => b.textContent === '前日のご案内'))
    await click(byText('月曜 10:00'))
    expect(byText('月曜 10:00')?.getAttribute('aria-pressed')).toBe('true')
    const reserve = Array.from(document.body.querySelectorAll('button')).find((b) => /に予約$/.test(b.textContent ?? ''))
    await click(reserve)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/chats/f-1/schedule')
    expect(calls[0].body).toMatchObject({ content: '明日のご予約をお待ちしています。' })
    expect(String((calls[0].body as { scheduledAt: string }).scheduledAt)).toMatch(/T10:00:00\+09:00$/)
  })
})
