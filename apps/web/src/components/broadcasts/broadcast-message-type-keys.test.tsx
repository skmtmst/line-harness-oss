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
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Composer from '../shared/message-composer'

/*
 * api.ts はモジュール初期化で NEXT_PUBLIC_API_URL を要求する。
 * ここで見るのはキー操作だけなので、通信口は空の形に差し替える。
 */
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {},
}))

import { moveMessageTypeTabFocus } from './broadcast-form'

const tablists: HTMLElement[] = []
afterEach(() => { cleanup(); tablists.splice(0).forEach(element => element.remove()) })

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
  tablists.push(tablist)
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
  it('既存のFlexを開いてもキーボードでタブに入り、本文を変えずに形式を選べる', () => {
    const changed = vi.fn()
    render(<Composer accountId="a" bubbles={[{ id: 'old-flex', type: 'flex', content: { flexJson: '{}' } }]} onChange={changed} onMove={() => {}} onDelete={() => {}} onAdd={() => {}} onPickTemplate={() => {}} onSaveTemplate={() => {}} onCompose={() => {}} />)
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    expect(tabs.filter(tab => tab.tabIndex === 0)).toHaveLength(1)
    const selected = screen.getByRole('tab', { selected: true })
    selected.focus();fireEvent.keyDown(selected, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0]);expect(changed).not.toHaveBeenCalled()
    fireEvent.click(tabs[0]);expect(changed).toHaveBeenCalledWith(0, expect.objectContaining({ id: 'old-flex', type: 'text' }))
  })
})
