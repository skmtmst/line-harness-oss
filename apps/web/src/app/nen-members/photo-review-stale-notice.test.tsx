// @vitest-environment happy-dom
/*
 * M508フォロー：成功後に前の失敗案内を消す（同generation内の最小クリア）。
 * root実GUIで 409→GET最新版→同component200成功後に古い
 * 「ほかの担当者が先に審査しました。一覧を読み直してから、もう一度お試しください。」
 * alert が残った残り。通知失敗toast・500再送同key・409keyクリア・list再読込・
 * account世代抑止（M508既存の動き）は触らない。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import PhotoReviewsPage from './page'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))

const net = vi.hoisted(() => ({
  reviewCalls: 0,
  adopted: false,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

const METRICS = {
  pendingCount: 0, reviewedCount: 0, averageReviewMinutes: null,
  oldestPendingAt: null, attentionCount: 0,
}

function photo(status: 'pending' | 'adopted') {
  return {
    id: 'p-1', pet_name: 'ハナ', owner_name: '飼い主', caption: '',
    status, created_at: '2026-09-01T00:00:00.000Z',
    reviewed_at: status === 'pending' ? null : '2026-09-02T00:00:00.000Z',
    review_version: 1, latest_risk_flag: 'safe',
    review_reason_code: null, review_notification_status: 'sent',
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    if (path === '/api/staff/me') return new Response(JSON.stringify({ success: true, data: { role: 'owner' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const method = init?.method ?? 'GET'
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return jsonResponse({ success: true, data: METRICS }, 200)
    }
    if (path.startsWith('/api/nen-members/photos?')) {
      return jsonResponse({ success: true, data: [photo(net.adopted ? 'adopted' : 'pending')] }, 200)
    }
    if (method === 'PUT' && path.endsWith('/review')) {
      net.reviewCalls += 1
      if (net.reviewCalls === 1) {
        return jsonResponse({ success: false, error: 'already reviewed' }, 409)
      }
      net.adopted = true
      return jsonResponse({
        success: true,
        data: { awardedPoints: 0, pointBalance: null, pointSync: 'none', notificationStatus: 'sent' },
      }, 200)
    }
    return jsonResponse({ success: false, error: `未設定: ${path}` }, 500)
  })
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
  net.reviewCalls = 0
  net.adopted = false
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  window.history.replaceState({}, '', '/nen-members')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderAt(url: string) {
  window.history.replaceState({}, '', url)
  await act(async () => { root.render(<PhotoReviewsPage />) })
  await act(async () => { await Promise.resolve() })
}

function adoptButton(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === '採用する',
  ) as HTMLButtonElement | undefined
}

const STALE_ALERT = 'ほかの担当者が先に審査しました'

describe('M508フォロー 成功後に前の失敗案内を消す', () => {
  it('409の案内が出たあと、同画面の再試行が200成功したら古いalertは消える', async () => {
    await renderAt('/nen-members?tab=photos&status=pending_review')
    await waitFor(() => {
      expect(adoptButton()).toBeTruthy()
    })

    // 1回目は409：専用案内が出る（既存の動き）。
    await act(async () => { adoptButton()!.click() })
    await waitFor(() => {
      expect(host.textContent).toContain(STALE_ALERT)
    })

    // 2回目は200成功：pending0/adopted1へ進み、古いalertは消える。
    await act(async () => { adoptButton()!.click() })
    await waitFor(() => {
      expect(net.reviewCalls).toBe(2)
    })
    await waitFor(() => {
      expect(host.textContent).not.toContain(STALE_ALERT)
    })
  })
})
