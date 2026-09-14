// @vitest-environment happy-dom
/*
 * N-237: 決めごとCSVの書き出しがサーバー口を叩くことを、本物のReactで動かして見る。
 * ブラウザ組み立てではなく /api/mileage/rules/export へ選択accountを付けて取ること。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('tab=earning-rules'),
}))

import MileagePage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchUrls: string[] = []

function stubFetch() {
  fetchUrls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    fetchUrls.push(String(url))
    const text = String(url)
    const data = text.includes('/earning-rules')
      ? {
        items: [{
          id: 'rule-1',
          draft: { name: '決めごと', eventType: 'friend_added', source: null, amount: 10, initialStatus: 'available', validFrom: null, validUntil: null, expiresAfterDays: null, cancellationEventTypes: [], targetConditions: null, sortOrder: 0 },
          draftVersion: 1,
          draftUpdatedAt: '2026-09-01',
          publishedVersion: null,
          published: { name: '決めごと', eventType: 'friend_added', source: null, amount: 10, initialStatus: 'available', validFrom: null, validUntil: null, status: 'published', updatedAt: '2026-09-01' },
          metrics30d: { eligible: 0, granted: 0, excluded: 0 },
        }],
        pagination: { total: 1 },
        unassignedLegacyCount: 0,
      }
      : text.includes('/friends')
        ? { items: [], summary: { totalMembers: 0, withBalanceCount: 0, available: 0, pending: 0 }, pagination: { total: 0, limit: 1, offset: 0 } }
        : text.includes('/history')
          ? { summary: { byType: [] } }
          : {}
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data }),
      blob: async () => new Blob(['csv']),
      text: async () => '',
    }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function csvButton(): HTMLButtonElement {
  const buttons = [...host.querySelectorAll('button')]
  const found = buttons.find((button) => button.textContent === 'CSVで書き出す')
  if (!(found instanceof HTMLButtonElement)) throw new Error('csv button not found')
  return found
}

describe('N-237 決めごとCSVはサーバー口を使う', () => {
  beforeEach(() => {
    stubFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('書き出しボタンでexport口へ選択account付きで取りに行く', async () => {
    await act(async () => {
      root.render(<MileagePage />)
    })
    await settle(150)
    fetchUrls.length = 0
    await act(async () => {
      csvButton().click()
    })
    await settle(100)
    const exported = fetchUrls.filter((url) => url.includes('/api/mileage/rules/export'))
    expect(exported.length).toBeGreaterThan(0)
    for (const url of exported) {
      expect(url).toContain('accountId=acc-1')
    }
  })
})
