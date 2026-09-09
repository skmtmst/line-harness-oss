// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

/**
 * クロス分析の待機表示を本物のReactで動かす試験(#633)。
 *
 * 文字列の有無を読む契約試験では、「確認が失敗し続けたときに打ち切りを
 * 見ていない」「アカウントを切り替えた後に前の応答が表示へ入る」が
 * すり抜けた。ここは本物のReact(react-dom/client)・本物のタイマー(fake)で
 * 画面に出る文字と通信の本数だけを見る。差し替えるのは通信(fetch)と
 * タブ・アカウント・Linkだけで、api・fetchApiは実物を通す。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string,
}))

const net = vi.hoisted(() => ({
  calls: [] as string[],
  handler: ((url: string) =>
    Promise.reject(new Error(`未設定: ${url}`))) as
      (url: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'cross',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

/**
 * 通信そのものを差し替える。api・fetchApiは実物を通るので、URLの組み立ても
 * 応答の解釈も画面が本番で通る道と同じになる。
 */
function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(path)
    const body = await net.handler(path, init)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

/** 呼び出し側が返す時刻を決める Promise。実APIと同じ非同期境界になる。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const RESULT_URL = /^\/api\/analytics\/cross\/results\/([^?]+)\?/

const crossResultCalls = () => net.calls.filter((url) => RESULT_URL.test(url)).length
const crossResultCallsFor = (id: string) =>
  net.calls.filter((url) => url.startsWith(`/api/analytics/cross/results/${id}?`)).length

/** 待機中の応答。estimatedWaitMs を返すと画面は打ち切り時刻を延ばす。 */
function pending(id: string, estimatedWaitMs: number | null) {
  return {
    success: true,
    data: {
      id,
      state: 'pending',
      errorCode: null,
      result: null,
      createdAt: '2026-09-09T00:00:00.000Z',
      queuePosition: 2,
      pendingAhead: 1,
      estimatedWaitMs,
      nextTickAt: '2026-09-09T00:06:00.000Z',
    },
  }
}

/** 完了した応答。1ますだけの表。 */
function finished(id: string, columnLabel: string) {
  return {
    success: true,
    data: {
      id,
      state: 'available',
      errorCode: null,
      createdAt: '2026-09-09T00:00:00.000Z',
      queuePosition: null,
      pendingAhead: 0,
      estimatedWaitMs: null,
      nextTickAt: null,
      result: {
        lineAccountId: fixture.accountId,
        timeZone: 'Asia/Tokyo',
        rowValues: [{ key: 'route-1', label: '広告A' }],
        columnValues: [{ key: 'choice-1', label: columnLabel }],
        cells: [{
          rowKey: 'route-1', rowLabel: '広告A',
          columnKey: 'choice-1', columnLabel: columnLabel,
          value: 3, uniqueFriends: 3, totalRatio: 1, previousValue: 1, difference: 2,
        }],
        totalValue: 3,
        totalFriends: 3,
        previousTotalValue: 1,
        periodFrom: '2026-08-10T00:00:00.000Z',
        periodTo: '2026-09-09T00:00:00.000Z',
        previousPeriodFrom: '2026-07-11T00:00:00.000Z',
        previousPeriodTo: '2026-08-10T00:00:00.000Z',
        dataCutoffAt: '2026-09-09T00:00:00.000Z',
        state: 'available',
        stateReason: null,
      },
    },
  }
}

/** 画面が触る保存領域。実物と同じ形だけ用意する。 */
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
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T00:00:00.000Z'))
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(<AnalyticsPage />) })
}

async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.includes(label),
  )
  if (!found) throw new Error(`「${label}」のボタンが見つかりません: ${host.textContent}`)
  return found as HTMLButtonElement
}

async function click(label: string) {
  const target = button(label)
  await act(async () => { target.click() })
}

/** 友だち情報欄と権限だけ返し、クロス分析は試験ごとに差し替える。 */
function baseHandler(rest: (url: string, init?: RequestInit) => Promise<unknown>) {
  return (url: string, init?: RequestInit): Promise<unknown> => {
    if (url.startsWith('/api/staff/me')) {
      return Promise.resolve({ success: true, data: { role: 'admin' } })
    }
    if (url.startsWith('/api/friend-fields')) {
      return Promise.resolve({
        success: true,
        data: [{ id: 'field-1', name: '好きな動物', fieldKey: 'pet', fieldType: 'select' }],
      })
    }
    return rest(url, init)
  }
}

