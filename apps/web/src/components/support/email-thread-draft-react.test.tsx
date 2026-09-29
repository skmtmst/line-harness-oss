// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EmailThread from './email-thread'

/**
 * F06: メール会話の下書きは会話ごとに保管する。
 *
 * 監査の再現手順（Aへ送信中にBへ移るとBの文面が消える、A→B→Aで
 * 下書きが消える）を本物のReactで再現し、直っていることを確認する。
 * 消すのは「送った会話の、送った版」だけ:送信中に同じ会話へ追記した
 * 新しい版は残す。
 */

type ThreadStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'

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

function threadBody(id: string, status: ThreadStatus, subject: string) {
  return {
    success: true,
    data: {
      thread: {
        id,
        subject,
        customer_name: null,
        customer_email: `${id}@example.com`,
        status,
        assigned_staff_id: null,
        notes: null,
        revision: 1,
      },
      messages: [],
    },
  }
}

const state = new Map<string, ThreadStatus>()

function respond(url: string): Promise<unknown> {
  if (url.startsWith('/api/operators')) return Promise.resolve({ success: true, data: [] })
  if (/\/status$/.test(url)) return Promise.resolve({ success: true })
  if (/\/reply$/.test(url)) return Promise.resolve({ success: true })
  const match = /^\/api\/support\/email\/threads\/([^/?]+)$/.exec(url)
  if (match) {
    const id = decodeURIComponent(match[1])
    const status = state.get(id)
    if (!status) return Promise.reject(new Error('not found'))
    return Promise.resolve(threadBody(id, status, `件名 ${id}`))
  }
  return Promise.reject(new Error(`未設定のURL: ${url}`))
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  net.calls.length = 0
  net.handler = respond
  state.clear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('crypto', { randomUUID: () => `key-${net.calls.length}` })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render(threadId: string) {
  await act(async () => {
    root.render(<EmailThread threadId={threadId} onBack={() => undefined} />)
  })
}

const textarea = () => host.querySelector('textarea')!

async function draft(text: string) {
  const el = textarea()
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!
  await act(async () => {
    setter.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickSend() {
  const send = [...host.querySelectorAll('button')].find(
    (x) => x.textContent === 'メールで返信',
  )!
  await act(async () => {
    send.click()
  })
}

it('A→B→A でそれぞれの会話の下書きが戻る', async () => {
  state.set('A', 'unread')
  state.set('B', 'unread')
  await render('A')
  await draft('Aの下書き')
  await render('B')
  await draft('Bの下書き')
  await render('A')
  expect(textarea().value).toBe('Aの下書き')
  await render('B')
  expect(textarea().value).toBe('Bの下書き')
})

it('Aの送信応答が遅れて届いても、表示中のBの下書きは消えない', async () => {
  state.set('A', 'unread')
  state.set('B', 'unread')
  let finish!: (x: unknown) => void
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  net.handler = (url) => (url.endsWith('/reply') ? pending : respond(url))
  await render('A')
  await draft('Aへの返信')
  await clickSend()
  expect(net.calls).toContain('/api/support/email/threads/A/reply')
  await render('B')
  await draft('Bの下書き')
  await act(async () => {
    finish({ success: true })
    await Promise.resolve()
  })
  expect(textarea().value).toBe('Bの下書き')
  // 送った側のAへ戻ると、送信済みの版は消えている。
  await render('A')
  expect(textarea().value).toBe('')
})

it('送信中に同じ会話へ追記した新しい版は、送信成功後も残る', async () => {
  state.set('A', 'unread')
  let finish!: (x: unknown) => void
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  net.handler = (url) => (url.endsWith('/reply') ? pending : respond(url))
  await render('A')
  await draft('送る文面')
  await clickSend()
  // 応答を待つ間に追記。送った版とは違う下書きができている。
  await draft('送る文面に追記')
  await act(async () => {
    finish({ success: true })
    await Promise.resolve()
  })
  expect(textarea().value).toBe('送る文面に追記')
})

it('送信が終わった会話の下書きだけが消える', async () => {
  state.set('A', 'unread')
  state.set('B', 'unread')
  await render('A')
  await draft('Aの返信')
  await render('B')
  await draft('Bの返信')
  await clickSend()
  await act(async () => {
    await Promise.resolve()
  })
  // Bを表示したまま送信が通ったのでBの欄は空になる。
  expect(textarea().value).toBe('')
  // Aの下書きは別会話のものなので残る。
  await render('A')
  expect(textarea().value).toBe('Aの返信')
})
