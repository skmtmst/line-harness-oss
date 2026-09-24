// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoReviewsPage from './page'

/*
 * V6R-S3-e: 写真審査の一覧を読み上げでも使えるようにする。
 * どの写真の「通す」「戻す」「選ぶ」かが名前で分かり、審査の結果は読み上げに届く。
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
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

describe('写真審査の読み上げ（V6R-S3-e）', () => {
  it('各写真の操作は、どの写真のものかが名前で分かる', async () => {
    net.handler = listHandler(() => Promise.resolve({ success: true, data: null }))
    await render()

    const names = Array.from(document.body.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label'))
    expect(names).toContain('ハナちゃんの写真を採用する')
    expect(names).toContain('ハナちゃんの写真を見送る')
    expect(names).toContain('モモちゃんの写真を採用する')
    const checks = Array.from(document.body.querySelectorAll('input[type="checkbox"]')).map((c) => c.getAttribute('aria-label'))
    expect(checks).toEqual(expect.arrayContaining(['ハナちゃんの写真を選ぶ', 'モモちゃんの写真を選ぶ']))
    const articles = Array.from(document.body.querySelectorAll('article')).map((a) => a.getAttribute('aria-label'))
    expect(articles).toEqual(expect.arrayContaining(['ハナちゃんの投稿写真', 'モモちゃんの投稿写真']))
  })

  it('審査の結果の知らせは、読み上げに届く場所に出る', async () => {
    net.handler = listHandler((path) => {
      if (path.includes('/review')) {
        return Promise.resolve({ success: true, data: { id: 'photo-a1', status: 'adopted', review_version: 2 } })
      }
      return Promise.resolve({ success: true, data: null })
    })
    await render()
    const approve = document.body.querySelector('button[aria-label="ハナちゃんの写真を採用する"]') as HTMLButtonElement
    await act(async () => { approve.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

    const status = document.body.querySelector('[role="status"][aria-live="polite"]')
    expect(status?.textContent?.length ?? 0).toBeGreaterThan(0)
  })
})
