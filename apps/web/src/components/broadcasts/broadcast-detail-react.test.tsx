// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiBroadcast } from '@/lib/api'
import BroadcastDetail from './broadcast-detail'

/**
 * 一斉配信の詳細を本物のReactで動かす試験(#630)。
 *
 * 別の配信へ移った直後は「前の配信の全文」と「新しい配信のID」が
 * 同時に画面へ載る一瞬がある。そこで応答が混ざると、題名Aに件数Bの
 * ような画面になる。IDを見て捨てているかを、画面に出る文字で確かめる。
 * 差し替えるのは通信と、この試験に関係しない見た目の部品だけ。
 */

const net = vi.hoisted(() => ({
  get: (id: string): Promise<unknown> => Promise.reject(new Error(`未設定: ${id}`)),
  progress: (id: string): Promise<unknown> => Promise.reject(new Error(`未設定: ${id}`)),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}))

vi.mock('../../contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: null, accounts: [] }),
}))

vi.mock('../layout/header', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('./progress-bar', () => ({
  default: ({ totalCount, successCount }: { totalCount: number; successCount: number }) => (
    <p>{`進捗 ${successCount}/${totalCount}`}</p>
  ),
}))

vi.mock('../flex-preview', () => ({ default: () => null }))
vi.mock('./test-send-section', () => ({ default: () => null }))
vi.mock('./send-confirm-dialog', () => ({ default: () => null }))
vi.mock('./segment-builder', () => ({ default: () => null }))

vi.mock('../../lib/api', async (importOriginal: () => Promise<typeof import('../../lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        get: (id: string) => net.get(id),
        getProgress: (id: string) => net.progress(id),
        getInsight: () => Promise.resolve({ success: false }),
        perAccountStats: () => Promise.resolve({ success: false }),
        previewCount: () => Promise.resolve({ success: false }),
      },
    },
  }
})

function broadcast(over: Partial<ApiBroadcast> & { id: string }): ApiBroadcast {
  return {
    title: `配信 ${over.id}`,
    messageType: 'text',
    messageContent: '本文',
    targetType: 'all',
    targetTagId: null,
    status: 'sending',
    scheduledAt: null,
    sentAt: null,
    totalCount: 0,
    successCount: 0,
    createdAt: '2026-09-09T00:00:00.000Z',
    lineAccountId: null,
    accountIds: null,
    dedupPriority: null,
    failedAccountIds: null,
    trackLinks: false,
    ...over,
  } as ApiBroadcast
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function show(id: string) {
  await act(async () => {
    root.render(<BroadcastDetail broadcastId={id} />)
  })
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('一斉配信詳細の実React動作(#630)', () => {
  it('送信済みAから送信中Bへ移ると、Aの送信済みを理由にBの全文を捨てない', async () => {
    const rows: Record<string, ApiBroadcast> = {
      A: broadcast({ id: 'A', status: 'sent', totalCount: 10, successCount: 10, sentAt: '2026-09-09T00:00:00.000Z' }),
      B: broadcast({ id: 'B', status: 'sending', totalCount: 4, successCount: 1 }),
    }
    net.get = (id: string) => Promise.resolve({ success: true, data: rows[id] })
    net.progress = () => new Promise(() => undefined)

    await show('A')
    expect(host.textContent).toContain('配信 A')

    await show('B')
    // IDを見ないと「Aは送信済みだから戻さない」でAが残る。
    expect(host.textContent).toContain('配信 B')
    expect(host.textContent).not.toContain('配信 A')
  })

  it('別の配信の進捗が前の全文へ混ざらない(題名Aに件数B、を作らない)', async () => {
    const rows: Record<string, ApiBroadcast> = {
      A: broadcast({ id: 'A', status: 'sending', totalCount: 10, successCount: 2 }),
      B: broadcast({ id: 'B', status: 'sending', totalCount: 900, successCount: 700 }),
    }
    // Bの全文だけ遅らせる。全文がAのまま、IDだけBになった瞬間を作る。
    let releaseB!: () => void
    const slowB = new Promise<void>((resolve) => {
      releaseB = resolve
    })
    net.get = (id: string) =>
      id === 'B'
        ? slowB.then(() => ({ success: true, data: rows.B }))
        : Promise.resolve({ success: true, data: rows.A })
    net.progress = (id: string) =>
      Promise.resolve({
        success: true,
        data: {
          status: 'sending',
          totalCount: rows[id].totalCount,
          successCount: rows[id].successCount,
          batchOffset: 0,
          perAccountStats: [],
        },
      })

    await show('A')
    expect(host.textContent).toContain('進捗 2/10')

    // Bへ移る。全文はまだ返らないので、持っている全文はAのまま。
    await show('B')
    // この間にBの進捗が返る。IDを見ないとAの全文へBの件数が入る
    // (いまは読み込み中の骨組みが被さっていて画面には出ないが、
    //  骨組みの出し方を変えた瞬間に「題名Aに件数B」が表に出る)。
    await wait(5000)
    const mixed = host.textContent?.includes('配信 A') && host.textContent?.includes('進捗 700/900')
    expect(mixed).toBe(false)

    // Bの全文が返れば、題名も件数もBで揃う。
    await act(async () => {
      releaseB()
    })
    await wait(5000)
    expect(host.textContent).toContain('配信 B')
    expect(host.textContent).toContain('進捗 700/900')
  })

  /*
   * #662 / N-059 — 停止中を「送信中」と出さない。
   *
   * 運用者が停止を押したのに送信中のままだと、効いていないと読んで
   * もう一度押す。止まったことは画面の状態でしか分からない。
   */
  it('停止を受け付けた配信は「停止中」と出し、「送信中」とは出さない', async () => {
    const row = broadcast({ id: 'S', status: 'sending', totalCount: 600, successCount: 500, targetType: 'segment' })
    net.get = () => Promise.resolve({ success: true, data: { ...row, stopped: true, version: 4 } })
    net.progress = () =>
      Promise.resolve({
        success: true,
        data: {
          status: 'sending',
          stopped: true,
          sendAttemptNo: 1,
          ledger: { sent: 500, failed: 80, unknown: 20, inFlight: 0, retryableCount: 80 },
          totalCount: 600,
          successCount: 500,
          batchOffset: 500,
          perAccountStats: [],
        },
      })

    await show('S')
    await wait(5000)
    // 状態の札そのものを見る。画面のどこかに「停止中」の字があるだけでは、
    // 札が「送信中」のままでも通ってしまう。
    expect(host.querySelector('[data-testid="broadcast-status-badge"]')?.textContent).toBe('停止中')
    // 送達不明を「送り直せる数」に混ぜない。混ぜると運用者が押して、
    // 相手のトークに2通目が出る。
    expect(host.textContent).toContain('失敗した80人へ送り直す')
    expect(host.textContent).toContain('送り直しません')
  })
})
