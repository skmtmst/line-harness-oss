// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { observeElementResize } from './element-resize-observer'
import TruncatedText from './truncated-text'

const stops: (() => void)[] = []
afterEach(() => { cleanup(); for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mockObserver() {
  const instances: FakeObserver[] = []
  class FakeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    constructor(readonly callback: ResizeObserverCallback) { instances.push(this) }
    deliver(targets: Element[]) { this.callback(targets.map(target => ({ target } as ResizeObserverEntry)), this as unknown as ResizeObserver) }
  }
  vi.stubGlobal('ResizeObserver', FakeObserver)
  return instances
}
function listen(targets: Element[], callback: (entries: readonly ResizeObserverEntry[]) => void) {
  const stop = observeElementResize(targets, callback)
  stops.push(stop)
  return stop
}

it('creates one observer lazily, groups all entries per subscriber and releases each target once', () => {
  const instances = mockObserver()
  const a = document.createElement('span'), b = document.createElement('span')
  const first = vi.fn(), second = vi.fn()
  listen([], vi.fn())
  expect(instances).toHaveLength(0)
  const stopFirst = listen([a, b, a], first)
  const stopSecond = listen([a], second)
  expect(instances).toHaveLength(1)
  expect(instances[0].observe.mock.calls).toEqual([[a], [b]])
  instances[0].deliver([a, b])
  expect(first).toHaveBeenCalledTimes(1)
  expect(first.mock.calls[0][0].map((entry: ResizeObserverEntry) => entry.target)).toEqual([a, b])
  expect(second.mock.calls[0][0].map((entry: ResizeObserverEntry) => entry.target)).toEqual([a])
  stopFirst(); stopFirst()
  expect(instances[0].unobserve.mock.calls).toEqual([[b]])
  expect(instances[0].disconnect).not.toHaveBeenCalled()
  first.mockClear(); second.mockClear()
  instances[0].deliver([a, b])
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
  stopSecond()
  expect(instances[0].unobserve.mock.calls).toEqual([[b], [a]])
  expect(instances[0].disconnect).toHaveBeenCalledOnce()
})

it('ignores a disconnected observer after targets are replaced and stops a subscriber removed during delivery', () => {
  const instances = mockObserver()
  const a = document.createElement('span'), b = document.createElement('span')
  const old = vi.fn(), current = vi.fn(), removed = vi.fn()
  listen([a], old)()
  let stopRemoved = () => {}
  listen([b], () => { current(); stopRemoved() })
  stopRemoved = listen([b], removed)
  expect(instances).toHaveLength(2)
  instances[0].deliver([b])
  expect(current).not.toHaveBeenCalled()
  instances[1].deliver([a, b])
  expect(old).not.toHaveBeenCalled()
  expect(current).toHaveBeenCalledOnce()
  expect(removed).not.toHaveBeenCalled()
})

it('StrictMode leaves only current targets subscribed and cancels callbacks after final unmount', async () => {
  const instances = mockObserver()
  const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80)
  const view = render(<StrictMode><TruncatedText value="first" /></StrictMode>)
  await act(async () => { await Promise.resolve() })
  expect(instances).toHaveLength(2)
  expect(instances[0].disconnect).toHaveBeenCalledOnce()
  const old = view.getByText('first')
  view.rerender(<StrictMode><TruncatedText key="replacement" value="second" /></StrictMode>)
  await act(async () => { await Promise.resolve() })
  const current = view.getByText('second')
  width.mockClear()
  await act(async () => { for (const instance of instances) instance.deliver([old, current]); await Promise.resolve() })
  expect(width).toHaveBeenCalledOnce()
  view.unmount(); width.mockClear()
  await act(async () => { for (const instance of instances) instance.deliver([current]); await Promise.resolve() })
  expect(width).not.toHaveBeenCalled()
  for (const instance of instances) expect(instance.disconnect).toHaveBeenCalledOnce()
})

it('uses one resize fallback when observation is unavailable and removes it with the final subscriber', () => {
  vi.stubGlobal('ResizeObserver', undefined)
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
  const first = vi.fn(), second = vi.fn(), node = document.createElement('span')
  const stopFirst = listen([node], first), stopSecond = listen([node], second)
  expect(add.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1)
  window.dispatchEvent(new Event('resize'))
  expect(first).toHaveBeenCalledWith([]); expect(second).toHaveBeenCalledWith([])
  stopFirst(); first.mockClear(); second.mockClear()
  window.dispatchEvent(new Event('resize'))
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce()
  expect(remove).not.toHaveBeenCalled()
  stopSecond(); second.mockClear()
  expect(remove.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1)
  window.dispatchEvent(new Event('resize'))
  expect(second).not.toHaveBeenCalled()
})
