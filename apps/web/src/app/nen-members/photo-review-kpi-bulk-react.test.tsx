// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoReviewsPage from './page'

/*
 * Issue #666（監査6・実画面検証 P1）の2件を、本物のReactで確かめる。
 *
 * 1. 指標カード「1枚にかかる時間」が分の生値（平均 55975分 ≒ 38.8日）で
 *    出ていた。59分/61分/1439分/1441分/43200分超の境界で、
 *    分・約○時間・約○日・約○ヶ月へ切り替わることを見る。
 * 2. 「0枚を選択中」でも「まとめて通す」が緑のままに見えた。
 *    いまは選ぶ前はまとめ操作の帯自体を出さない（0枚での確認窓を
 *    開きようがなくする）。1枚以上選んだら帯が出て両方が押せることを見る。
 *
 * 差し替えるのは通信とアカウントだけ。api・fetchApi は実物を通す。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string,
  averageReviewMinutes: null as number | null,
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; init?: RequestInit }>,
  handler: ((path: string) => Promise.reject(new Error(`未設定: ${path}`))) as
    (path: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push({ path, init })
    const body = await net.handler(path, init)
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
}

function photo(id: string, petName: string) {
  return {
    id, pet_name: petName, owner_name: '飼い主', caption: '',
    status: 'pending', created_at: '2026-09-01T00:00:00.000Z',
    review_version: 1, latest_risk_flag: 'safe',
    review_notification_status: 'pending',
  }
}

function metrics() {
  return {
    pendingCount: 2, reviewedCount: 3, attentionCount: 0,
    averageReviewMinutes: fixture.averageReviewMinutes,
    oldestPendingAt: null,
  }
}

function listHandler() {
  return (path: string): Promise<unknown> => {
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return Promise.resolve({ success: true, data: metrics() })
    }
    if (path.startsWith('/api/nen-members/photos?accountId=account-a')) {
      return Promise.resolve({ success: true, data: [photo('photo-a1', 'ハナ'), photo('photo-a2', 'モモ')] })
    }
    return Promise.reject(new Error(`未設定: ${path}`))
  }
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
  fixture.averageReviewMinutes = null
  net.calls.length = 0
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => '11111111-2222-4333-8444-555555555555' })
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
  await act(async () => { root.render(<PhotoReviewsPage />) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

/** 一覧側の一括ボタン。確認窓は portal なので host から探す。 */
function bulkButton(label: 'まとめて通す' | 'まとめて戻す'): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`「${label}」が見つかりません: ${host.textContent}`)
  return found as HTMLButtonElement
}

async function selectPhoto(index: number) {
  const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
  const target = boxes[index]
  if (!target) throw new Error('選択の四角が見つかりません')
  await act(async () => { target.click() })
}

/** 「1枚にかかる時間」カードの大きな値（ラベルの直後の要素）を取る。 */
function averageTimeValue(): string | undefined {
  const label = Array.from(host.querySelectorAll('p'))
    .find((p) => p.textContent?.trim() === '1枚にかかる時間')
  return label?.nextElementSibling?.textContent?.trim()
}

describe('「1枚にかかる時間」の読みやすい単位（Issue #666）', () => {
  it.each([
    [59, '平均 59分'],
    [61, '平均 約1時間'],
    [1_439, '平均 約24時間'],
    [1_441, '平均 約1日'],
    // Issue の実測値: 55975分 ≒ 38.8日。
    [55_975, '平均 約1ヶ月'],
  ])('平均%i分は「%s」と出る', async (minutes, expected) => {
    fixture.averageReviewMinutes = minutes
    net.handler = listHandler()
    await render()

    expect(averageTimeValue()).toBe(expected)
    // 60分を超える値では、生の分数がそのまま出ていないことも確認する。
    if (minutes >= 60) expect(averageTimeValue()).not.toBe(`平均 ${minutes}分`)
  })

  it('指標が取れないときは — を出す', async () => {
    fixture.averageReviewMinutes = null
    net.handler = listHandler()
    await render()

    expect(averageTimeValue()).toBe('—')
  })
})

describe('0件選択の一括操作（Issue #666）', () => {
  it('選ぶ前はまとめ操作の帯自体を出さない', async () => {
    net.handler = listHandler()
    await render()

    // 帯が無いので「0枚をまとめて通す」確認窓は開きようがない。
    expect(host.textContent).not.toContain('枚を選択中')
    expect(host.textContent).not.toContain('まとめて通す')
    expect(host.textContent).not.toContain('まとめて戻す')
  })

  it('写真を選ぶと両方の一括ボタンが押せる形になる', async () => {
    net.handler = listHandler()
    await render()

    await selectPhoto(0)

    expect(host.textContent).toContain('1枚を選択中')
    expect(bulkButton('まとめて通す').disabled).toBe(false)
    expect(bulkButton('まとめて戻す').disabled).toBe(false)
    expect(host.textContent).toContain('審査待ちの写真だけをまとめて処理します')
  })
})
