// @vitest-environment happy-dom
/*
 * メッセージ形式タブの矢印キー操作（N-063）。
 *
 * 見る筋書き:
 *   1. ←→↑↓ はフォーカスだけを動かす（選択は変えない）。
 *   2. Home/End は端へ飛ぶ。
 *   3. 端で更に進むと反対側へ回る。
 *   4. タブ以外のキー・タブ外からのキーでは何も起きない。
 *   5. 実フォーム側は role="tablist" に onKeyDown、各タブに
 *      ロービング tabIndex が付いている。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/*
 * api.ts はモジュール初期化で NEXT_PUBLIC_API_URL を要求する。
 * ここで見るのはキー操作だけなので、通信口は空の形に差し替える。
 */
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {},
}))

import { moveMessageTypeTabFocus } from './broadcast-form'

const FORM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form.tsx'),
  'utf8',
)

function buildTablist(labels: string[]): { tablist: HTMLElement; tabs: HTMLElement[] } {
  const tablist = document.createElement('div')
  tablist.setAttribute('role', 'tablist')
  const tabs = labels.map((label) => {
    const tab = document.createElement('button')
    tab.setAttribute('role', 'tab')
    tab.textContent = label
    tablist.appendChild(tab)
    return tab
  })
  document.body.appendChild(tablist)
  return { tablist, tabs }
}

function keydown(tablist: HTMLElement, key: string) {
  let prevented = false
  moveMessageTypeTabFocus(
    { key, currentTarget: tablist, preventDefault: () => { prevented = true } },
    document.activeElement,
  )
  return prevented
}

describe('メッセージ形式タブの矢印キー操作', () => {
  it('→↓ は次、←↑ は前のタブへフォーカスを動かす', () => {
    const { tablist, tabs } = buildTablist(['テキスト', '画像', '動画'])
    tabs[0].focus()
    expect(keydown(tablist, 'ArrowRight')).toBe(true)
    expect(document.activeElement).toBe(tabs[1])
    expect(keydown(tablist, 'ArrowDown')).toBe(true)
    expect(document.activeElement).toBe(tabs[2])
    expect(keydown(tablist, 'ArrowLeft')).toBe(true)
    expect(document.activeElement).toBe(tabs[1])
    expect(keydown(tablist, 'ArrowUp')).toBe(true)
    expect(document.activeElement).toBe(tabs[0])
  })

  it('端で更に進むと反対側へ回り、Home/End は端へ飛ぶ', () => {
    const { tablist, tabs } = buildTablist(['テキスト', '画像', '動画'])
    tabs[0].focus()
    keydown(tablist, 'ArrowLeft')
    expect(document.activeElement).toBe(tabs[2])
    keydown(tablist, 'ArrowRight')
    expect(document.activeElement).toBe(tabs[0])
    keydown(tablist, 'End')
    expect(document.activeElement).toBe(tabs[2])
    keydown(tablist, 'Home')
    expect(document.activeElement).toBe(tabs[0])
  })

  it('タブに無いキーとタブ外フォーカスでは何も起きない', () => {
    const { tablist, tabs } = buildTablist(['テキスト', '画像'])
    tabs[0].focus()
    expect(keydown(tablist, 'Enter')).toBe(false)
    expect(keydown(tablist, 'a')).toBe(false)
    expect(document.activeElement).toBe(tabs[0])
    document.body.focus()
    expect(keydown(tablist, 'ArrowRight')).toBe(false)
  })
})

describe('メッセージ形式タブの実フォームへの接続', () => {
  it('tablist にキーハンドラ、タブにロービング tabindex を付ける', () => {
    expect(FORM).toContain('role="tablist"')
    expect(FORM).toContain('moveMessageTypeTabFocus(event, document.activeElement)')
    expect(FORM).toContain('tabIndex={focusable ? 0 : -1}')
  })
})
