// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoReviewsPage from './page'

/*
 * N-306 #639: 一括審査の応答が遅れているあいだにLINEアカウントを切り替えたとき、
 * 前のアカウントの結果を次のアカウントの画面へ出さないことを、本物のReactで確かめる。
 *
 * 文字列だけを読む契約試験では「遅い応答が別アカウントの画面へ入る」がすり抜ける。
 * ここは react-dom/client でマウントし、差し替えるのは通信とアカウント・部品だけ。
 * api・fetchApi は実物を通すので、URLの組み立ても応答の解釈も本番と同じ道になる。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string }))

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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function photo(id: string, petName: string) {
  return {
    id, pet_name: petName, owner_name: '飼い主', caption: '',
    status: 'pending', created_at: '2026-09-01T00:00:00.000Z',
    review_version: 1, latest_risk_flag: 'safe',
    review_notification_status: 'pending',
  }
}

const METRICS = {
  pendingCount: 2, adoptedCount: 0, rejectedCount: 0,
  averageReviewMinutes: null, attentionCount: 0,
}

/** アカウントごとに違う写真を返す。混ざったらペット名で分かる。 */
function listHandler(extra: (path: string, init?: RequestInit) => Promise<unknown>) {
  return (path: string, init?: RequestInit): Promise<unknown> => {
    if (path.startsWith('/api/nen-members/photos/review-metrics')) {
      return Promise.resolve({ success: true, data: METRICS })
    }
    if (path.startsWith('/api/nen-members/photos?accountId=account-a')) {
      return Promise.resolve({ success: true, data: [photo('photo-a1', 'ハナ'), photo('photo-a2', 'モモ')] })
    }
    if (path.startsWith('/api/nen-members/photos?accountId=account-b')) {
      return Promise.resolve({ success: true, data: [photo('photo-b1', 'ソラ')] })
    }
    return extra(path, init)
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
}

/** ダイアログは portal で body へ出るので、画面全体から探す。 */
function buttons(label: string): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'))
    .filter((item) => item.textContent?.trim() === label) as HTMLButtonElement[]
}

async function click(label: string, index = 0) {
  const target = buttons(label)[index]
  if (!target) throw new Error(`「${label}」のボタンが見つかりません`)
  await act(async () => { target.click() })
}

/**
 * 一覧の一括ボタン。処理中は文字が「処理中...」へ変わるので、どちらでも拾う。
 * 確認窓は portal で body へ出るため、一覧側だけを見る host から探す。
 */
function bulkButton(): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => ['まとめて通す', '処理中...'].includes(item.textContent?.trim() ?? ''),
  )
  if (!found) throw new Error(`一括のボタンが見つかりません: ${host.textContent}`)
  return found as HTMLButtonElement
}

