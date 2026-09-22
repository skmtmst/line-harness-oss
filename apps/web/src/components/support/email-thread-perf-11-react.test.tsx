// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmailThread from './email-thread'

/**
 * PERF-11: メール会話の区切り取得。
 *
 * - 初回は新しい側の区画だけ取る
 * - 2回目以降の取り直しは after= の差分だけで、持っている分は消えない
 * - 「過去のメッセージを読み込む」は before= で古い側を上へ足す
 * - 重複・取りこぼし・順序逆転がない
 */

type Msg = { id: string; direction: 'incoming' | 'outgoing'; body_text: string; sent_by_staff_name: string | null; created_at: string }

const net = vi.hoisted(() => ({
  handler: (url: string): Promise<unknown> => Promise.reject(new Error(`未設定: ${url}`)),
  calls: [] as string[],
}))

vi.mock('../../lib/api', async (importOriginal: () => Promise<typeof import('../../lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: (url: string) => {
      net.calls.push(url)
      return net.handler(url)
    },
  }
})

vi.mock('../chats/template-picker', () => ({ default: () => null }))

function msg(i: number): Msg {
  return {
    id: `m-${String(i).padStart(3, '0')}`,
    direction: i % 2 ? 'outgoing' : 'incoming',
    body_text: `本文${i}`,
    sent_by_staff_name: null,
    created_at: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 60_000).toISOString(),
  }
}

function body(threadId: string, messages: Msg[], extra: Partial<{ hasMoreOlder: boolean; oldestCursor: string | null; newestCursor: string | null }> = {}) {
  return {
    success: true,
    data: {
      thread: {
        id: threadId,
        subject: '件名',
        customer_name: null,
        customer_email: 'c@example.com',
        status: 'unread',
        assigned_staff_id: null,
        notes: null,
        revision: 1,
      },
      messages,
      hasMoreOlder: false,
      oldestCursor: null,
      newestCursor: null,
      ...extra,
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  net.calls.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<EmailThread threadId="t1" onBack={() => {}} />)
  })
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('PERF-11 メール会話の差分・履歴取得', () => {
  it('2回目以降の取り直しは after= の差分で、新着だけが下へ足され既存は消えない', async () => {
    net.handler = (url) => {
      if (url.startsWith('/api/operators')) return Promise.resolve({ success: true, data: [] })
      if (url === '/api/support/email/threads/t1') {
        return Promise.resolve(body('t1', [msg(0), msg(1)], { newestCursor: 'c2' }))
      }
      if (url === '/api/support/email/threads/t1?after=c2') {
        return Promise.resolve(body('t1', [msg(2)], { newestCursor: 'c3' }))
      }
      if (url === '/api/support/email/threads/t1?after=c3') {
        // 新着なし。空の差分で今の表示を消してはいけない。
        return Promise.resolve(body('t1', []))
      }
      return Promise.reject(new Error(`未設定: ${url}`))
    }
    await render()
    expect(host.textContent).toContain('本文0')
    expect(host.textContent).toContain('本文1')

    await wait(5000)
    expect(net.calls).toContain('/api/support/email/threads/t1?after=c2')
    expect(host.textContent).toContain('本文2')

    // 差分が空でも全件取り直しへは戻らず、表示は残る。
    net.calls.length = 0
    await wait(5000)
    expect(net.calls).toContain('/api/support/email/threads/t1?after=c3')
    expect(net.calls.every((u) => u !== '/api/support/email/threads/t1')).toBe(true)
    expect(host.textContent).toContain('本文0')
    expect(host.textContent).toContain('本文2')
  })

  it('「過去のメッセージを読み込む」で before= を打ち、古い分が上へ足され重複しない', async () => {
    net.handler = (url) => {
      if (url.startsWith('/api/operators')) return Promise.resolve({ success: true, data: [] })
      if (url === '/api/support/email/threads/t1') {
        return Promise.resolve(body('t1', [msg(50), msg(51)], {
          hasMoreOlder: true,
          oldestCursor: 'c50',
          newestCursor: 'c51',
        }))
      }
      if (url === '/api/support/email/threads/t1?before=c50') {
        // 端が被る古い区画。m-050 が二度来ても二重表示しない。
        return Promise.resolve(body('t1', [msg(50), msg(49), msg(48)].reverse(), {
          hasMoreOlder: false,
          oldestCursor: 'c48',
          newestCursor: 'c50',
        }))
      }
      if (url === '/api/support/email/threads/t1?after=c51') {
        return Promise.resolve(body('t1', []))
      }
      return Promise.reject(new Error(`未設定: ${url}`))
    }
    await render()
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('過去のメッセージ'))
    expect(button).toBeTruthy()
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(net.calls).toContain('/api/support/email/threads/t1?before=c50')
    // 古い3件 + 被った m-050 は1回だけ。
    expect((host.textContent?.match(/本文50/g) ?? []).length).toBe(1)
    expect(host.textContent).toContain('本文48')
    expect(host.textContent).toContain('本文49')
    expect(host.textContent).toContain('本文51')
    // 全件出たのでボタンは消える。
    expect(host.textContent).not.toContain('過去のメッセージを読み込む')
    // 順序: 48 → 49 → 50 → 51
    const text = host.textContent ?? ''
    expect(text.indexOf('本文48')).toBeLessThan(text.indexOf('本文49'))
    expect(text.indexOf('本文49')).toBeLessThan(text.indexOf('本文50'))
    expect(text.indexOf('本文50')).toBeLessThan(text.indexOf('本文51'))
  })
})
