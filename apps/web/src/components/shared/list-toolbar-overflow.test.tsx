// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ListToolbarFrame, ListToolbarOptional, ListToolbarRow } from './list-toolbar'
import { fitToolbarOverflowPanel } from './list-toolbar-fit.mjs'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([1152, 1440, 1920])('展開する道具を%d幅の白い板内へ寄せ、長い操作も折り返せる幅を渡す', (viewport) => {
  vi.stubGlobal('innerWidth', viewport)
  const toolbar = document.createElement('div'), item = document.createElement('details'), content = document.createElement('div')
  content.dataset.toolbarOptionalContent = ''
  item.append(content); toolbar.append(item); document.body.append(toolbar)
  toolbar.style.paddingLeft = '12px'; toolbar.style.paddingRight = '12px'
  const bounds = new DOMRect(264, 0, viewport - 300, 40)
  vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(bounds)
  vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(new DOMRect(650, 0, 190, 32))
  vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(650, 32, 1400, 40))
  fitToolbarOverflowPanel(item, toolbar)
  const maximum = Number.parseFloat(item.style.getPropertyValue('--toolbar-optional-panel-width'))
  const left = 650 + Number.parseFloat(item.style.getPropertyValue('--toolbar-optional-panel-left'))
  expect(maximum).toBe(bounds.width - 24)
  expect(left).toBeGreaterThanOrEqual(bounds.left + 12)
  expect(left + Math.min(1400, maximum)).toBeLessThanOrEqual(bounds.right - 12)
  toolbar.remove()
})

it('開閉・幅の変更でも入力と操作を残し、Escapeで閉じて見出しへフォーカスを戻す', () => {
  const disconnect = vi.fn(), save = vi.fn(), callbacks: (() => void)[] = []
  let toolbarWidth = 250
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback) } observe() {} disconnect = disconnect })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => toolbarWidth)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(this.tagName === 'DETAILS' ? 150 : 100, 0, this.tagName === 'DETAILS' || this.hasAttribute('data-toolbar-optional-content') || this.hasAttribute('data-toolbar-role') ? 600 : toolbarWidth, 40)
  })
  const { unmount } = render(<ListToolbarFrame><ListToolbarRow>
    <ListToolbarOptional collapse="overflow" label="ほかの絞り込み・操作">
      <input aria-label="担当者の条件" defaultValue="店長" /><button onClick={save}>保存した検索</button>
    </ListToolbarOptional>
  </ListToolbarRow></ListToolbarFrame>)
  const summary = screen.getByText('ほかの絞り込み・操作'), details = summary.closest('details')!
  expect(details.hasAttribute('data-collapsed')).toBe(true)
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  fireEvent.change(screen.getByRole('textbox', { name: '担当者の条件' }), { target: { value: '高田' } })
  fireEvent.click(screen.getByRole('button', { name: '保存した検索' }))
  expect(save).toHaveBeenCalledOnce()
  toolbarWidth = 360
  act(() => { callbacks.forEach(callback => callback()) })
  expect(details.style.getPropertyValue('--toolbar-optional-panel-width')).toBe('360px')
  fireEvent.keyDown(details, { key: 'Escape' })
  expect(details.open).toBe(false)
  expect(document.activeElement).toBe(summary)
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '担当者の条件' }).value).toBe('高田')
  unmount()
  expect(disconnect).toHaveBeenCalled()
})
