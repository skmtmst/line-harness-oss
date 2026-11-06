// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupportInbox from './support-inbox'

/**
 * D014・D015 を本物のReactで動かす試験。
 * 差し替えるのは通信(fetchApi)と next/link だけ。
 * D014: channel 欠落・想定外の一覧項目を選んでも「読み込み中」のまま固めず、
 *       理由と取り直しを出す。
 * D015: 通信断から再試行で一覧が回復したら、失敗の赤帯を消す。
 */

type ThreadStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'

const net = vi.hoisted(() => ({
  handler: (url: string): Promise<unknown> => Promise.reject(new Error(`未設定: ${url}`)),
  calls: [] as string[],
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label': string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
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

function item(id: string, name: string, status: ThreadStatus, channel: unknown = 'email') {
  return {
    id,
    threadId: id,
    channel,
    customerName: name,
    customerIdentifier: `${id}@example.com`,
    subject: `件名 ${id}`,
    preview: `本文 ${id}`,
    status,
    lastMessageAt: '2026-09-09T00:00:00.000Z',
    lastIncomingAt: '2026-09-09T00:00:00.000Z',
  }
}

const inboxByStatus = new Map<string, ReturnType<typeof item>[]>()

function respond(url: string): Promise<unknown> {
  if (url.startsWith('/api/support/inbox')) {
    const status = new URL(url, 'http://x').searchParams.get('status') ?? 'open'
    return Promise.resolve({ success: true, data: { items: inboxByStatus.get(status) ?? [] } })
  }
  return Promise.reject(new Error(`未設定のURL: ${url}`))
}

let host: HTMLDivElement
let root: Root
let hidden = false

beforeEach(() => {
  vi.useFakeTimers()
  net.calls.length = 0
  net.handler = respond
  inboxByStatus.clear()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<SupportInbox channel="email" />)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function choose(name: string) {
  const row = Array.from(host.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(name),
  )
  if (!row) throw new Error(`${name} の行が見つかりません`)
  await act(async () => {
    row.click()
  })
}

async function selectFilter(next: string) {
  const select = host.querySelector('select')
  if (!select) throw new Error('絞り込みが見つかりません')
  const setValue = Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    'value',
  )?.set
  await act(async () => {
    setValue?.call(select, next)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('D014/D015 受信箱の失敗表示（本物のReact）', () => {
  it('D014: channel が無い項目を選んでも読み込み中のまま固めない', async () => {
    inboxByStatus.set('open', [
      item('t1', 'ふつうさん', 'unread'),
      { ...item('t9', '形式不明さん', 'unread'), channel: undefined },
    ])
    await render()
    expect(host.textContent).toContain('形式不明さん')

    await choose('形式不明さん')
    const text = host.textContent ?? ''
    // 理由を出す。
    expect(text).toContain('この会話を表示できません')
    expect(text).toContain('形式が読み取れませんでした')
    // 無限の読み込み中にしない。
    expect(text).not.toContain('会話を読み込み中')
    // 取得自体が走らない（走っても取れないものは呼ばない）。
    expect(net.calls.filter((url) => url.includes('/api/support/email/threads/'))).toHaveLength(0)
  })

  it('D015: 回復したら一覧の失敗文を消す', async () => {
    // 最初の一覧 GET だけ通信断にする。
    let first = true
    net.handler = (url: string) => {
      if (url.startsWith('/api/support/inbox') && first) {
        first = false
        return Promise.reject(new Error('network down'))
      }
      return respond(url)
    }
    await render()
    expect(host.textContent).toContain('お問い合わせ一覧を読み込めませんでした')

    // 応答が戻った状態で絞り込みを変える＝取り直し。回復したら赤帯を消す。
    inboxByStatus.set('unread', [item('t2', '回復さん', 'unread')])
    await selectFilter('unread')
    const text = host.textContent ?? ''
    expect(text).toContain('回復さん')
    expect(text).not.toContain('お問い合わせ一覧を読み込めませんでした')
  })
})
