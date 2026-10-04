// @vitest-environment happy-dom
/*
 * G6 移し替えの既定の切り替え。
 * - 開いたとき：環境の既定（検証 V8・本番 v7）。このブラウザの記憶があればそちらが勝つ
 * - 上バーの「前の見た目に戻す」：V8 のときだけ出て、押すと v7 に戻り覚える
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TopBar from '@/components/shared/top-bar'
import { applyAdminTheme } from '@/components/theme-preview-switch'

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

afterEach(() => cleanup())

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

describe('上バーの「前の見た目に戻す」', () => {
  const base = {
    title: '友だち一覧',
    accounts: [],
    selectedAccountId: '',
    onAccountChange: () => {},
    roleLabel: '管理者',
    userName: '担当',
    onLogout: () => {},
  }

  it('渡さなければ出ない（v7 の絵は変わらない）', () => {
    render(<TopBar {...base} />)
    expect(screen.queryByRole('button', { name: '前の見た目に戻す' })).toBeNull()
  })

  it('押すと v7 に戻り localStorage に残る', () => {
    document.documentElement.dataset.theme = 'v8'
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
    })
    try {
      render(<TopBar {...base} onRevertTheme={() => applyAdminTheme('v7')} />)
      fireEvent.click(screen.getByRole('button', { name: '前の見た目に戻す' }))
      expect(document.documentElement.dataset.theme).toBe('v7')
      expect(store.get('lh-admin-theme')).toBe('v7')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
