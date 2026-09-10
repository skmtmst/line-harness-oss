// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './page'
import PhotoReviewsPage from './nen-members/page'

/*
 * #666 の本題: ダッシュボードが出す件数と、その深掘り先に実際に並ぶ枚数が
 * 合っているかを「数で」確かめる。
 *
 * 文字が合っているかだけを見ると、集計は選んだ勘定・審査待ちで数えているのに
 * 遷移先は全勘定・全状態を出す、という食い違いが素通りする。ここでは
 *  1. ダッシュボードに出た件数を読み、
 *  2. ダッシュボードが描いたリンク先へそのまま移動し、
 *  3. 遷移先に並んだ写真の枚数と突き合わせる。
 * 仕込みは1つの表から両方の口へ配るので、数字を書き写す余地がない。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string }))

/** 勘定ごとの写真。審査待ち以外も混ぜる（状態の絞り込みが効いているか見る）。 */
const PHOTOS: Record<string, Array<{ id: string; status: 'pending' | 'adopted' | 'rejected' }>> = {
  'account-a': [
    { id: 'a-1', status: 'pending' },
    { id: 'a-2', status: 'pending' },
    { id: 'a-3', status: 'pending' },
    { id: 'a-4', status: 'adopted' },
    { id: 'a-5', status: 'rejected' },
  ],
  'account-b': [
    { id: 'b-1', status: 'pending' },
    { id: 'b-2', status: 'pending' },
    { id: 'b-3', status: 'adopted' },
  ],
}

const pendingOf = (accountId: string) => PHOTOS[accountId].filter((row) => row.status === 'pending')

function photoRow(accountId: string, row: { id: string; status: string }) {
  return {
    id: row.id, pet_name: `ペット-${row.id}`, owner_name: '飼い主', caption: '',
    status: row.status, created_at: '2026-09-01T00:00:00.000Z',
    reviewed_at: row.status === 'pending' ? null : '2026-09-02T00:00:00.000Z',
    review_version: 1, latest_risk_flag: 'safe',
    review_reason_code: row.status === 'rejected' ? 'quality' : null,
    review_notification_status: 'sent',
    line_account_id: accountId,
  }
}

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    <a href={href}>{children as never}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: { id: fixture.accountId, name: '店' },
    loading: false,
  }),
}))

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
    const accountId = query.get('accountId') ?? ''
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    })
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      if (!PHOTOS[accountId]) return json({ success: false, error: 'unknown account' }, 403)
      return json({
        success: true,
        data: {
          // 集計は口の側でも同じ表から数える。画面に書いた数字ではない。
          pendingCount: pendingOf(accountId).length,
          reviewedCount: PHOTOS[accountId].length - pendingOf(accountId).length,
          averageReviewMinutes: null, oldestPendingAt: null, attentionCount: 0,
        },
      })
    }
    if (path.startsWith('/api/nen-members/photos?')) {
      if (!PHOTOS[accountId]) return json({ success: false, error: 'unknown account' }, 403)
      const limit = Number(query.get('limit') ?? '200')
      const offset = Number(query.get('offset') ?? '0')
      const rows = PHOTOS[accountId].slice(offset, offset + limit).map((row) => photoRow(accountId, row))
      return json({ success: true, data: rows })
    }
    return json({ success: false, error: 'not available' }, 404)
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
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installFetch()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function remount(node: React.ReactElement, url: string) {
  await act(async () => { root.unmount() })
  host.remove()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  window.history.replaceState({}, '', url)
  await act(async () => { root.render(node) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

/** ダッシュボードの写真審査カード。件数とリンク先をそのまま読む。 */
function photoCard(): { count: number; detail: string; href: string } {
  const heading = Array.from(host.querySelectorAll('h3')).find(
    (node) => node.textContent?.trim() === '写真審査',
  )
  if (!heading) throw new Error('写真審査のカードが見つかりません')
  const card = heading.parentElement?.parentElement as HTMLElement
  const value = card.querySelector('p')?.textContent?.replace(/[^0-9]/g, '') ?? ''
  const detail = card.querySelector('span[title]')?.getAttribute('title') ?? ''
  const href = (card.querySelector('a[href]') as HTMLAnchorElement).getAttribute('href') ?? ''
  return { count: Number(value), detail, href }
}

/** 遷移先に並んだ写真の枚数。札の中身をそのまま数える。 */
function listedPhotos(): string[] {
  return Array.from(host.querySelectorAll('article'))
    .map((node) => node.querySelector('p')?.textContent?.trim() ?? '')
}

describe('集計範囲と深掘り先の一致(#666)', () => {
  it('ダッシュボードの件数と、そのリンク先に並ぶ枚数が数で一致する', async () => {
    await remount(<DashboardPage />, '/')
    const card = photoCard()
    // 集計は選んだ勘定の審査待ちだけ。全社の枚数でも全状態の枚数でもない。
    expect(card.count).toBe(pendingOf('account-a').length)
    expect(card.detail).toBe(`確認待ち ${pendingOf('account-a').length}件`)
    expect(card.count).not.toBe(PHOTOS['account-a'].length)

    // ダッシュボードが描いたリンク先へ、そのまま移動する。
    await remount(<PhotoReviewsPage />, card.href)
    const listed = listedPhotos()
    expect(listed).toHaveLength(card.count)
    // 名前には画面側で「ちゃん」が付くので、頭で照合する。
    const shows = (id: string) => listed.some((name) => name.startsWith(`ペット-${id}`))
    for (const row of pendingOf('account-a')) expect(shows(row.id)).toBe(true)
    // 審査待ち以外は並ばない。
    expect(shows('a-4')).toBe(false)
    expect(shows('a-5')).toBe(false)
  })

  it('別のLINEアカウントでも、件数と並ぶ枚数がそろって入れ替わる', async () => {
    fixture.accountId = 'account-b'
    await remount(<DashboardPage />, '/')
    const card = photoCard()
    expect(card.count).toBe(pendingOf('account-b').length)
    expect(card.count).not.toBe(pendingOf('account-a').length)

    await remount(<PhotoReviewsPage />, card.href)
    const listed = listedPhotos()
    expect(listed).toHaveLength(card.count)
    expect(listed.every((name) => name.startsWith('ペット-b-'))).toBe(true)
  })
})
