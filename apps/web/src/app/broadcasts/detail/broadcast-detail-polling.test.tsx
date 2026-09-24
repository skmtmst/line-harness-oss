// @vitest-environment happy-dom
/*
 * 新しい配信詳細の送信中の自動更新。
 *
 * 送信中に開いた人が止まった数字を見続けないよう、status が sending の
 * 間だけ5秒ごとに配信を取り直す。送り終わった・失敗した・画面を離れたら
 * 止める。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiBroadcast } from '@/lib/api'

const net = vi.hoisted(() => ({
  getCalls: 0,
  get: (_id: string): Promise<unknown> => Promise.reject(new Error('未設定')),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=bc-1'),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        get: (id: string) => net.get(id),
        getInsight: () => Promise.resolve({ success: true, data: null }),
      },
    },
  }
})

import BroadcastDetailPage from './page'

function broadcast(over: Partial<ApiBroadcast> & { id: string }): ApiBroadcast {
  return {
    title: `配信 ${over.id}`,
    messageType: 'text',
    messageContent: '本文',
    targetType: 'all',
    targetTagId: null,
    status: 'sending',
    scheduledAt: null,
    sentAt: null,
    totalCount: 10,
    successCount: 2,
    createdAt: '2026-09-09T00:00:00.000Z',
    lineAccountId: null,
    accountIds: null,
    dedupPriority: null,
    failedAccountIds: null,
    trackLinks: false,
    ...over,
  } as ApiBroadcast
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  net.getCalls = 0
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function show() {
  await act(async () => {
    root.render(<BroadcastDetailPage />)
  })
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('送信中の自動更新', () => {
  it('sending の間だけ5秒ごとに取り直し、終わったら止まる', async () => {
    const sending = broadcast({ id: 'bc-1', status: 'sending', totalCount: 10, successCount: 2 })
    const sent = broadcast({ id: 'bc-1', status: 'sent', totalCount: 10, successCount: 10 })
    // 2回目までは送信中、3回目で完了を返す。
    net.get = () => {
      net.getCalls += 1
      return Promise.resolve({ success: true, data: net.getCalls < 3 ? sending : sent })
    }

    await show()
    expect(net.getCalls).toBe(1)
    expect(host.textContent).toContain('2 / 10 件')

    // 5秒で取り直し、進んだ数字が出る（まだ送信中なので続ける）。
    await wait(5000)
    expect(net.getCalls).toBe(2)
    // さらに5秒で完了を受け取り、全体を取り直す（+1）。
    await wait(5000)
    expect(net.getCalls).toBe(4)
    // 送り終わったら止まる。進めても取り直さない。
    await wait(20000)
    expect(net.getCalls).toBe(4)
  })

  it('画面を離れたら止まる', async () => {
    const sending = broadcast({ id: 'bc-1', status: 'sending', totalCount: 10, successCount: 2 })
    net.get = () => {
      net.getCalls += 1
      return Promise.resolve({ success: true, data: sending })
    }

    await show()
    expect(net.getCalls).toBe(1)
    await wait(5000)
    expect(net.getCalls).toBe(2)
    await act(async () => {
      root.unmount()
    })
    await wait(20000)
    expect(net.getCalls).toBe(2)
  })
})
