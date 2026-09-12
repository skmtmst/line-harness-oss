// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastLedger } from '@/lib/api'
import BroadcastStopControls from './broadcast-stop-controls'

/*
 * #662 / N-059 — 停止・再開・失敗分再送のボタン。
 *
 * ここで見張るのは3つ。
 *
 *   1. 押した版（version）がそのまま口へ渡ること。**二重の適用を止めて
 *      いるのはサーバー側のこの版**で、画面の無効化ではない
 *   2. 連打しても要求が1回しか出ないこと
 *   3. 送達不明を「送り直せる数」に混ぜないこと。混ぜると運用者が
 *      押し、相手のトークに2通目が出る
 */

const net = vi.hoisted(() => ({
  stop: vi.fn(),
  resume: vi.fn(),
  retryFailed: vi.fn(),
}))

vi.mock('../../lib/api', async (importOriginal: () => Promise<typeof import('../../lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        stop: (...args: unknown[]) => net.stop(...args),
        resume: (...args: unknown[]) => net.resume(...args),
        retryFailed: (...args: unknown[]) => net.retryFailed(...args),
      },
    },
  }
})

const ledger = (over: Partial<BroadcastLedger> = {}): BroadcastLedger => ({
  sent: 500, failed: 0, unknown: 0, inFlight: 0, retryableCount: 0, ...over,
})

let host: HTMLDivElement
let root: Root
let changed: number

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  changed = 0
  net.stop.mockReset()
  net.resume.mockReset()
  net.retryFailed.mockReset()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

async function show(props: Partial<React.ComponentProps<typeof BroadcastStopControls>> = {}) {
  await act(async () => {
    root.render(
      <BroadcastStopControls
        broadcastId="b1"
        status="sending"
        stopped={false}
        version={7}
        ledger={ledger()}
        targetType="segment"
        onChanged={() => { changed += 1 }}
        {...props}
      />,
    )
  })
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
  if (!found) throw new Error(`ボタンが見つかりません: ${label} / 画面: ${host.textContent}`)
  return found as HTMLButtonElement
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('停止・再開・失敗分再送のボタン（#662）', () => {
  it('送信中は停止だけを出し、画面が読み込んだ版をそのまま渡す', async () => {
    net.stop.mockResolvedValue({ success: true, stoppedUnknownCount: 3 })
    await show()
    expect(host.textContent).toContain('送信中')
    expect(() => button('続きを送る')).toThrow()

    await click(button('配信を停止'))
    expect(net.stop).toHaveBeenCalledWith('b1', 7)
    expect(changed).toBe(1)
    expect(host.textContent).toContain('送達不明 3人')
  })

  it('描き直しを挟まず続けて押しても、要求は1回しか出ない', async () => {
    let release!: () => void
    net.stop.mockReturnValue(new Promise((resolve) => { release = () => resolve({ success: true }) }))
    await show()

    const stopButton = button('配信を停止')
    /*
     * **同じ描き直しの中で2回押す。**
     *
     * 描き直しを挟めば `disabled` が付いて2回目は届かないが、それは
     * 「押せなくした」だけで、二重に呼ばれないことの証明にならない。
     * 押した瞬間に同期で立つ印が無ければ、ここで2回出る。
     */
    await act(async () => {
      stopButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      stopButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      stopButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(net.stop).toHaveBeenCalledTimes(1)

    await act(async () => { release() })
  })

  it('停止中は「続きを送る」と「失敗した相手へ送り直す」を出す', async () => {
    net.resume.mockResolvedValue({ success: true })
    await show({ stopped: true, ledger: ledger({ failed: 12, retryableCount: 12, unknown: 4 }) })
    expect(host.textContent).toContain('停止中')

    await click(button('失敗した12人へ送り直す'))
    expect(net.retryFailed).not.toHaveBeenCalledWith('b1', 8)
    await click(button('続きを送る'))
    expect(net.resume).toHaveBeenCalledWith('b1', 7)
  })

  it('送達不明を「送り直せる数」に混ぜない', async () => {
    await show({ stopped: true, ledger: ledger({ sent: 500, failed: 0, unknown: 100, retryableCount: 0 }) })
    // 送り直す相手がいないので、ボタンは出ない。
    expect(() => button('送り直す')).toThrow()
    const unknownCard = host.querySelector('[data-testid="ledger-unknown"]')!
    expect(unknownCard.textContent).toContain('100人')
    expect(unknownCard.textContent).toContain('送り直しません')
  })

  it('版が食い違ったら理由を出し、読み直しを促す', async () => {
    const { ApiError } = await import('../../lib/api')
    net.stop.mockRejectedValue(new ApiError(409, '別の操作が先に入りました。画面を読み直してからやり直してください。'))
    await show()

    await click(button('配信を停止'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('別の操作が先に入りました')
    // 正しい版を取り直さないと、次も必ず失敗する。
    expect(changed).toBe(1)
  })

  it('全員配信では停止も再送も見せない（LINE側に止める口が無い）', async () => {
    await show({ targetType: 'all', ledger: ledger({ failed: 5, retryableCount: 5 }) })
    expect(host.textContent).toBe('')
  })

  it('送信完了で失敗が無ければ何も出さない', async () => {
    await show({ status: 'sent', ledger: ledger({ sent: 600 }) })
    expect(host.textContent).toBe('')
  })

  it('送信完了でも失敗が残っていれば送り直せる', async () => {
    net.retryFailed.mockResolvedValue({ success: true, attemptNo: 2, retryTargets: 12 })
    await show({ status: 'sent', ledger: ledger({ sent: 588, failed: 12, retryableCount: 12 }) })

    await click(button('失敗した12人へ送り直す'))
    expect(net.retryFailed).toHaveBeenCalledWith('b1', 7)
    expect(host.textContent).toContain('失敗した 12人へ送り直します（2回目）')
  })
})
