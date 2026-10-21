// @vitest-environment happy-dom
import React, { Profiler } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tabs } from './tabs'

let resize: ResizeObserverCallback
let observed: Element[] = []
let width = 140, left = 10, reads = 0, hidden = false
const flush = async () => { await act(async () => { await Promise.resolve() }) }
beforeEach(() => {
  observed = []; width = 140; left = 10; reads = 0; hidden = false
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe(target: Element) { observed.push(target) }
    unobserve() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    reads++
    return { left: this.getAttribute('role') === 'tab' ? left : 0, width: hidden ? 0 : this.getAttribute('role') === 'tab' ? width : 300, height: hidden ? 0 : 20 } as DOMRect
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

const ITEMS = [
  { label: 'すべて', current: true },
  { label: '予約中' },
]

/*
 * ★V8 仕上げ（M10）：選ばれている下線が滑って移る。
 * 古いDOMの値が残っていても同じ下線を使う。
 */
describe('V8 タブの下線', () => {
  it('古いDOMの値で現役の下線を止めない', async () => {
    document.documentElement.dataset.theme = 'v7'
    const { container } = render(<Tabs items={ITEMS} />)
    await flush()
    expect(screen.getByRole('tablist').getAttribute('data-sliding')).toBe('true')
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('v8は今のタブの下に動く印を出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    const { container } = render(<Tabs items={ITEMS} />)
    await flush()
    expect(screen.getByRole('tablist').getAttribute('data-sliding')).toBe('true')
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('確認待ちの件数が変わったら、下線も新しいタブの幅に合わせる', async () => {
    document.documentElement.dataset.theme = 'v8'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.getAttribute('role') === 'tab' ? (this.textContent?.endsWith('100') ? 160 : 140) : 300
      return { left: 0, top: 0, right: width, bottom: 20, width, height: 20, x: 0, y: 0, toJSON: () => ({}) }
    })
    const { container, rerender } = render(<Tabs items={[{ label: '紙のカードの移行', current: true, count: 9, countTone: 'warning' }]} />)
    await flush()
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).style.width).toBe('140px')
    rerender(<Tabs items={[{ label: '紙のカードの移行', current: true, count: 100, countTone: 'warning' }]} />)
    await flush()
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).style.width).toBe('160px')
  })

  it('繰り返すresize通知を1計測にまとめ、同じ寸法なら再描画しない', async () => {
    const commits = vi.fn()
    render(<Profiler id="tabs" onRender={commits}><Tabs items={ITEMS} /></Profiler>)
    await flush()
    reads = 0; commits.mockClear()
    const entries = observed.map(target => ({ target })) as ResizeObserverEntry[]
    act(() => { resize(entries, {} as ResizeObserver); resize(entries, {} as ResizeObserver); resize(entries, {} as ResizeObserver) })
    await flush()
    expect(reads).toBe(2)
    expect(commits).not.toHaveBeenCalled()
  })

  it('未選択・折返しでは計測せず、隠れた欄のゼロ寸法で有効な下線を失わない', async () => {
    const view = render(<Tabs items={ITEMS} />)
    await flush()
    hidden = true; reads = 0
    act(() => resize(observed.map(target => ({ target })) as ResizeObserverEntry[], {} as ResizeObserver))
    await flush()
    expect(view.container.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.width).toBe('140px')
    hidden = false; width = 180
    act(() => resize(observed.map(target => ({ target })) as ResizeObserverEntry[], {} as ResizeObserver))
    await flush()
    expect(view.container.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.width).toBe('180px')
    view.rerender(<Tabs items={ITEMS.map(item => ({ ...item, current: false }))} />)
    await flush()
    expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull()
    reads = 0
    view.rerender(<Tabs items={ITEMS} wrap />)
    await flush()
    expect(reads).toBe(0)
  })

  it('キーボードはdisabledを飛ばし、選択を変えずフォーカスだけ移す', async () => {
    const choose = vi.fn()
    render(<Tabs items={[...ITEMS.map(item => ({ ...item, onClick: choose })), { label: '不可', disabled: true }]} />)
    await flush()
    const first = screen.getByRole('tab', { name: 'すべて' }), second = screen.getByRole('tab', { name: '予約中' })
    first.focus(); fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(second)
    expect(first.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(second, { key: 'End' })
    expect(document.activeElement).toBe(second)
    expect(choose).not.toHaveBeenCalled()
  })

  it('選択・文字・フォント・表示幅へ追従し、取り外すと予約済みの測定も解除する', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    const fonts = Object.assign(new EventTarget(), { status: 'loaded', ready: Promise.resolve() })
    const remove = vi.spyOn(fonts, 'removeEventListener')
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    try {
      const view = render(<Tabs items={ITEMS} />)
      await flush()
      const indicator = () => view.container.querySelector<HTMLElement>('[aria-hidden="true"]')!
      left = 150; width = 90
      view.rerender(<Tabs items={[{ label: 'すべて' }, { label: '予約中（変更）', current: true }]} />)
      await flush()
      expect(indicator().style.transform).toBe('translateX(150px)')
      expect(indicator().style.width).toBe('90px')
      width = 110
      fonts.dispatchEvent(new Event('loadingdone'))
      await flush()
      expect(indicator().style.width).toBe('110px')
      width = 125
      fireEvent(window, new Event('resize'))
      await flush()
      expect(indicator().style.width).toBe('125px')
      reads = 0
      fonts.dispatchEvent(new Event('loadingdone'))
      view.unmount()
      await flush()
      expect(reads).toBe(0)
      expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function))
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })
})
