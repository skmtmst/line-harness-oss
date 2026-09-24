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
  // メソッド・ヘッダ・本文まで掴む。Idempotency-Key（#931 N-313）と
  // 差戻しの2つの約束（#931 N-312）を直接読むため。
  requests: [] as Array<{ path: string; method: string; headers: Headers; body: unknown }>,
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
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    net.calls.push(path)
    let parsedBody: unknown = null
    const rawBody = init?.body
    if (typeof rawBody === 'string') {
      try { parsedBody = JSON.parse(rawBody) } catch { parsedBody = rawBody }
    }
    net.requests.push({ path, method, headers, body: parsedBody })
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
  net.requests.length = 0
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

/** いま開いている札の見出し。開いている印が付いている1つだけ。 */
function currentTab(): string {
  // ★V7: ボタン切り替えの札は aria-selected で開いているものを示すため、そちらで探す。
  const current = Array.from(host.querySelectorAll('[aria-selected="true"]'))
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
    expect(currentTab()).toContain('審査待ち')
    expect(host.textContent).toContain('ハナ')
    expect(host.textContent).not.toContain('モモ')
    expect(host.textContent).not.toContain('ソラ')
  })

  it('status=adopted なら採用の札、status=rejected なら見送りの札を開く', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=adopted')
    expect(currentTab()).toContain('採用')
    expect(host.textContent).toContain('モモ')
    expect(host.textContent).not.toContain('ハナ')

    await act(async () => { root.unmount() })
    host.remove()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await renderAt('/nen-members?tab=photos&status=rejected')
    expect(currentTab()).toContain('見送り')
    expect(host.textContent).toContain('ソラ')
  })

  it('指定がない・知らない指定のときは今までどおり審査待ちの札', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=%E5%A3%8A%E3%82%8C%E3%81%9F%E5%80%A4')
    expect(currentTab()).toContain('審査待ち')
    expect(host.textContent).toContain('ハナ')
  })

  it('札を押して切り替えたあとは、URLの指定に引き戻されない', async () => {
    net.handler = listHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=pending_review')
    const adopted = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent?.includes('採用'),
    ) as HTMLButtonElement
    await act(async () => { adopted.click() })
    expect(currentTab()).toContain('採用')
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

/*
 * #931 の画面側ふるまいを本物のReactで固定する。
 * - N-308: 検索語が q= となって口へ届き、URLにも残る
 * - N-309: 「回す」だけでは残らず「向きを保存」が版つきで送られる
 * - N-312: 戻す窓の2チェックが押せて、選んだ内容がそのまま届く
 * - N-313: 審査・通知再送へ写真ごとの Idempotency-Key が付く
 * - N-314: 詳細・選択がURLとsessionStorageから復元される
 */

/** 詳細・差戻し・再送・回転まで通す応答。 */
function detailCapableHandler(all: Array<Record<string, unknown>>, options: {
  retryResults?: Array<{ success: boolean; data?: unknown; error?: string }>
} = {}) {
  const retryResults = [...(options.retryResults ?? [])]
  return (path: string): Promise<unknown> => {
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return Promise.resolve({ success: true, data: METRICS })
    }
    if (path.startsWith('/api/nen-members/photos?')) {
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
      const q = query.get('q') ?? ''
      const limit = Number(query.get('limit') ?? '200')
      const offset = Number(query.get('offset') ?? '0')
      const filtered = q
        ? all.filter((row) => String(row.pet_name).includes(q) || String(row.owner_name).includes(q) || String(row.caption).includes(q))
        : all
      return Promise.resolve(pageOf(filtered.slice(offset, offset + limit)))
    }
    if (path.endsWith('/notification/retry')) {
      const next = retryResults.shift() ?? { success: true, data: { notificationStatus: 'sent', resent: true } }
      return Promise.resolve(next)
    }
    if (path.endsWith('/rotation')) {
      return Promise.resolve({ success: true, data: { rotation: 90, reviewVersion: 2 } })
    }
    if (path.endsWith('/review')) {
      return Promise.resolve({ success: true, data: { awardedPoints: 0, pointBalance: null, pointSync: 'none', notificationStatus: 'sent' } })
    }
    if (path.includes('/assets/status')) {
      return Promise.resolve({ success: true, data: { reviewVersion: 1, jobs: [] } })
    }
    if (path.includes('/assets/derivatives')) {
      return Promise.resolve({ success: true, data: { reviewVersion: 1, items: [], knownUrls: [] } })
    }
    const detail = /^\/api\/nen-members\/photos\/([^/?]+)\?accountId=/.exec(path)
    if (detail) {
      const base = all.find((row) => String(row.id) === decodeURIComponent(detail[1])) ?? all[0]
      return Promise.resolve({
        success: true,
        data: {
          ...base,
          animal_type: 'dog', breed: '柴', submission_count: 1, returned_count: 0,
          image_url: 'https://cdn.example/original.jpg',
          review_image_url: 'https://cdn.example/review.jpg',
          display_rotation: 0, submitter_watch: 0,
        },
      })
    }
    return Promise.reject(new Error(`未設定: ${path}`))
  }
}

