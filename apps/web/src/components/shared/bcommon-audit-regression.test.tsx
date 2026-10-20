// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Tabs } from './tabs'
import ReorderHandle from './reorder-handle'
import TemplateFolderSelect from '../chats/template-folder-select'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme') })

it('WEB-046: 後から変わったタブの幅に下線を合わせる', () => {
  document.documentElement.dataset.theme = 'v8'
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const view = render(<Tabs items={[{ label: '会員', count: 1, current: true }]} />)
  const tab = screen.getByRole('tab')
  vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 108 } as DOMRect)
  act(() => resize())
  expect(view.container.querySelector('[aria-hidden="true"]')?.getAttribute('style')).toContain('width: 108px')
})

it('WEB-019: マウスの移動口が無いつまみは出さない', () => {
  document.documentElement.dataset.theme = 'v8'
  render(<ReorderHandle label="行" onMove={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /行を並び替え/ })).toBeNull()
})

it('WEB-019: 接続済みのマウスの移動口は保つ', () => {
  document.documentElement.dataset.theme = 'v8'
  render(<ReorderHandle label="行" onPointerDown={vi.fn()} />)
  expect(screen.getByRole('button', { name: /行を並び替え/ })).toBeTruthy()
})

it('WEB240: フォルダ候補へTabで入っても閉じない', () => {
  render(<TemplateFolderSelect value="" status="ready" options={[{ value: '', label: 'すべて', count: 1 }]} onChange={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'テンプレートのフォルダ' })
  fireEvent.click(trigger)
  const option = screen.getByRole('button', { name: /すべて/ })
  fireEvent.blur(trigger, { relatedTarget: option })
  expect(screen.queryByRole('listbox')).toBeTruthy()
  fireEvent.blur(option, { relatedTarget: document.body })
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('WEB-019: 薄くする指定でも未接続のつまみは見せない', () => {
  document.documentElement.dataset.theme = 'v8'
  const view = render(<ReorderHandle label="行" disabledLook="dim" />)
  expect(view.container.querySelector('[data-reorder-disabled]')).toBeTruthy()
})

it('WEB-019: つまみの親でマウスのドラッグが接続されていれば上下キーも保つ', () => {
  document.documentElement.dataset.theme = 'v8'
  const drag = vi.fn()
  const move = vi.fn()
  render(<span draggable onDragStart={drag}><ReorderHandle label="親で動く行" onMove={move} /></span>)
  const handle = screen.getByRole('button', { name: /親で動く行を並び替え/ })
  fireEvent.dragStart(handle)
  expect(drag).toHaveBeenCalledOnce()
  fireEvent.keyDown(handle, { key: 'ArrowDown' })
  expect(move).toHaveBeenCalledWith(1)
})
