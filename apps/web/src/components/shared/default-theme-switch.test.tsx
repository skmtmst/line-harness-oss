// @vitest-environment happy-dom
/*
 * 開いたときの既定の切り替え。
 * - 開いたとき：環境の既定（検証 V8・本番 v7）
 * - 既定が V8 の環境（検証）は V8 だけ。このブラウザの記憶（v7）は読まない（2026-10-07 オーナー「検証環境は V8 に切り替えて」）
 * - 既定が v7 の環境（本番の切り替えまで）は、このブラウザの記憶があればそちらが勝つ
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
  const match = layout.match(/`(\(function\(\)\{try\{var t=localStorage[\s\S]*?)`/)
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
  it('既定が V8 の環境は、描画前のスクリプトを出さない（記憶の v7 を読まない）', () => {
    expect(layout).toMatch(/const ADMIN_THEME_LOCKED = ADMIN_THEME === 'v8'/)
    expect(layout).toMatch(/const THEME_BOOT = ADMIN_THEME_LOCKED\s*\?\s*''/)
    expect(layout).toMatch(/\{THEME_BOOT \? <script/)
  })

  it('既定が v7 の環境：記憶が無ければ v7 のまま', () => {
    runBoot('v7', null)
    expect(document.documentElement.dataset.theme).toBe('v7')
  })

  it('既定が v7 の環境：記憶の v8 が勝つ', () => {
    runBoot('v7', 'v8')
    expect(document.documentElement.dataset.theme).toBe('v8')
  })
})
