// @vitest-environment happy-dom
/*
 * N-251: 広告費は通貨を推測・混合せず、account切替後に前accountの結果を
 * 表示しないことを、本物のReactとapi.ts経由の通信で確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))

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

function platform(name: string, monthlyCost: number | undefined, currency: unknown, accountId = fixture.accountId ?? 'unselected'): Platform {
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
  it('媒体の選択をAPIへ送り、アカウントを替えたら前の媒体で絞らない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'staff' } }
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { rows: [], platforms: [] } }
      return { success: true, data: [platform('google', 100, 'JPY', fixture.accountId!)] }
    }
    await act(async () => { root.render(<AdIntegration view="history" />) })
    await settle()
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="媒体"]')!.click() })
    await act(async () => { Array.from(document.querySelectorAll('[role="option"] button')).find((button) => button.textContent === 'Google広告')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await settle()
    expect(requestedUrls.some((url) => url.includes('adPlatformId=account-a-google'))).toBe(true)
    fixture.accountId = 'account-b'
    await act(async () => { root.render(<AdIntegration view="history" />) })
    await settle()
    const nextAccountCalls = requestedUrls.filter((url) => url.includes('/logs?') && url.includes('lineAccountId=account-b'))
    expect(nextAccountCalls.length).toBeGreaterThan(0)
    expect(nextAccountCalls.every((url) => !url.includes('adPlatformId='))).toBe(true)
  })
  it('閲覧だけの担当者には費用の記録・取り込み・取消を出さない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'staff' } }
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { rows: [], platforms: [], manualEntries: [{ id: 'entry', sourceLabel: 'チラシ', day: '2026-09-20', amountMinor: 100, currency: 'JPY', cancelledAt: null }] } }
      return { success: true, data: [platform('google', 100, 'JPY')] }
    }
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    const buttons = Array.from(host.querySelectorAll('button')).map((button) => button.textContent)
    expect(buttons).not.toContain('費用を手で入れる')
    expect(buttons).not.toContain('広告の状態を再読み込み')
    expect(host.querySelector('[aria-label="チラシの費用の操作"]')).toBeNull()
  })

  it('送信履歴の日時と失敗理由を実データで表示し、再送や次回予定を作らない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return { success: true, data: { items: [{ id: 'log-1', adPlatformId: 'p-1', eventName: 'Purchase', clickIdType: 'gclid', status: 'failed', errorMessage: 'クリックの期限切れ', createdAt: '2026-10-01T12:14:00+09:00' }], total: 1, page: 1, limit: 20 } }
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { rows: [], platforms: [] } }
      return { success: true, data: [] }
    }
    await act(async () => { root.render(<AdIntegration view="history" />) })
    await settle()
    expect(host.textContent).toContain('Purchase')
    expect(host.textContent).toContain('10/1')
    expect(host.textContent).toContain('1件中 1件')
    await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '理由を見る')!.click() })
    expect(host.textContent).toContain('クリックの期限切れ')
    expect(host.textContent).toContain('予定はありません')
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent === 'やり直す')).toBe(false)
  })
  it('JPY/USDを分け、0・未設定・通貨不明を混同しない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { rows: [], platforms: [] } }
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

  it('account未選択では通信せず、選択・解除の両方向で金額を残さない', async () => {
    const selectedPlatforms = deferred<unknown>()
    fixture.accountId = null
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      return selectedPlatforms.promise
    }

    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    expect(host.textContent).toContain('LINEアカウントを選択してください')
    expect(requestedUrls).toHaveLength(0)

    fixture.accountId = 'account-b'
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    expect(requestedUrls.some((url) => url.includes('lineAccountId=account-b'))).toBe(true)

    fixture.accountId = null
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    const callsAfterClearing = requestedUrls.length
    selectedPlatforms.resolve({ success: true, data: [platform('google', 2000, 'USD', 'account-b')] })
    await settle()
    expect(host.textContent).toContain('LINEアカウントを選択してください')
    expect(host.textContent).not.toContain('$2,000.00')
    expect(requestedUrls).toHaveLength(callsAfterClearing)
  })

  it('R277: 同じ経路の費用名で人数を重複せず、円以外と経路なしを分母・分子へ混ぜない', async () => {
    const row = (sourceLabel: string, routeId: string | null, currency: string, amount: number, friends: number | null) => ({
      sourceLabel, entryRouteId: routeId, adPlatformId: null, source: 'manual',
      totals: [{ currency, amountMinor: amount }], friendAdds: friends, costPerFriendMinor: friends ? Math.round(amount / friends) : null, lastImportedAt: null,
    })
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { platforms: [], rows: [
        row('広告A', 'route-1', 'JPY', 10000, 10), row('広告B', 'route-1', 'JPY', 5000, 10),
        row('海外', 'route-2', 'USD', 10000, 10), row('チラシ', null, 'JPY', 7000, null),
      ] } }
      return { success: true, data: [] }
    }
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    expect(host.textContent).toContain('友だち1人あたり')
    expect(host.textContent).toContain('¥1,500')
    await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '友だち1人あたりの説明')!.click() })
    expect(document.body.textContent).toContain('経路がある円の費用')
  })

  it('R278: 30日の送信数はAPIの集計を使い、設定値や表示中の行で変わらない', async () => {
    const trap = platform('meta', undefined, undefined)
    trap.config = { sent_count: 99, pending_count: 88, failed_count: 77 }
    handler = async (path) => {
      if (path.startsWith('/api/ad-platforms/logs')) return {
        success: true,
        data: {
          items: [{
            id: 'l1', adPlatformId: 'p1', friendId: 'f1', lineAccountId: 'account-a',
            eventName: 'Purchase', clickId: null, clickIdType: 'gclid',
            status: 'failed', errorMessage: null, createdAt: '2026-09-27T00:00:00+09:00',
          }],
          total: 1, page: 1, limit: 20,
          summary: { sentLast30Days: 8, pendingLast30Days: 1, failedLast30Days: 1 },
          sort: [],
        },
      }
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { rows: [], platforms: [] } }
      return { success: true, data: [trap] }
    }
    await act(async () => { root.render(<AdIntegration view="connections" />) })
    await settle()
    const metricValue = (label: string) =>
      Array.from(host.querySelectorAll('p')).find((p) => p.textContent === label)?.closest('[data-design-version]')?.querySelectorAll('p')[1]?.textContent ?? ''
    expect(metricValue('送った件数')).toBe('8件')
    expect(metricValue('待っている')).toBe('1件')
    expect(metricValue('断られた')).toBe('1件')
  })

  it('R276: 広告費の空欄・空白は送信せず、明示的な0円だけ送る', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'owner' } }
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return { success: true, data: { rows: [], platforms: [] } }
      return { success: true, data: [] }
    }
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    const button = (label: string) => Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)!
    await act(async () => { button('費用を手で入れる').click() })
    fireEvent.change(document.querySelector('#ad-cost-label')!, { target: { value: 'チラシ' } })
    await act(async () => { fireEvent.click(document.querySelector('#ad-cost-day')!) })
    await act(async () => { fireEvent.click(document.querySelector('[role="grid"] button[data-today]')!) })
    await act(async () => { button('記録する').click(); await Promise.resolve() })
    expect(document.body.textContent).toContain('費用を入力してください')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    fireEvent.change(document.querySelector('#ad-cost-amount')!, { target: { value: '   ' } })
    await act(async () => { button('記録する').click(); await Promise.resolve() })
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    fireEvent.change(document.querySelector('#ad-cost-amount')!, { target: { value: '0' } })
    await act(async () => { button('記録する').click(); await Promise.resolve() })
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
  })

  it('R275: 手で入れた費用を理由つきで取り消し、取消済みは集計外と分かる', async () => {
    const entry = {
      id: 'e-1', sourceLabel: 'チラシ', day: '2026-09-20', amountMinor: 8000,
      currency: 'JPY', entryRouteId: null, cancelledAt: null, cancelReason: null,
      createdAt: '2026-09-20T00:00:00.000Z',
    }
    handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'owner' } }
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return {
        success: true,
        data: { rows: [], platforms: [], manualEntries: [entry] },
      }
      return { success: true, data: [] }
    }
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    const button = (label: string) => Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)!

    expect(host.textContent).toContain('手で入れた費用')
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="チラシの費用の操作"]')!.click() })
    await act(async () => { button('取り消す').click() })
    // 窓の確定ボタンは一覧の同名ボタンと分ける（窓は最後に描かれる）。
    const confirmButton = Array.from(document.querySelectorAll('button'))
      .filter((item) => item.textContent?.trim() === '取り消す').pop()!
    // 理由なしでは送らない
    await act(async () => { confirmButton.click(); await Promise.resolve() })
    expect(document.body.textContent).toContain('取り消す理由を入れてください')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST' && String(init?.body ?? '').includes('reason'))).toBe(false)

    fireEvent.change(document.querySelector('#ad-cost-cancel-reason')!, { target: { value: '金額を間違えた' } })
    await act(async () => { confirmButton.click(); await Promise.resolve() })
    const cancelCall = vi.mocked(fetch).mock.calls.find(([input, init]) =>
      init?.method === 'POST' && String(input).includes('/api/ad-costs/e-1/cancel'))
    expect(cancelCall).toBeTruthy()
    expect(String(cancelCall![1]?.body)).toContain('金額を間違えた')
  })

  it('R275: 取消済みの記録は取り消し済み表示で、もう一度は取り消せない', async () => {
    const entry = {
      id: 'e-2', sourceLabel: 'チラシ', day: '2026-09-20', amountMinor: 8000,
      currency: 'JPY', entryRouteId: null, cancelledAt: '2026-09-21T00:00:00.000Z',
      cancelReason: '日付を間違えた', createdAt: '2026-09-20T00:00:00.000Z',
    }
    handler = async (path) => {
      if (path.startsWith('/api/staff/me')) return { success: true, data: { role: 'owner' } }
      if (path.startsWith('/api/ad-platforms/logs')) return logs()
      if (path.startsWith('/api/ad-costs')) return {
        success: true,
        data: { rows: [], platforms: [], manualEntries: [entry] },
      }
      return { success: true, data: [] }
    }
    await act(async () => { root.render(<AdIntegration view="metrics" />) })
    await settle()
    expect(host.textContent).toContain('取り消し済み')
    expect(host.textContent).toContain('日付を間違えた')
    expect(Array.from(document.querySelectorAll('button')).some((item) => item.textContent?.trim() === '取り消す')).toBe(false)
  })
})
