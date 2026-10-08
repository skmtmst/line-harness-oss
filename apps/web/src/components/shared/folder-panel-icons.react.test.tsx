// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FolderPanel, { type FolderPanelRow } from './folder-panel'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

async function render(row: FolderPanelRow, activeId = '', onSelect = vi.fn()) {
  await act(async () => {
    root.render(<FolderPanel rows={[row]} activeId={activeId} onSelect={onSelect} />)
  })
  const button = host.querySelector('nav button') as HTMLButtonElement
  const icon = button.querySelector('.v8-only svg') as SVGElement
  expect(icon).not.toBeNull()
  return { button, icon, onSelect }
}

const callerIcon = <svg data-caller-icon fill="red"><circle cx="7" cy="7" r="7" /></svg>

describe('V8 フォルダの列の共通の印（faSbC）', () => {
  it.each(['', 'all'])('all は画面の色・印を無視し、選択中でも墨色のトレー（active=%s）', async (activeId) => {
    const { button, icon, onSelect } = await render({
      id: 'all', kind: 'all', label: '全部を見る', count: 12, color: 'red', icon: callerIcon,
    }, activeId)
    expect(icon.classList.contains('lucide-inbox')).toBe(true)
    expect(icon.getAttribute('fill')).toBe('none')
    expect(icon.style.color).toBe('var(--color-ink)')
    expect(button.querySelector('.v8-only [data-caller-icon]')).toBeNull()
    expect(button.textContent).toBe('全部を見る12')
    await act(async () => button.click())
    expect(onSelect).toHaveBeenCalledWith('all')
  })

  it.each(['', 'unfiled'])('unfiled は画面の色・印を無視し、選択中でも灰色の開いたフォルダ（active=%s）', async (activeId) => {
    const { button, icon } = await render({
      id: 'unfiled', kind: 'unfiled', label: '分類なし', count: 0, color: 'red', icon: callerIcon,
    }, activeId)
    expect(icon.classList.contains('lucide-folder-open')).toBe(true)
    expect(icon.getAttribute('fill')).toBe('none')
    expect(icon.style.color).toBe('var(--color-ink-secondary)')
    expect(button.querySelector('.v8-only [data-caller-icon]')).toBeNull()
  })

  it.each([
    ['すべて', 'lucide-inbox', 'var(--color-ink)'],
    ['未分類', 'lucide-folder-open', 'var(--color-ink-secondary)'],
  ])('古い呼び方でも %s は共通の印になる', async (label, className, color) => {
    const { icon } = await render({ id: 'legacy', label, count: null, color: 'red', icon: callerIcon })
    expect(icon.classList.contains(className)).toBe(true)
    expect(icon.getAttribute('fill')).toBe('none')
    expect(icon.style.color).toBe(color)
  })

  it.each(['キャンペーン', 'すべて', '未分類'])('作ったフォルダ「%s」は名前に関係なく、そのフォルダの色で塗る', async (label) => {
    const { icon } = await render({ id: 'folder', kind: 'folder', label, count: 3, color: 'rebeccapurple' })
    expect(icon.querySelector('path')?.getAttribute('fill')).toBe('rebeccapurple')
    expect(icon.classList.contains('lucide-inbox')).toBe(false)
    expect(icon.classList.contains('lucide-folder-open')).toBe(false)
  })

  it('v7 の色の丸を引き継ぐ', async () => {
    document.documentElement.dataset.theme = 'v7'
    const { button } = await render({ id: 'all', kind: 'all', label: 'すべて', count: 1, color: 'red' })
    expect((button.querySelector('.v7-only') as HTMLElement).style.backgroundColor).toBe('red')
  })
})
