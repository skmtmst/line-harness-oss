/*
 * V8 ガードの撮影準備（browser-env.mjs）の契約試験。ブラウザは要らない。
 *
 * v7 友だち詳細の右上が時々違うのは、Webフォントの来る前と来た後で
 * 文字の濃さが変わるため。撮る前に `document.fonts.ready` を待つ。
 */
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { openPage } from '../../apps/web/scripts/v8-guard/browser-env.mjs'

/* 本物のブラウザの代わりの stub。 */
function stubBrowser(options: { fontsReady?: boolean } = {}) {
  const { fontsReady = true } = options
  const calls: string[] = []
  let initFn: ((arg: unknown) => void) | null = null
  let initArg: unknown = null
  let fixedAt: unknown = null
  const page = {
    clock: {
      setFixedTime: async (when: unknown) => {
        calls.push('setFixedTime')
        fixedAt = when
      },
    },
    addInitScript: async (fn: (arg: unknown) => void, arg: unknown) => {
      calls.push('addInitScript')
      initFn = fn
      initArg = arg
    },
    goto: async (url: string) => {
      calls.push(`goto:${url}`)
      return { status: () => 200 }
    },
    addStyleTag: async () => {},
    waitForTimeout: async () => {
      calls.push('waitForTimeout')
    },
    evaluate: async (fn: unknown) => {
      const source = typeof fn === 'function' ? Function.prototype.toString.call(fn) : String(fn)
      calls.push(`evaluate:${source.includes('fonts') ? 'fonts' : 'other'}`)
      if (!fontsReady) throw new Error('no fonts')
      return true
    },
  }
  return {
    calls,
    fixedTime() {
      return fixedAt instanceof Date ? fixedAt.toISOString() : fixedAt
    },
    runInit(store: Record<string, string>) {
      if (!initFn) throw new Error('合言葉が置かれていない')
      const g = globalThis as Record<string, unknown>
      const prev = g['localStorage']
      g['localStorage'] = { setItem: (k: string, v: string) => { store[k] = v } }
      try {
        initFn(initArg)
      } finally {
        g['localStorage'] = prev
      }
    },
    browser: {
      newPage: async () => page,
    },
  }
}

describe('ガードの撮影準備', () => {
  it('フォントが来るのを待ってから渡す', async () => {
    const stub = stubBrowser()
    const page = await openPage(stub.browser, { baseUrl: 'http://127.0.0.1:4310', route: '/friends/detail?id=f-1', width: 1440, theme: 'v7', stable: true })
    expect(page).toBeTruthy()
    expect(stub.calls).toContain('evaluate:fonts')
    const fontsAt = stub.calls.indexOf('evaluate:fonts')
    const waitedAt = stub.calls.indexOf('waitForTimeout')
    expect(fontsAt).toBeGreaterThan(waitedAt)
  })

  it('合言葉（V7 テーマ＋偽ログイン）を置く', async () => {
    const stub = stubBrowser()
    await openPage(stub.browser, { baseUrl: 'http://127.0.0.1:4310', route: '/friends', width: 1152, theme: 'v7', stable: true })
    const store: Record<string, string> = {}
    stub.runInit(store)
    expect(store['lh-admin-theme']).toBe('v7')
    expect(store['lh_selected_account']).toBe('visual-qa-account')
    expect(store['lh_csrf']).toBe('visual-qa-csrf')
  })

  it('フォントなし環境でも落とさない', async () => {
    const stub = stubBrowser({ fontsReady: false })
    const page = await openPage(stub.browser, { baseUrl: 'http://127.0.0.1:4310', route: '/friends', width: 1152, theme: 'v7', stable: true })
    expect(page).toBeTruthy()
  })

  it('時刻を決まった日時に固定する', async () => {
    const stub = stubBrowser()
    await openPage(stub.browser, { baseUrl: 'http://127.0.0.1:4310', route: '/friends/detail?id=f-1', width: 1440, theme: 'v7', stable: true })
    expect(stub.calls).toContain('setFixedTime')
    expect(stub.fixedTime()).toBe('2026-10-01T05:00:00.000Z')
  })

  it('安定化なしでは時計を触らない', async () => {
    const stub = stubBrowser()
    await openPage(stub.browser, { baseUrl: 'http://127.0.0.1:4310', route: '/friends', width: 1152, theme: 'v8' })
    expect(stub.calls).not.toContain('setFixedTime')
    expect(stub.calls).toContain('evaluate:fonts')
  })
})
