// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FriendTimeline from './friend-timeline'

vi.mock('@/components/chats/template-picker', () => ({ default: () => null }))

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

type Call = { url: string; init?: RequestInit }
const calls: Call[] = []
let postBehavior: (call: Call) => Response = () => json({ success: true, data: { messageId: 'm-1' } })

function responseFor(call: Call): Response {
  const url = new URL(call.url, 'http://localhost')
  if (url.pathname === '/api/friends/friend-a/messages' && (!call.init || !call.init.method || call.init.method === 'GET')) {
    return json({ success: true, data: [] })
  }
  if (url.pathname === '/api/friends/friend-a/messages' && call.init?.method === 'POST') {
    return postBehavior(call)
  }
  return json({ success: true, data: [] })
}

async function eventually(check: () => void, timeout = 1_500): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

function postCalls(): Call[] {
  // 500系のとき fetchApi が内部へ投げる障害レポートのPOSTは除く。
  return calls.filter((c) =>
    c.init?.method === 'POST' && new URL(c.url, 'http://localhost').pathname === '/api/friends/friend-a/messages')
}

describe('N-028/N-029 新規DM送信の失敗表示', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    calls.length = 0
    postBehavior = () => json({ success: true, data: { messageId: 'm-1' } })
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const call = { url: String(input), init }
      calls.push(call)
      return Promise.resolve(responseFor(call))
    })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function typeAndSend(text: string) {
    const textarea = host.querySelector('textarea[aria-label="メッセージを入力"]') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, text)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // 絞り込みタブにも「送信」(outgoing)があるので、送信ボタンは見た目で分ける。
    const button = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === '送信' && b.className.includes('bg-accent-deep'))!
    await act(async () => { button.click() })
  }

  it('429は送信制限と待機時間を出し、入力を残す', async () => {
    postBehavior = () => json({
      success: false,
      error: 'rate limited',
      code: 'LINE_RATE_LIMITED',
      data: { retryable: true, nextRetryAt: new Date(Date.now() + 5 * 60_000).toISOString() },
    }, 429)
    await act(async () => root.render(<FriendTimeline friendId="friend-a" />))
    await eventually(() => expect(host.textContent).toContain('やり取りはまだありません'))

    await typeAndSend('テストです')

    await eventually(() => {
      expect(host.textContent).toContain('送信制限')
      expect(host.textContent).toContain('分後')
    })
    const textarea = host.querySelector('textarea[aria-label="メッセージを入力"]') as HTMLTextAreaElement
    expect(textarea.value).toBe('テストです')
  })

  it('失敗後の再送は同じ冪等キーを使い、LINE・DB追加書込は1回だけになる', async () => {
    let attempt = 0
    postBehavior = () => {
      attempt += 1
      return attempt === 1
        ? json({ success: false, code: 'LINE_TEMPORARILY_UNAVAILABLE',
                 data: { retryable: true, nextRetryAt: null } }, 502)
        : json({ success: true, data: { messageId: 'm-1' } })
    }
    await act(async () => root.render(<FriendTimeline friendId="friend-a" />))
    await eventually(() => expect(host.textContent).toContain('やり取りはまだありません'))

    await typeAndSend('もう一度送る文')
    await eventually(() => expect(host.textContent).toContain('一時的な障害'))

    // 入力は残っているので、そのまま送信ボタンを押す
    const button = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === '送信' && b.className.includes('bg-accent-deep'))!
    await act(async () => { button.click() })

    await eventually(() => expect(postCalls()).toHaveLength(2))
    const keys = postCalls().map((c) => (c.init?.headers as Record<string, string>)['Idempotency-Key'])
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
    await eventually(() => expect(host.textContent).toContain('もう一度送る文'))
  })

  it('送達不明は自動再送を止める案内を出す', async () => {
    postBehavior = () => json({
      success: false,
      code: 'LINE_DELIVERY_UNKNOWN',
      data: { retryable: false, nextRetryAt: null },
    }, 503)
    await act(async () => root.render(<FriendTimeline friendId="friend-a" />))
    await eventually(() => expect(host.textContent).toContain('やり取りはまだありません'))

    await typeAndSend('届いたか不明な文')

    await eventually(() => expect(host.textContent).toContain('自動再送'))
    const textarea = host.querySelector('textarea[aria-label="メッセージを入力"]') as HTMLTextAreaElement
    expect(textarea.value).toBe('届いたか不明な文')
  })

  it('送信中は押しても重複送信しない', async () => {
    let release!: () => void
    // fetchを待たせる形に差し替える
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const call = { url: String(input), init }
      const url = new URL(call.url, 'http://localhost')
      if (url.pathname === '/api/friends/friend-a/messages' && init?.method === 'POST') {
        calls.push(call)
        return new Promise<Response>((resolve) => {
          release = () => resolve(json({ success: true, data: { messageId: 'm-1' } }))
        })
      }
      return Promise.resolve(responseFor(call))
    })

    await act(async () => root.render(<FriendTimeline friendId="friend-a" />))
    await eventually(() => expect(host.textContent).toContain('やり取りはまだありません'))

    const textarea = host.querySelector('textarea[aria-label="メッセージを入力"]') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '連打しても1回')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const button = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent!.includes('送信') && b.className.includes('bg-accent-deep'))!
    await act(async () => {
      button.click()
      button.click()
    })
    release()
    await eventually(() => expect(postCalls()).toHaveLength(1))
  })
})
