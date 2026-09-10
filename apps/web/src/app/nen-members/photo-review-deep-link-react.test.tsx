// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoReviewsPage from './page'

/*
 * #666 N-004: ダッシュボードの「写真審査」から
 * `/nen-members?tab=photos&status=pending_review` で来たときに、
 * 遷移先が本当に審査待ちの札を開くかを、本物のReactで確かめる。
 *
 * あわせて 201 枚目以降へ到達できることも見る。ダッシュボードは全件を
 * 数えるのに一覧が 200 枚で止まっていると、件数と中身が食い違う。
 *
 * 画面の文字を読むだけの契約試験では「URLを読んでいない」がすり抜ける
 * （実際、前の版は href だけ直っていて遷移先は読んでいなかった）。
 * 差し替えるのは通信とアカウント・next/link だけで、api・fetchApi は
 * 実物を通すので、URLの組み立ても応答の解釈も本番と同じ道になる。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))

const net = vi.hoisted(() => ({
  calls: [] as string[],
  handler: ((path: string) => Promise.reject(new Error(`未設定: ${path}`))) as
    (path: string) => Promise<unknown>,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

const METRICS = {
  pendingCount: 0, reviewedCount: 0, averageReviewMinutes: null,
  oldestPendingAt: null, attentionCount: 0,
}

function photo(id: string, petName: string, status: 'pending' | 'adopted' | 'rejected') {
  return {
    id, pet_name: petName, owner_name: '飼い主', caption: '',
    status, created_at: '2026-09-01T00:00:00.000Z',
    reviewed_at: status === 'pending' ? null : '2026-09-02T00:00:00.000Z',
    review_version: 1, latest_risk_flag: 'safe',
    review_reason_code: status === 'rejected' ? 'quality' : null,
    review_notification_status: 'sent',
  }
}

/** 3つの状態がそろった一覧。札を読み違えれば、出る名前で分かる。 */
const MIXED = [
  photo('p-1', 'ハナ', 'pending'),
  photo('p-2', 'モモ', 'adopted'),
  photo('p-3', 'ソラ', 'rejected'),
]

function pageOf(rows: Array<Record<string, unknown>>) {
  return { success: true, data: rows }
}

/** 一覧はページごとに返す。offset で切り出すのは口と同じ形。 */
function listHandler(all: Array<Record<string, unknown>>) {
  return (path: string): Promise<unknown> => {
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return Promise.resolve({ success: true, data: METRICS })
    }
    if (path.startsWith('/api/nen-members/photos?')) {
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
      const limit = Number(query.get('limit') ?? '200')
      const offset = Number(query.get('offset') ?? '0')
      return Promise.resolve(pageOf(all.slice(offset, offset + limit)))
    }
    return Promise.reject(new Error(`未設定: ${path}`))
  }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(path)
    const body = await net.handler(path)
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
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

/** ダッシュボードの深掘りリンクと同じ場所へ「移動してから」画面を出す。 */
async function renderAt(url: string) {
  window.history.replaceState({}, '', url)
  await act(async () => { root.render(<PhotoReviewsPage />) })
  await act(async () => { await Promise.resolve() })
}

/** いま開いている札の見出し。aria-current が付いている1つだけ。 */
function currentTab(): string {
  const current = Array.from(host.querySelectorAll('[aria-current="page"]'))
    .map((node) => node.textContent?.trim() ?? '')
  expect(current).toHaveLength(1)
  return current[0]
}

function loadMoreButton(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.includes('さらに読み込む') || item.textContent?.trim() === '読み込み中...',
  ) as HTMLButtonElement | undefined
}

describe('ダッシュボードからの深掘り(#666 N-004)', () => {
  it('status=pending_review で来たら審査待ちの札を開き、その写真だけを出す', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=pending_review')
    expect(currentTab()).toContain('見ていないもの')
    expect(host.textContent).toContain('ハナ')
    expect(host.textContent).not.toContain('モモ')
    expect(host.textContent).not.toContain('ソラ')
  })

  it('status=adopted なら通したものの札、status=rejected なら戻したものの札を開く', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=adopted')
    expect(currentTab()).toContain('通したもの')
    expect(host.textContent).toContain('モモ')
    expect(host.textContent).not.toContain('ハナ')

    await act(async () => { root.unmount() })
    host.remove()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await renderAt('/nen-members?tab=photos&status=rejected')
    expect(currentTab()).toContain('戻したもの')
    expect(host.textContent).toContain('ソラ')
  })

  it('指定がない・知らない指定のときは今までどおり審査待ちの札', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=%E5%A3%8A%E3%82%8C%E3%81%9F%E5%80%A4')
    expect(currentTab()).toContain('見ていないもの')
    expect(host.textContent).toContain('ハナ')
  })

  it('札を押して切り替えたあとは、URLの指定に引き戻されない', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=pending_review')
    const adopted = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent?.includes('通したもの'),
    ) as HTMLButtonElement
    await act(async () => { adopted.click() })
    expect(currentTab()).toContain('通したもの')
    expect(host.textContent).toContain('モモ')
  })
})

describe('201枚目以降への到達(#666)', () => {
  /** 201枚目にだけ分かる名前を付ける。到達できたかは名前で決める。 */
  const MANY = Array.from({ length: 245 }, (_, index) =>
    photo(`p-${index}`, index === 200 ? 'ニヒャクイチマイメ' : `ペット${index}`, 'pending'))

  it('200枚返ったら「さらに読み込む」を出し、押すと201枚目以降が並ぶ', async () => {
    net.handler = listHandler(MANY)
    await renderAt('/nen-members?tab=photos&status=pending_review')

    expect(net.calls).toContain('/api/nen-members/photos?accountId=account-a&limit=200')
    expect(host.textContent).not.toContain('ニヒャクイチマイメ')
    // 続きがあるあいだは件数を確定値として出さない。
    expect(currentTab()).toContain('200+')

    const more = loadMoreButton()
    expect(more).toBeTruthy()
    await act(async () => { more!.click() })
    await act(async () => { await Promise.resolve() })

    expect(net.calls).toContain('/api/nen-members/photos?accountId=account-a&limit=200&offset=200')
    expect(host.textContent).toContain('ニヒャクイチマイメ')
    expect(currentTab()).toContain('245')
    expect(currentTab()).not.toContain('+')
    // 全部読み終えたら続きの口は消える。
    expect(loadMoreButton()).toBeUndefined()
  })

  it('200枚に満たないときは「さらに読み込む」を出さない', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=pending_review')
    expect(loadMoreButton()).toBeUndefined()
  })
})
