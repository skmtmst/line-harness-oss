// @vitest-environment happy-dom
/*
 * N-251: 広告費は通貨を推測・混合せず、account切替後に前accountの結果を
 * 表示しないことを、本物のReactとapi.ts経由の通信で確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, selectedAccount: null, loading: false }),
}))

import AdIntegration from './ad-integration'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Platform = {
  id: string
  name: string
  displayName: string | null
  config: Record<string, unknown>
  isActive: boolean
  lineAccountId: string
  createdAt: string
  updatedAt: string
}

const requestedUrls: string[] = []
let handler: (path: string) => Promise<unknown> = async () => ({ success: true, data: [] })
let host: HTMLDivElement
let root: Root

function platform(name: string, monthlyCost: number | undefined, currency: unknown, accountId = fixture.accountId): Platform {
  return {
    id: `${accountId}-${name}`,
    name,
    displayName: null,
    config: {
      ...(monthlyCost === undefined ? {} : { monthly_cost: monthlyCost }),
      ...(currency === undefined ? {} : { currency }),
    },
    isActive: true,
    lineAccountId: accountId,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  }
}

function logs() {
  return { success: true, data: { items: [], total: 0, page: 1, limit: 20, sort: [] } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  requestedUrls.length = 0
  handler = async () => ({ success: true, data: [] })
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw
    requestedUrls.push(path)
    return new Response(JSON.stringify(await handler(path)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('N-251 広告費の通貨表示とaccount切替', () => {
  it('JPY/USDを分け、0・未設定・通貨不明を混同しない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      return {
        success: true,
        data: [
          platform('meta', 1000, 'JPY'),
          platform('google', 0, 'USD'),
          platform('x', 500, undefined),
        ],
      }
    }

    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()

    expect(host.textContent).toContain('￥1,000')
    expect(host.textContent).toContain('$0.00')
    expect(host.textContent).toContain('通貨を確認')
    expect(host.textContent).toContain('未設定')
    expect(host.textContent).not.toContain('￥1,500')
    expect(requestedUrls.filter((url) => url.startsWith('/api/ad-platforms')).every((url) => url.includes('lineAccountId=account-a'))).toBe(true)
  })

  it('読込中と失敗を金額の0や未設定として表示しない', async () => {
    const pending = deferred<unknown>()
    handler = async (path) => path.startsWith('/api/ad-platforms/logs') ? logs() : pending.promise

    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    expect(host.textContent).toContain('広告との接続状況を読み込んでいます')

    pending.resolve({ success: false, error: { code: 'unavailable', message: 'failed' } })
    await settle()
    expect(host.textContent).toContain('広告との接続状況を表示できませんでした')
    expect(host.textContent).not.toContain('今月の広告費')
  })

  it('account切替後に遅れて届いた旧accountの通貨・金額を捨てる', async () => {
    const oldPlatforms = deferred<unknown>()
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.includes('lineAccountId=account-a')) return oldPlatforms.promise
      return { success: true, data: [platform('google', 2000, 'USD', 'account-b')] }
    }

    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    fixture.accountId = 'account-b'
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    expect(host.textContent).toContain('$2,000.00')

    oldPlatforms.resolve({ success: true, data: [platform('meta', 999, 'JPY', 'account-a')] })
    await settle()
    expect(host.textContent).toContain('$2,000.00')
    expect(host.textContent).not.toContain('￥999')
    expect(requestedUrls.some((url) => url.includes('lineAccountId=account-a'))).toBe(true)
    expect(requestedUrls.some((url) => url.includes('lineAccountId=account-b'))).toBe(true)
  })
})
