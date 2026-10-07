// @vitest-environment happy-dom
/*
 * V8 投稿（src/v8/nen-posts）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * V8 のテーマで表示し、本物の api・fetchApi を通す（差し替えるのは通信とアカウントだけ）。
 * - 審査待ちの札：札の名前に件数が1つの文字で付く・数の帯・写真の「見送る」で窓（ujcar）が開く
 * - 閲覧のみ（staff）：閲覧のみの帯を出し、押せない操作（見送る・採用する・選ぶ・まとめて）を置かない
 * - 採用の札（cniyw）：同意ありは「公式サイトに出す」、通知の失敗は「LINE通知を再送」
 * - 版の履歴（N1br7）：版ごとの行と予約中の版。閲覧のみには「新しい版を作る」を置かない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fixture = vi.hoisted(() => ({ role: 'owner' as string }))

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/nen-members',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

import PhotoReviewV8 from './review'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const thisMonth = new Date().toISOString()
function photo(id: string, petName: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, pet_name: petName, pet_call_name: `${petName}ちゃん`, pet_gender: 'female',
    owner_name: '田中 明子', customer_id: '10234', caption: '散歩のあと',
    status, created_at: '2026-09-30T01:00:00.000Z', review_version: 1, latest_risk_flag: 'safe',
    publication_consent_at: '2026-09-01T00:00:00.000Z', publication_withdrawn_at: null,
    review_notification_status: 'sent',
    ...(status === 'pending' ? {} : { reviewed_at: thisMonth }),
    ...extra,
  }
}
const PHOTOS = [
  photo('ph-1', 'こむぎ', 'pending'),
  photo('ph-2', 'そら', 'pending'),
  photo('ph-3', 'もも', 'pending'),
  photo('ph-4', 'きなこ', 'adopted', { awarded_points: 100, point_sync_status: 'synced' }),
  photo('ph-5', 'レオ', 'adopted', { awarded_points: 100, point_sync_status: 'synced', publication_consent_at: null, review_notification_status: 'failed' }),
  photo('ph-6', 'むぎ', 'rejected', { review_reason_code: 'quality' }),
]
const VERSIONS = [
  { versionNumber: 4, policyKey: 'v4', points: 120, publicationPoints: 200, summary: '', effectiveFrom: '2026-10-15T00:00:00+09:00', createdBy: '高田 誠', createdAt: '2026-09-25T20:40:00+09:00', status: 'reserved' },
  { versionNumber: 3, policyKey: 'v3', points: 100, publicationPoints: 200, summary: '', effectiveFrom: null, createdBy: '高田 誠', createdAt: '2026-09-20T10:00:00+09:00', status: 'in_use' },
  { versionNumber: 2, policyKey: 'v2', points: 50, publicationPoints: 150, summary: '', effectiveFrom: null, createdBy: '中川 由美', createdAt: '2026-08-01T09:30:00+09:00', status: 'past' },
]

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  fixture.role = 'owner'
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState(null, '', '/nen-members')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://worker.test')
    if (url.pathname === '/api/staff/me') return json({ success: true, data: { id: 'me', name: 'K', role: fixture.role, email: null } })
    if (url.pathname === '/api/nen-members/photos') return json({ success: true, data: PHOTOS })
    if (url.pathname === '/api/nen-members/photos/review-metrics') return json({ success: true, data: { pendingCount: 3, reviewedCount: 3, averageReviewMinutes: null, oldestPendingAt: null, attentionCount: 0 } })
    if (url.pathname === '/api/nen-members/photos/publications') return json({ success: true, data: { summary: { publishedCount: 18 }, items: [], pendingWithdrawals: [], withdrawnItems: [] } })
    if (url.pathname === '/api/nen-members/photo-reward-policy/versions') return json({ success: true, data: VERSIONS })
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => { root.render(<PhotoReviewV8 accountId="account-a" />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const buttons = (label: string) => [...document.querySelectorAll('button')].filter((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').includes(label) || (button.textContent ?? '').includes(label))
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())
async function click(element: Element | undefined) {
  if (!element) throw new Error('押す相手が見つかりません')
  await act(async () => { (element as HTMLElement).click() })
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

describe('V8 投稿（審査）', () => {
  it('V8 のテーマで、札の名前と件数を1つの文字で出し、数の帯と右の決まりを並べる', async () => {
    await render()
    expect(document.documentElement.dataset.theme).toBe('v8')
    expect(tabs()).toEqual(['審査待ち 3', '採用 2', '見送り 1', '公式サイト掲載'])
    const band = host.querySelector('[data-kpi-strip]')
    expect(band?.textContent).toContain('今月 採用')
    expect(band?.textContent).toContain('1 枚ごとに 100 マイル')
    expect(band?.textContent).toContain('理由：暗くて見えにくいです')
    expect(host.textContent).toContain('さらに 200 マイル')
    expect(host.querySelectorAll('[data-design-node="photo-cards-v8"] > li')).toHaveLength(3)
  })

  it('写真の「見送る」で見送る窓（ujcar）が開き、理由をえらぶと届く文章が変わる', async () => {
    await render()
    await click(buttons('そらちゃんの写真を見送る')[0])
    const dialog = document.querySelector('[data-design-node="ujcar"]')
    expect(dialog?.textContent).toContain('この写真を見送りますか？')
    expect(dialog?.textContent).toContain('写真が暗い・ぼやけている')
    await click([...document.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent?.includes('ほかの人の顔')))
    expect(document.querySelector('[data-design-node="ujcar"]')?.textContent).toContain('人の顔や個人情報が写っている')
  })

  it('閲覧のみには帯を出し、押せない操作を置かない（無効のボタンが1つも無い）', async () => {
    fixture.role = 'staff'
    await render()
    expect(host.textContent).toContain('閲覧のみで見ています')
    for (const label of ['見送る', '採用する', 'まとめて', '公式サイトに出す', 'LINE通知を再送']) {
      expect(buttons(label), label).toHaveLength(0)
    }
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect([...host.querySelectorAll('button')].filter((button) => button.disabled).map((button) => button.textContent)).toEqual([])
    // 見るだけの操作（版の履歴・札）は残す。
    expect(buttons('版の履歴を見る')).toHaveLength(1)
    await click([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.startsWith('採用')))
    expect(host.textContent).toContain('きなこちゃん')
    expect(buttons('公式サイトに出す')).toHaveLength(0)
    expect([...host.querySelectorAll('button')].filter((button) => button.disabled).map((button) => button.textContent)).toEqual([])
  })

  it('採用の札：同意ありは「公式サイトに出す」、通知に失敗した写真は「LINE通知を再送」', async () => {
    await render()
    await click([...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.startsWith('採用')))
    const cards = [...host.querySelectorAll('[data-design-node="photo-cards-v8"] article')]
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('公開の同意あり')
    expect(cards[0].textContent).toContain('公式サイトに出す')
    expect(cards[1].textContent).toContain('公開しない')
    expect(cards[1].textContent).toContain('LINE通知を再送')
    expect(host.textContent).toContain('写真を採用しても自動公開しません')
  })

  it('版の履歴（N1br7）：版の行・予約中の版。閲覧のみには新しい版の入力を置かない', async () => {
    await render()
    await click(buttons('版の履歴を見る')[0])
    const dialog = () => document.querySelector('[data-design-node="N1br7"]')
    expect(dialog()?.textContent).toContain('v3')
    expect(dialog()?.textContent).toContain('採用 100・公式サイト掲載 さらに 200')
    expect(dialog()?.textContent).toContain('いま使っている版')
    expect(dialog()?.textContent).toContain('10/15 00:00 から')
    expect(dialog()?.textContent).toContain('引き出し：新しい版を作る')

    act(() => root.unmount())
    root = createRoot(host)
    fixture.role = 'staff'
    await render()
    await click(buttons('版の履歴を見る')[0])
    expect(dialog()?.textContent).toContain('予約中の版')
    expect(dialog()?.textContent).not.toContain('引き出し：新しい版を作る')
  })
})
