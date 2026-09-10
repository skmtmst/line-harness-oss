// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './page'

/*
 * #666 N-002/N-004: ダッシュボードの「写真審査」カードを本物のReactで固定する。
 *
 * 押さえる契約:
 *  1. 件数は選んでいるLINEアカウントの審査待ち口から取る（全社概要ではない）
 *  2. 勘定を切り替えたら前の勘定の件数を残さない
 *  3. 権限がないとき・取れなかったときは「読み込み中」を出し続けない
 *  4. 深掘り先は写真の札と審査待ち絞りを引き継ぐ
 *
 * 画面のソースを読むだけの契約試験では 3 がすり抜ける（値が null のまま
 * なので、文字列としては「読み込み中」が正しく書かれている）。
 * 通信とアカウント・遷移だけを差し替え、api・fetchApi は実物を通す。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))

const net = vi.hoisted(() => ({
  calls: [] as string[],
  /** 写真の審査待ち口だけを試験ごとに差し替える。 */
  photos: (() => Promise.resolve({ status: 200, body: { success: true, data: {} } })) as
    () => Promise<{ status: number; body: unknown }>,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    <a href={href} data-testid="dashboard-link">{children as never}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: fixture.accountId ? { id: fixture.accountId, name: '店' } : null,
    loading: false,
  }),
}))

const METRICS = (pendingCount: number) => ({
  success: true,
  data: {
    pendingCount, reviewedCount: 0, averageReviewMinutes: null,
    oldestPendingAt: null, attentionCount: 0,
  },
})

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(path)
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      const { status, body } = await net.photos()
      return new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      })
    }
    /*
     * ほかの区画は「取れない」で返す。画面はどれも取得失敗を自前で扱うので、
     * 写真カードの出し分けだけを見るには十分。5xx にすると別の通報が走る。
     */
    return new Response(JSON.stringify({ success: false, error: 'not available' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
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
  net.calls.length = 0
  net.photos = () => Promise.resolve({ status: 200, body: METRICS(0) })
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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(<DashboardPage />) })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

/** 「写真審査」カードの中身。見出しを含む一番内側の箱を返す。 */
function photoCard(): HTMLElement {
  const heading = Array.from(host.querySelectorAll('h3')).find(
    (node) => node.textContent?.trim() === '写真審査',
  )
  if (!heading) throw new Error(`写真審査のカードが見つかりません: ${host.textContent?.slice(0, 400)}`)
  /* 見出しは「見出し＋リンク」の行に入っている。その1つ外がカード本体。 */
  const card = heading.parentElement?.parentElement
  if (!card) throw new Error('写真審査のカードの外枠が見つかりません')
  return card as HTMLElement
}

describe('ダッシュボードの写真審査カード(#666)', () => {
  it('選んでいるLINEアカウントの審査待ち口から数え、全社概要は呼ばない', async () => {
    net.photos = () => Promise.resolve({ status: 200, body: METRICS(7) })
    await render()
    expect(net.calls).toContain('/api/nen-members/photos/review-metrics?accountId=account-a')
    expect(net.calls.some((path) => path.startsWith('/api/nen-members/overview'))).toBe(false)
    expect(photoCard().textContent).toContain('確認待ち 7件')
  })

  it('深掘り先は写真の札と審査待ち絞りを引き継ぐ', async () => {
    net.photos = () => Promise.resolve({ status: 200, body: METRICS(7) })
    await render()
    const link = photoCard().querySelector('a[href]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/nen-members?tab=photos&status=pending_review')
  })

  it('権限がないときは「読み込み中」のままにせず、権限がない旨を出す', async () => {
    net.photos = () => Promise.resolve({
      status: 403, body: { success: false, error: 'このLINEアカウントを表示する権限がありません' },
    })
    await render()
    const text = photoCard().textContent ?? ''
    expect(text).toContain('写真を見る権限がありません')
    expect(text).not.toContain('読み込み中')
  })

  it('取得に失敗したときも「読み込み中」のままにしない', async () => {
    net.photos = () => Promise.resolve({ status: 500, body: { success: false, error: 'boom' } })
    await render()
    const text = photoCard().textContent ?? ''
    expect(text).toContain('取得できません')
    expect(text).not.toContain('読み込み中')
  })

  it('勘定を切り替えたら前の勘定の件数を残さない', async () => {
    net.photos = () => Promise.resolve({ status: 200, body: METRICS(7) })
    await render()
    expect(photoCard().textContent).toContain('確認待ち 7件')

    fixture.accountId = 'account-b'
    net.photos = () => Promise.resolve({ status: 200, body: METRICS(2) })
    await render()
    expect(net.calls).toContain('/api/nen-members/photos/review-metrics?accountId=account-b')
    const text = photoCard().textContent ?? ''
    expect(text).toContain('確認待ち 2件')
    expect(text).not.toContain('確認待ち 7件')
  })
})
