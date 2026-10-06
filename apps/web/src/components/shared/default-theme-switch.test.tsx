// @vitest-environment happy-dom
/*
 * 開いたときの既定の切り替え。
 * - 開いたとき：環境の既定（検証 V8・本番 v7）。このブラウザの記憶があればそちらが勝つ
 * - 上バーの「前の見た目に戻す」は廃止（オーナー指示）。既定の仕組みは変えない
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const layout = readFileSync(join(here, '..', '..', 'app', 'layout.tsx'), 'utf8')

/** layout.tsx の描画前スクリプトを取り出して、その場で動かす。 */
function runBoot(htmlTheme: 'v7' | 'v8', stored: string | null) {
  const match = layout.match(/const THEME_BOOT = `([\s\S]*?)`/)
  expect(match, 'THEME_BOOT が無い').not.toBeNull()
  const store = new Map<string, string>()
  if (stored !== null) store.set('lh-admin-theme', stored)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  })
  document.documentElement.dataset.theme = htmlTheme
  eval(match![1])
  vi.unstubAllGlobals()
}

describe('開いたときの既定', () => {
  it('記憶が無ければ環境の既定（V8）のまま', () => {
    runBoot('v8', null)
    expect(document.documentElement.dataset.theme).toBe('v8')
  })

  it('記憶の v7 が環境の V8 に勝つ（前に戻した人は戻ったまま）', () => {
    runBoot('v8', 'v7')
    expect(document.documentElement.dataset.theme).toBe('v7')
  })

  it('記憶の v8 は環境の v7 に勝つ', () => {
    runBoot('v7', 'v8')
    expect(document.documentElement.dataset.theme).toBe('v8')
  })
})
