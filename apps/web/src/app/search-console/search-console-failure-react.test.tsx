// @vitest-environment happy-dom
/*
 * D020: Search Console の読み込み失敗を一律「閲覧権限の確認が必要」にしない。
 * - 403（Google側の閲覧権限なし）だけ権限の案内カード
 * - 通信断・500・429・success:false は失敗の理由と再読み込み
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchConsolePerformance } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  performance: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/search-console',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      searchConsole: { performance: mocks.performance },
    },
  }
})

const { ApiError } = await import('@/lib/api')
const { default: SearchConsolePage } = await import('./page')

const connected: SearchConsolePerformance = {
  status: 'connected',
  siteUrl: 'https://example.com/',
  startDate: '2026-08-01',
  endDate: '2026-08-28',
  rangeDays: 28,
  summary: { clicks: 120, impressions: 3000, ctr: 0.04, position: 8.5 },
  previousSummary: { clicks: 100, impressions: 2800, ctr: 0.035, position: 9.1 },
  daily: [{ key: '2026-08-01', clicks: 10, impressions: 200, ctr: 0.05, position: 8 }],
  queries: [],
  pages: [],
  devices: [],
  fetchedAt: '2026-08-29T00:00:00+09:00',
}

let host: HTMLDivElement
let root: Root
let mounted = false

beforeEach(() => {
  mocks.performance.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderPage() {
  await act(async () => {
    root.render(<SearchConsolePage />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

function text(): string {
  return document.body.textContent ?? ''
}

function retryButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'もう一度読み込む') as HTMLButtonElement | undefined
}

describe('D020 Search Console の読み込み失敗の言い分け', () => {
  it('500では権限カードにせず失敗と再読み込みを出す', async () => {
    mocks.performance.mockRejectedValueOnce(new ApiError(500, 'Internal server error'))
    await renderPage()
    await settle()
    expect(text()).not.toContain('閲覧権限の確認が必要です')
    expect(retryButton()).toBeTruthy()
  })

  it('通信断では権限カードにせず失敗と再読み込みを出す', async () => {
    mocks.performance.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await renderPage()
    await settle()
    expect(text()).not.toContain('閲覧権限の確認が必要です')
    expect(retryButton()).toBeTruthy()
  })

  it('success:false の200では権限カードにせず失敗と再読み込みを出す', async () => {
    mocks.performance.mockResolvedValueOnce({ success: false, error: 'upstream failed' })
    await renderPage()
    await settle()
    expect(text()).not.toContain('閲覧権限の確認が必要です')
    expect(retryButton()).toBeTruthy()
  })

  it('403では権限の案内カードを出す（再読み込みは出さない）', async () => {
    mocks.performance.mockRejectedValueOnce(new ApiError(403, 'forbidden'))
    await renderPage()
    await settle()
    expect(text()).toContain('閲覧権限の確認が必要です')
    expect(retryButton()).toBeFalsy()
  })

  it('再読み込みで直ればデータが出る', async () => {
    mocks.performance
      .mockRejectedValueOnce(new ApiError(500, 'Internal server error'))
      .mockResolvedValueOnce({ success: true, data: connected })
    await renderPage()
    await settle()
    const retry = retryButton()
    if (!retry) throw new Error('再読み込みのボタンがありません')
    await act(async () => { retry.click(); await Promise.resolve() })
    await settle()
    await settle()
    expect(mocks.performance).toHaveBeenCalledTimes(2)
    expect(text()).toContain('連携中')
  })
})
