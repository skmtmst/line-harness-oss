// @vitest-environment happy-dom
import React, { Profiler } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SegmentedControl from './segmented'

const observed = vi.hoisted(() => ({ callbacks: [] as (() => void)[], stop: vi.fn() }))
vi.mock('./element-resize-observer', () => ({
  observeElementResize: vi.fn((_nodes, callback: () => void) => {
    observed.callbacks.push(callback)
    return observed.stop
  }),
}))
const options = [{ value: 'graph', label: 'グラフ' }, { value: 'table', label: '表' }]
const flush = async () => { await act(async () => { await Promise.resolve() }) }
let left = 90, width = 60
let reads = 0

beforeEach(() => {
  left = 90; width = 60; reads = 0
  observed.callbacks.length = 0; observed.stop.mockClear()
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function () {
    reads++; return (this as HTMLElement).textContent?.startsWith('表') ? left : 3
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => { reads++; return width })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('切替器の寸法追従', () => {
  it('resize通知をまとめ、同じ寸法なら再描画せず、文字・選択・サイズ変更には追従する', async () => {
    const commits = vi.fn()
    const control = (items = options, value = 'table', size: 'small' | 'medium' = 'medium') => (
      <Profiler id="switch" onRender={commits}>
        <SegmentedControl options={items} value={value} size={size} onChange={() => {}} aria-label="表示" />
      </Profiler>
    )
    const view = render(control())
    await flush()
    const thumb = () => view.container.querySelector<HTMLElement>('[aria-hidden="true"]')!
    expect(thumb().style.transform).toBe('translateX(90px)')
    expect(thumb().style.width).toBe('60px')
    reads = 0; commits.mockClear()
    observed.callbacks[0](); observed.callbacks[0](); observed.callbacks[0]()
    await flush()
    expect(reads).toBe(2)
    expect(commits).not.toHaveBeenCalled()
    left = 110; width = 85
    view.rerender(control([{ ...options[0], label: '長いグラフ' }, { ...options[1], label: '表（12件）' }]))
    await flush()
    expect(thumb().style.transform).toBe('translateX(110px)')
    expect(thumb().style.width).toBe('85px')
    expect(observed.callbacks).toHaveLength(1)
    view.rerender(control(options, 'graph', 'small'))
    await flush()
    expect(thumb().style.transform).toBe('translateX(3px)')
    expect(view.container.firstElementChild?.getAttribute('data-size')).toBe('small')
  })

  it('矢印キーで選択とフォーカスを移す', async () => {
    const onChange = vi.fn()
    const view = render(<SegmentedControl options={options} value="graph" onChange={onChange} aria-label="表示" />)
    await flush()
    const buttons = view.getAllByRole('button')
    buttons[0].focus()
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('table')
    expect(document.activeElement).toBe(buttons[1])
  })

  it('件数とフォントの幅変更にも追従し、フォント購読を解除する', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() })
    const remove = vi.spyOn(fonts, 'removeEventListener')
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    try {
      const view = render(<SegmentedControl options={[{ value: 'table', label: '表', count: 1 }]} value="table" onChange={() => {}} aria-label="表示" />)
      await flush()
      width = 100
      view.rerender(<SegmentedControl options={[{ value: 'table', label: '表', count: 100 }]} value="table" onChange={() => {}} aria-label="表示" />)
      await flush()
      const thumb = view.container.querySelector<HTMLElement>('[aria-hidden="true"]')!
      expect(thumb.style.width).toBe('100px')
      width = 120
      fonts.dispatchEvent(new Event('loadingdone'))
      await flush()
      expect(thumb.style.width).toBe('120px')
      view.unmount()
      expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function))
      reads = 0
      fonts.dispatchEvent(new Event('loadingdone'))
      await flush()
      expect(reads).toBe(0)
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it.each(['choices', 'reservation', 'intake-stop'] as const)('%s はつまみの寸法を測らない', async appearance => {
    const view = render(<SegmentedControl appearance={appearance} options={options} value="graph" onChange={() => {}} aria-label="表示" />)
    await flush()
    expect(reads).toBe(0)
    expect(observed.callbacks).toHaveLength(0)
    expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('取り外すと予約済みの測定とresize購読を止める', async () => {
    const view = render(<SegmentedControl options={options} value="graph" onChange={() => {}} aria-label="表示" />)
    view.unmount()
    observed.callbacks[0]()
    await flush()
    expect(reads).toBe(0)
    expect(observed.stop).toHaveBeenCalledOnce()
  })
})