function buttonByText(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined
}

function checkboxByLabel(text: string): HTMLInputElement {
  const input = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(
    (item) => item.closest('label')?.textContent?.includes(text),
  ) as HTMLInputElement | undefined
  expect(input, `チェック「${text}」`).toBeTruthy()
  return input!
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('検索で探す(#931 N-308)', () => {
  it('語を入れて「探す」と q= 付きで一覧を取り直し、URLにも語が残る', async () => {
    net.handler = detailCapableHandler(MIXED)
    await renderAt('/nen-members?tab=photos')
    const input = host.querySelector('input[placeholder*="探す"]') as HTMLInputElement
    expect(input).toBeTruthy()
    await act(async () => { setInputValue(input, 'モモ') })
    const submit = buttonByText('探す', host)
    expect(submit).toBeTruthy()
    await act(async () => { submit!.click() })
    await act(async () => { await Promise.resolve() })
    expect(net.calls.some((path) => path.startsWith('/api/nen-members/photos?') && path.includes('q='))).toBe(true)
    expect(decodeURIComponent(window.location.search)).toContain('q=モモ')
    expect(host.textContent).toContain('「モモ」で絞り込んでいます')
  })

  it('q= 付きのURLで開くと、最初からその語で絞り込んでいる', async () => {
    net.handler = detailCapableHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=adopted&q=%E3%83%A2%E3%83%A2')
    await act(async () => { await Promise.resolve() })
    expect(net.calls.some((path) => path.includes('q=%E3%83%A2%E3%83%A2'))).toBe(true)
    expect(host.textContent).toContain('モモ')
    expect(host.textContent).not.toContain('ハナ')
  })
})

describe('戻す約束の2チェック(#931 N-312)', () => {
  it('2つのチェックは押せる状態で、選んだ内容が審査APIへそのまま届く', async () => {
    net.handler = detailCapableHandler(MIXED)
    await renderAt('/nen-members?tab=photos')
    const openReject = buttonByText('見送る', host)
    expect(openReject).toBeTruthy()
    await act(async () => { openReject!.click() })
    await act(async () => { await Promise.resolve() })

    const invite = checkboxByLabel('もう一度 送ってもらえるようお願いする')
    const watch = checkboxByLabel('この人の次の投稿は、必ず人が見る')
    // 以前は disabled のまま押せず、表示の約束を果たせなかった。
    expect(invite.disabled).toBe(false)
    expect(watch.disabled).toBe(false)
    expect(invite.checked).toBe(true)
    expect(watch.checked).toBe(false)

    await act(async () => { invite.click() })
    await act(async () => { watch.click() })
    expect(invite.checked).toBe(false)
    expect(watch.checked).toBe(true)

    const confirm = buttonByText('見送って、この文章を送る')
    expect(confirm).toBeTruthy()
    await act(async () => { confirm!.click() })
    await act(async () => { await Promise.resolve() })

    const reviewRequest = net.requests.find(
      (request) => request.method === 'PUT' && request.path.endsWith('/review'),
    )
    expect(reviewRequest, '審査APIへの送信').toBeTruthy()
    expect(reviewRequest!.body).toMatchObject({
      accountId: 'account-a',
      status: 'rejected',
      reasonCode: 'privacy',
      resubmitInvite: false,
      watchSubmitter: true,
    })
    // N-313: 連打・応答ロストのやり直しを同じ結果へ寄せる鍵。
    expect(reviewRequest!.headers.get('idempotency-key')).toBeTruthy()
  })
})

describe('通知再送のやり直しキー(#931 N-313)', () => {
  it('失敗した再送は同じ Idempotency-Key でやり直す', async () => {
    const failedNotice = [{ ...photo('p-1', 'ハナ', 'rejected'), review_notification_status: 'failed' }]
    net.handler = detailCapableHandler(failedNotice, {
      retryResults: [
        { success: false, error: 'simulated outage' },
        { success: true, data: { notificationStatus: 'sent', resent: true } },
      ],
    })
    await renderAt('/nen-members?tab=photos&status=rejected')
    const retry = buttonByText('LINE通知を再送', host)
    expect(retry).toBeTruthy()
    await act(async () => { retry!.click() })
    await act(async () => { await Promise.resolve() })
    // 失敗してもボタンは残る。もう一度押す。
    const retryAgain = buttonByText('LINE通知を再送', host)
    expect(retryAgain).toBeTruthy()
    await act(async () => { retryAgain!.click() })
    await act(async () => { await Promise.resolve() })

    const retries = net.requests.filter((request) => request.path.endsWith('/notification/retry'))
    expect(retries).toHaveLength(2)
    expect(retries[0].headers.get('idempotency-key')).toBeTruthy()
    // やり直しは同じキー。サーバは保存済みの結果を返せる（重複送信しない）。
    expect(retries[1].headers.get('idempotency-key')).toBe(retries[0].headers.get('idempotency-key'))
    expect(retries[0].body).toMatchObject({ accountId: 'account-a' })
  })
})

describe('写真の向きの保存(#931 N-309)', () => {
  it('「回す」のあと「向きを保存」が版つきで送られ、詳細の表示へ残る', async () => {
    net.handler = detailCapableHandler(MIXED)
    await renderAt('/nen-members?tab=photos')
    const openDetailButton = buttonByText('⛶ 1枚ずつ大きく見る', host)
    expect(openDetailButton).toBeTruthy()
    await act(async () => { openDetailButton!.click() })
    await act(async () => { await Promise.resolve() })

    const rotate = buttonByText('回す')
    const save = buttonByText('向きを保存')
    expect(rotate).toBeTruthy()
    expect(save).toBeTruthy()
    // 回す前は保存できない（向きに変更が無い）。
    expect(save!.disabled).toBe(true)
    await act(async () => { rotate!.click() })
    const saveReady = buttonByText('向きを保存')!
    expect(saveReady.disabled).toBe(false)
    await act(async () => { saveReady.click() })
    await act(async () => { await Promise.resolve() })

    const rotationRequest = net.requests.find(
      (request) => request.method === 'PUT' && request.path.endsWith('/rotation'),
    )
    expect(rotationRequest, '向きの保存API').toBeTruthy()
    expect(rotationRequest!.body).toMatchObject({
      accountId: 'account-a', rotation: 90, expectedVersion: 1,
    })
    expect(rotationRequest!.headers.get('idempotency-key')).toBeTruthy()
    // 詳細の画像が保存した向きへ変わる。
    const image = document.querySelector('img[alt*="審査用写真"]') as HTMLImageElement | null
    expect(image?.style.transform).toContain('rotate(90deg)')
    // 一覧に戻ってもカードが保存した向きを使う。
    await act(async () => { buttonByText('一覧へ戻る')?.click() })
  })
})

describe('戻る・再読込での復元(#931 N-314)', () => {
  it('view=detail のURLで開くと、その写真の詳細へ直接入る', async () => {
    net.handler = detailCapableHandler(MIXED)
    await renderAt('/nen-members?tab=photos&status=pending&view=detail&photo=p-1')
    await act(async () => { await Promise.resolve() })
    // 詳細が開いている（一覧のカードではなく詳細の操作が出る）。
    expect(buttonByText('向きを保存')).toBeTruthy()
    expect(document.body.textContent).toContain('送ってくれた人')
  })

  it('詳細から戻ると一覧へ、進むと同じ詳細へ戻れる', async () => {
    net.handler = detailCapableHandler(MIXED)
    await renderAt('/nen-members?tab=photos')
    await act(async () => { buttonByText('⛶ 1枚ずつ大きく見る', host)!.click() })
    await act(async () => { await Promise.resolve() })
    expect(buttonByText('向きを保存')).toBeTruthy()
    // ブラウザの戻る: URLが一覧へ変わったあと popstate が来る。
    window.history.pushState(null, '', '/nen-members?tab=photos&status=pending')
    await act(async () => { window.dispatchEvent(new Event('popstate')) })
    await act(async () => { await Promise.resolve() })
    expect(buttonByText('向きを保存')).toBeUndefined()
    expect(host.textContent).toContain('ハナ')
    // 進む: 詳細のURLへ戻ると、同じ写真の詳細を取り直して開く。
    window.history.pushState(null, '', '/nen-members?tab=photos&status=pending&view=detail&photo=p-1')
    await act(async () => { window.dispatchEvent(new Event('popstate')) })
    await act(async () => { await Promise.resolve() })
    expect(net.calls.some((path) => path.startsWith('/api/nen-members/photos/p-1?'))).toBe(true)
    expect(buttonByText('向きを保存')).toBeTruthy()
  })

  it('再読込のあとも、選んでいた写真がsessionStorageから戻る', async () => {
    net.handler = detailCapableHandler(MIXED)
    window.sessionStorage.setItem('nen-photo-review:selection:account-a', JSON.stringify(['p-1']))
    await renderAt('/nen-members?tab=photos')
    expect(host.textContent).toContain('1枚を選択中')
  })
})
