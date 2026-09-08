import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupportInbox from './support-inbox'

/**
 * 問い合わせ一覧の polling 境界テスト(#630)。
 *
 * 本物の SupportInbox を、DOM のない node 環境で直接呼び出す。
 * React の hooks だけを小さな harness で受け、render→effect 実行を
 * 手で回す。本物の startVisiblePoll・本物のタイマー(fake)・本物の
 * fetch 分岐(fetchApi だけ差し替え)が動くので、制御器の作り直しと
 * 取得の本数を境界で確かめられる。testing 用の描画庫は入れない。
 */

vi.mock('next/link', () => ({ default: () => null }))

vi.mock('../../lib/api', async (importOriginal: () => Promise<typeof import('../../lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, fetchApi: (url: string) => fetchMock.call(url) }
})

type Deps = readonly unknown[] | undefined

const sameDeps = (a: Deps, b: Deps): boolean => {
  if (a === undefined || b === undefined) return false
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

const hooks = vi.hoisted(() => {
  const states: unknown[] = []
  const refs: Array<{ current: unknown }> = []
  const callbacks: Array<{ fn: unknown; deps: Deps }> = []
  const memos: Array<{ value: unknown }> = []
  const effects: Array<{
    fn: () => unknown
    deps: Deps
    lastDeps: Deps
    cleanup: unknown
    hasRun: boolean
  }> = []
  let si = 0
  let ri = 0
  let ci = 0
  let mi = 0
  let ei = 0
  return {
    reset() {
      states.length = 0
      refs.length = 0
      callbacks.length = 0
      memos.length = 0
      effects.length = 0
    },
    beginRender() {
      si = 0
      ri = 0
      ci = 0
      mi = 0
      ei = 0
    },
    useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
      const i = si++
      if (i >= states.length) {
        states.push(typeof initial === 'function' ? (initial as () => T)() : initial)
      }
      return [
        states[i] as T,
        (v: T | ((prev: T) => T)) => {
          states[i] = typeof v === 'function' ? (v as (prev: T) => T)(states[i] as T) : v
        },
      ]
    },
    useRef<T>(initial: T): { current: T } {
      const i = ri++
      if (i >= refs.length) refs.push({ current: initial })
      return refs[i] as { current: T }
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: Deps): T {
      const i = ci++
      const prev = callbacks[i]
      if (!prev || !sameDeps(prev.deps, deps)) callbacks[i] = { fn, deps }
      return callbacks[i].fn as T
    },
    useMemo<T>(fn: () => T): T {
      const i = mi++
      if (i >= memos.length) memos.push({ value: fn() })
      return memos[i].value as T
    },
    useEffect(fn: () => unknown, deps?: Deps): void {
      const i = ei++
      if (i >= effects.length) {
        effects.push({ fn, deps, lastDeps: undefined, cleanup: undefined, hasRun: false })
      } else {
        effects[i].fn = fn
        effects[i].deps = deps
      }
    },
    runEffects(): void {
      for (const e of effects) {
        if (!e.hasRun || !sameDeps(e.lastDeps, e.deps)) {
          if (typeof e.cleanup === 'function') (e.cleanup as () => void)()
          e.cleanup = e.fn()
          e.lastDeps = e.deps
          e.hasRun = true
        }
      }
    },
    unmount(): void {
      for (const e of effects) {
        if (typeof e.cleanup === 'function') (e.cleanup as () => void)()
        e.cleanup = undefined
        e.hasRun = false
      }
    },
  }
})

vi.mock('react', async (importOriginal: () => Promise<typeof import('react')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useState: hooks.useState,
    useRef: hooks.useRef,
    useCallback: hooks.useCallback,
    useMemo: hooks.useMemo,
    useEffect: hooks.useEffect,
  }
})

const fetchMock = vi.hoisted(() => {
  let impl: (url: string) => Promise<unknown> = async () => ({ success: true, data: {} })
  return {
    setImpl(fn: (url: string) => Promise<unknown>) {
      impl = fn
    },
    call(url: string): Promise<unknown> {
      return impl(url)
    },
  }
})

type DocStub = {
  hidden: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatch: (type: string) => void
}

let doc: DocStub
let tree: unknown

function render(): void {
  hooks.beginRender()
  tree = SupportInbox({ channel: 'email' })
  hooks.runEffects()
}

type ElementNode = {
  type?: unknown
  props?: { children?: unknown; onClick?: unknown } | null
}

