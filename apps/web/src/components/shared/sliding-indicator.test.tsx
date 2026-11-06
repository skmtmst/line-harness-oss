// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SlidingIndicator } from './sliding-indicator'

let reduced = false
let cancel: ReturnType<typeof vi.fn>
let animate: ReturnType<typeof vi.fn>
let media: EventTarget & { matches: boolean }
beforeEach(() => {
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => Object.assign(media, { matches: reduced }))
  reduced = false
  cancel = vi.fn()
  animate = vi.fn(() => ({ cancel }))
  vi.stubGlobal('Animation', class {})
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { left: this.tagName === 'SPAN' ? 35 : 0, width: this.tagName === 'SPAN' ? 90 : 300 } as DOMRect
  })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})
const indicator = (left: number, width: number, selection: string) => <div><SlidingIndicator left={left} width={width} selection={selection} className="indicator" /></div>

it('初回は動かさず、幅の異なる選択もtransformだけで動かす', () => {
  const view = render(indicator(10, 80, 'a'))
  expect(animate).not.toHaveBeenCalled()
  view.rerender(indicator(120, 100, 'b'))
  expect(animate).toHaveBeenCalledWith([
    { transform: 'translateX(35px) scaleX(0.9)' },
    { transform: 'translateX(120px) scaleX(1)' },
  ], expect.objectContaining({ duration: 200 }))
  expect(view.container.querySelector('span')?.style.width).toBe('100px')
  expect(view.container.querySelector('span')?.style.transform).toBe('translateX(120px)')
})

it('連打は現在の見かけの位置から再開し、以前の終了を待たない', () => {
  const view = render(indicator(10, 80, 'a'))
  view.rerender(indicator(120, 100, 'b'))
  view.rerender(indicator(0, 60, 'a'))
  expect(cancel).toHaveBeenCalledOnce()
  expect(animate).toHaveBeenLastCalledWith([
    { transform: 'translateX(35px) scaleX(1.5)' },
    { transform: 'translateX(0px) scaleX(1)' },
  ], expect.any(Object))
  view.unmount()
  expect(cancel).toHaveBeenCalledTimes(2)
})

it('同じ選択の幅調整と、動きを減らす設定は即時反映する', () => {
  const view = render(indicator(10, 80, 'a'))
  view.rerender(indicator(10, 90, 'a'))
  expect(animate).not.toHaveBeenCalled()
  reduced = true
  view.rerender(indicator(120, 100, 'b'))
  expect(animate).not.toHaveBeenCalled()
  expect(view.container.querySelector('span')?.style.transform).toBe('translateX(120px)')
})

it('動いている途中で設定を変えても最終位置へ即時に着く', () => {
  const view = render(indicator(10, 80, 'a'))
  view.rerender(indicator(120, 100, 'b'))
  act(() => { media.matches = true; media.dispatchEvent(new Event('change')) })
  expect(cancel).toHaveBeenCalledOnce()
  expect(view.container.querySelector('span')?.style.transform).toBe('translateX(120px)')
})

it('矢印操作で選択位置へ滑り、連打でも選択を止めない', async () => {
  const { default: SegmentedControl } = await import('./segmented')
  const { fireEvent } = await import('@testing-library/react')
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent === '格子' ? 100 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
  function Control() {
    const [value, setValue] = React.useState('a')
    return <SegmentedControl value={value} onChange={setValue} aria-label="表示" options={[{ value: 'a', label: '一覧' }, { value: 'b', label: '格子' }]} />
  }
  const view = render(<Control />)
  await act(async () => { await Promise.resolve() })
  expect(animate).not.toHaveBeenCalled()
  const buttons = view.getAllByRole('button')
  buttons[0].focus()
  fireEvent.keyDown(buttons[0], { key: 'ArrowRight' })
  await act(async () => { await Promise.resolve() })
  expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
  expect(document.activeElement).toBe(buttons[1])
  expect(animate).toHaveBeenCalledOnce()
  expect(animate.mock.calls[0][0][1].transform).toBe('translateX(100px) scaleX(1)')
  fireEvent.keyDown(buttons[1], { key: 'ArrowLeft' })
  await act(async () => { await Promise.resolve() })
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
  expect(animate).toHaveBeenCalledTimes(2)
  expect(cancel).toHaveBeenCalledOnce()
})