async function selectPhoto(index: number) {
  const boxes = Array.from(host.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
  const target = boxes[index]
  if (!target) throw new Error('選択の四角が見つかりません')
  await act(async () => { target.click() })
}

const bulkCalls = () => net.calls.filter(
  (call) => call.path === '/api/nen-members/photos/decisions/bulk',
).length

describe('一括審査中にアカウントを切り替えたときの画面(#639)', () => {
  it('前のアカウントの一括応答を、切り替えた先の画面へ出さない', async () => {
    const late = deferred<unknown>()
    net.handler = listHandler((path) => {
      if (path === '/api/nen-members/photos/decisions/bulk') return late.promise
      return Promise.reject(new Error(`未設定: ${path}`))
    })

    await render()
    expect(host.textContent).toContain('ハナ')

    await selectPhoto(0)
    await selectPhoto(1)
    await click('まとめて通す')          // 一覧のボタン → 確認窓が開く
    await click('まとめて通す', 1)       // 確認窓の実行ボタン
    expect(bulkCalls()).toBe(1)

    // 応答が返らないうちにBへ切り替える。
    fixture.accountId = 'account-b'
    await render()
    expect(host.textContent).toContain('ソラ')

    // Aの応答が遅れて返る。1枚は通知に失敗している。
    await act(async () => {
      late.resolve({
        success: true,
        data: {
          updatedCount: 2,
          items: [
            { photoId: 'photo-a1', decision: 'approve', reviewVersion: 2, decisionId: 'd1', notificationStatus: 'sent' },
            { photoId: 'photo-a2', decision: 'approve', reviewVersion: 2, decisionId: 'd2', notificationStatus: 'failed' },
          ],
          notificationFailures: [{ photoId: 'photo-a2', error: '通知先が見つかりません' }],
        },
      })
    })
    await act(async () => { await Promise.resolve() })

    // B画面へAの結果（枚数・失敗一覧・失敗した写真の名前）は出ない。
    expect(host.textContent).not.toContain('2枚の審査結果')
    expect(host.textContent).not.toContain('LINE通知を送れなかった写真')
    expect(host.textContent).not.toContain('モモ')
    expect(host.textContent).toContain('ソラ')
    // Aの応答でBの一覧を読み直さない。
    expect(bulkCalls()).toBe(1)
  })

  it('切り替えた先で一括審査をもう一度押せる（処理中の掛け金が残らない）', async () => {
    const late = deferred<unknown>()
    const bulkBodies: string[] = []
    net.handler = listHandler((path, init) => {
      if (path === '/api/nen-members/photos/decisions/bulk') {
        bulkBodies.push(String(init?.body ?? ''))
        return bulkBodies.length === 1 ? late.promise : Promise.resolve({
          success: true,
          data: { updatedCount: 1, items: [], notificationFailures: [] },
        })
      }
      return Promise.reject(new Error(`未設定: ${path}`))
    })

    await render()
    await selectPhoto(0)
    await selectPhoto(1)
    await click('まとめて通す')
    await click('まとめて通す', 1)
    expect(bulkCalls()).toBe(1)

    // Aの応答が返らないうちにBへ切り替え、そのあとAの応答が遅れて返る。
    fixture.accountId = 'account-b'
    await render()
    await act(async () => { late.resolve({ success: true, data: { updatedCount: 2, items: [], notificationFailures: [] } }) })
    await act(async () => { await Promise.resolve() })

    // Bの写真を選ぶと、一括のボタンは押せる形になっている。
    await selectPhoto(0)
    const bulk = bulkButton()
    expect(bulk.textContent?.trim()).toBe('まとめて通す')
    expect(bulk.disabled).toBe(false)

    // 実際に押すと確認窓が開き、Bのアカウントで一括審査を送れる。
    await click('まとめて通す')
    expect(buttons('まとめて通す')).toHaveLength(2)
    await click('まとめて通す', 1)
    expect(bulkCalls()).toBe(2)
    expect(bulkBodies[1]).toContain('account-b')
    expect(bulkBodies[1]).toContain('photo-b1')
  })

  it('前のアカウントの一括失敗を、切り替えた先の画面へ出さない', async () => {
    const late = deferred<unknown>()
    net.handler = listHandler((path) => {
      if (path === '/api/nen-members/photos/decisions/bulk') return late.promise
      return Promise.reject(new Error(`未設定: ${path}`))
    })

    await render()
    await selectPhoto(0)
    await click('まとめて通す')
    await click('まとめて通す', 1)

    fixture.accountId = 'account-b'
    await render()

    await act(async () => { late.resolve({ success: false, error: 'まとめて審査できませんでした' }) })
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).not.toContain('まとめて審査できませんでした')
    expect(host.textContent).toContain('ソラ')
  })

  it('前のアカウントの再送応答を、切り替えた先の画面へ出さない', async () => {
    const late = deferred<unknown>()
    net.handler = (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/nen-members/photos/review-metrics')) {
        return Promise.resolve({ success: true, data: METRICS })
      }
      if (path.startsWith('/api/nen-members/photos?accountId=account-a')) {
        return Promise.resolve({
          success: true,
          data: [{ ...photo('photo-a1', 'ハナ'), review_notification_status: 'failed' }],
        })
      }
      if (path.startsWith('/api/nen-members/photos?accountId=account-b')) {
        return Promise.resolve({ success: true, data: [photo('photo-b1', 'ソラ')] })
      }
      if (path === '/api/nen-members/photos/photo-a1/notification/retry') return late.promise
      return Promise.reject(new Error(`未設定: ${path} ${String(init?.method ?? '')}`))
    }

    await render()
    await click('LINE通知を再送')

    fixture.accountId = 'account-b'
    await render()

    await act(async () => { late.resolve({ success: true, data: { notificationStatus: 'sent' } }) })
    await act(async () => { await Promise.resolve() })

    expect(host.textContent).not.toContain('投稿者へLINEで再送しました')
    expect(host.textContent).toContain('ソラ')
  })
})