describe('クロス分析の待機表示の実挙動(#633)', () => {
  it('確認が失敗し続けても上限15分で自動確認を止め、手動の再確認で同じ集計へ戻る', async () => {
    let started = false
    let failResults = false
    net.handler = baseHandler((url) => {
      if (url.startsWith('/api/analytics/cross/query')) {
        started = true
        return Promise.resolve({ success: true, data: { id: 'run-1', state: 'pending' } })
      }
      if (RESULT_URL.test(url)) {
        // 1本目は成功して「最短20分」を伝える(打ち切りは上限15分まで延びる)。
        // その後は通信が落ち続ける。
        if (!failResults) {
          failResults = true
          return Promise.resolve(pending('run-1', 20 * 60_000))
        }
        return Promise.reject(new Error('offline'))
      }
      return Promise.reject(new Error(`未設定: ${url}`))
    })

    await render()
    await click('この30日を集計')
    expect(started).toBe(true)
    expect(host.textContent).toContain('集計を受け付けました')

    // 失敗が続いても、run IDは消えず確認は続く。
    await wait(60_000)
    expect(host.textContent).toContain('クロス分析を確認できませんでした。確認を続けています')
    expect(host.textContent).not.toContain('自動の確認を止めました')

    // 上限15分の手前ではまだ止まらない。
    await wait(13 * 60_000)
    expect(host.textContent).not.toContain('自動の確認を止めました')
    const beforeDeadline = crossResultCalls()
    expect(beforeDeadline).toBeGreaterThan(5)

    // 上限を越えたら、失敗の待ち時間を空ける前に止める。
    await wait(3 * 60_000)
    expect(host.textContent).toContain('自動の確認を止めました')
    expect(host.textContent).toContain('集計はこのまま続いています')
    expect(host.textContent).toContain('送り直す必要はありません')
    const atStop = crossResultCalls()

    // 止まった後は1本も叩かない。
    await wait(10 * 60_000)
    expect(crossResultCalls()).toBe(atStop)

    // 手動の再確認は同じrunへ戻る。新しい集計は送らない。
    net.handler = baseHandler((url) => {
      if (RESULT_URL.test(url)) return Promise.resolve(finished('run-1', '犬'))
      return Promise.reject(new Error(`未設定: ${url}`))
    })
    await click('結果をもう一度確認')
    await wait(100)
    expect(crossResultCallsFor('run-1')).toBe(atStop + 1)
    expect(net.calls.filter((url) => url.startsWith('/api/analytics/cross/query'))).toHaveLength(1)
    expect(host.textContent).toContain('犬')
    expect(host.textContent).not.toContain('自動の確認を止めました')
  })

  it('打ち切りまでは自動で確認し、結果が出たら表を出す', async () => {
    let done = false
    net.handler = baseHandler((url) => {
      if (url.startsWith('/api/analytics/cross/query')) {
        return Promise.resolve({ success: true, data: { id: 'run-2', state: 'pending' } })
      }
      if (RESULT_URL.test(url)) {
        if (!done) { done = true; return Promise.resolve(pending('run-2', 5 * 60_000)) }
        return Promise.resolve(finished('run-2', '猫'))
      }
      return Promise.reject(new Error(`未設定: ${url}`))
    })

    await render()
    await click('この30日を集計')
    expect(host.textContent).toContain('このLINEアカウント内の順番は2番目です')
    await wait(5_000)
    expect(host.textContent).toContain('猫')
    expect(host.textContent).not.toContain('集計を受け付けました')
  })

  it('アカウントを切り替えた後、前のアカウントの受付応答でポーリングを始めない', async () => {
    const accepted = deferred<unknown>()
    net.handler = baseHandler((url) => {
      if (url.startsWith('/api/analytics/cross/query')) return accepted.promise
      if (RESULT_URL.test(url)) return Promise.resolve(finished('run-a', '犬'))
      return Promise.reject(new Error(`未設定: ${url}`))
    })

    await render()
    await click('この30日を集計')
    expect(host.textContent).toContain('集計を受け付けました')

    // 受付の応答が返る前にアカウントを切り替える。
    fixture.accountId = 'account-b'
    await render()
    expect(host.textContent).toContain('たて・よこの軸を選び')

    // 前のアカウントの受付が後から返っても、待機表示もポーリングも始まらない。
    await act(async () => { accepted.resolve({ success: true, data: { id: 'run-a', state: 'pending' } }) })
    await wait(30_000)
    expect(crossResultCallsFor('run-a')).toBe(0)
    expect(host.textContent).not.toContain('集計を受け付けました')
    expect(host.textContent).not.toContain('犬')
    expect(host.textContent).toContain('たて・よこの軸を選び')
  })

  it('アカウントを切り替えた後、前のアカウントの結果応答を表へ入れない', async () => {
    const late = deferred<unknown>()
    net.handler = baseHandler((url) => {
      if (url.startsWith('/api/analytics/cross/query')) {
        return Promise.resolve({ success: true, data: { id: 'run-a', state: 'pending' } })
      }
      if (url.startsWith('/api/analytics/cross/results/run-a?')) return late.promise
      return Promise.reject(new Error(`未設定: ${url}`))
    })

    await render()
    await click('この30日を集計')
    // 1本目の結果確認が返らないまま、アカウントを切り替える。
    expect(crossResultCallsFor('run-a')).toBe(1)
    fixture.accountId = 'account-b'
    await render()

    await act(async () => { late.resolve(finished('run-a', '犬')) })
    await wait(30_000)
    expect(host.textContent).not.toContain('犬')
    expect(host.textContent).toContain('たて・よこの軸を選び')
    // 切替後に前のアカウントのrunを追いかけ直さない。
    expect(crossResultCallsFor('run-a')).toBe(1)
  })
})