function collectButtons(node: unknown, out: Array<() => void>): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((n) => collectButtons(n, out))
    return
  }
  const el = node as ElementNode
  if (el.type === 'button' && typeof el.props?.onClick === 'function') {
    out.push(el.props.onClick as () => void)
  }
  collectButtons(el.props?.children, out)
}

/** 一覧の先頭の行を押す(選択+詳細の即時取得)。 */
function clickFirstItem(): void {
  const buttons: Array<() => void> = []
  collectButtons(tree, buttons)
  expect(buttons.length).toBeGreaterThan(0)
  buttons[0]()
}

const flush = () => vi.advanceTimersByTimeAsync(0)

function makeItem(status: string) {
  const now = new Date().toISOString()
  return {
    id: 'i1',
    threadId: 't1',
    channel: 'email',
    customerName: '山田',
    customerIdentifier: 'a@example.com',
    subject: '件名',
    preview: '概要',
    status,
    lastMessageAt: now,
    lastIncomingAt: now,
  }
}

function makeDetail(status: string) {
  return {
    thread: {
      id: 't1',
      customer_email: 'a@example.com',
      customer_name: '山田',
      subject: '件名',
      status,
      last_message_at: new Date().toISOString(),
    },
    messages: [],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  hooks.reset()
  const listeners = new Map<string, Set<() => void>>()
  doc = {
    hidden: false,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(fn)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    }),
    dispatch: (type: string) => {
      listeners.get(type)?.forEach((fn) => fn())
    },
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void) => setTimeout(fn, 50),
  })
  // この repo の vitest は JSX を classic 変換する。画面のファイルに
  // React の import はないので、実行時の名前解決用に置く。
  vi.stubGlobal('React', React)
})

afterEach(() => {
  hooks.unmount()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('問い合わせ一覧の制御器は選択更新で作り直さない (#630)', () => {
  it('詳細Promise未解決でも5秒/10秒後の取得は1本のまま', async () => {
    const item = makeItem('in_progress')
    let resolveDetail!: (value: unknown) => void
    let detailCalls = 0
    fetchMock.setImpl(async (url: string) => {
      if (url.includes('/api/support/inbox')) {
        // 本物と同じく毎回新しいオブジェクトが届く。
        return { success: true, data: { items: [{ ...item }] } }
      }
      if (/\/threads\/[^/]+$/.test(url)) {
        detailCalls += 1
        return new Promise<unknown>((resolve) => {
          resolveDetail = resolve
        })
      }
      return { success: true, data: {} }
    })

    render()
    await flush()
    render() // 一覧の反映
    clickFirstItem() // 選択+詳細d1
    await flush()
    expect(detailCalls).toBe(1)
    resolveDetail({ success: true, data: makeDetail('in_progress') })
    await flush()
    render() // 選択・詳細の反映。制御器は作り直さない
    expect(doc.addEventListener).toHaveBeenCalledTimes(1)

    // 5秒後にtick: 一覧が選択オブジェクトを更新し、詳細d2が未解決のまま残る。
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(2)
    render() // 選択オブジェクト更新を反映。制御器は作り直さない
    expect(doc.addEventListener).toHaveBeenCalledTimes(1)

    // d2未解決のまま5秒・10秒たっても取得は増えない。
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(2)

    // d2が終わったら次の1本だけ進む。
    resolveDetail({ success: true, data: makeDetail('in_progress') })
    await flush()
    render()
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(3)
  })

  it('同じ状態更新を挟んでも失敗バックオフを維持する', async () => {
    const item = makeItem('in_progress')
    let detailCalls = 0
    fetchMock.setImpl(async (url: string) => {
      if (url.includes('/api/support/inbox')) {
        return { success: true, data: { items: [{ ...item }] } }
      }
      if (/\/threads\/[^/]+$/.test(url)) {
        detailCalls += 1
        throw new Error('no connection')
      }
      return { success: true, data: {} }
    })

    render()
    await flush()
    render()
    clickFirstItem() // 選択+d1失敗(接続なし)。失敗回数には数えない
    await flush()
    expect(detailCalls).toBe(1)
    render()
    expect(doc.addEventListener).toHaveBeenCalledTimes(1)

    // 5秒後にtick: 一覧が選択を更新し、詳細も失敗→10秒待ち。
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(2)
    render() // 選択オブジェクト更新を反映。制御器は作り直さない
    expect(doc.addEventListener).toHaveBeenCalledTimes(1)

    // 失敗1回ぶんの10秒待ちを保つ。作り直していたら5秒で叩き直す。
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(detailCalls).toBe(3)
  })
})
