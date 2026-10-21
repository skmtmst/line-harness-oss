// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TagOverflow from './tag-overflow'
import TruncatedText from './truncated-text'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('reads all names before changing focus stops and keeps observers through clipping changes', async () => {
  const observers: { notify: ResizeObserverCallback; targets: Set<Element>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('ResizeObserver', class {
    targets = new Set<Element>()
    disconnect = vi.fn()
    unobserve = vi.fn((target: Element) => { this.targets.delete(target) })
    constructor(notify: ResizeObserverCallback) { observers.push({ notify, targets: this.targets, unobserve: this.unobserve, disconnect: this.disconnect }) }
    observe(target: Element) { this.targets.add(target) }
  })
  let available = 80
  const reads: (string | null)[][] = []
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => {
    reads.push([...document.querySelectorAll('[data-truncated-text]')].map(node => node.getAttribute('tabindex')))
    return 180
  })
  const { unmount } = render(<>{['first name', 'second name', 'third name'].map(value => <TruncatedText key={value} value={value} />)}</>)
  await act(async () => { await Promise.resolve() })
  expect(reads).toEqual(Array.from({ length: 3 }, () => [null, null, null]))
  for (const node of document.querySelectorAll<HTMLElement>('[data-truncated-text]')) expect(node.tabIndex).toBe(0)
  expect(observers).toHaveLength(1)
  reads.length = 0
  available = 250
  await act(async () => {
    for (const observer of observers) for (let i = 0; i < 4; i++) observer.notify([...observer.targets].map(target => ({ target } as ResizeObserverEntry)), {} as ResizeObserver)
    await Promise.resolve()
  })
  expect(reads).toEqual(Array.from({ length: 3 }, () => ['0', '0', '0']))
  for (const node of document.querySelectorAll('[data-truncated-text]')) expect(node.hasAttribute('tabindex')).toBe(false)
  expect(observers).toHaveLength(1)
  for (const observer of observers) expect(observer.disconnect).not.toHaveBeenCalled()
  fireEvent.mouseEnter(screen.getByText('first name'))
  expect(screen.queryByRole('tooltip')).toBeNull()
  available = 80
  await act(async () => { fireEvent(window, new Event('resize')); await Promise.resolve() })
  fireEvent.focus(screen.getByText('first name'))
  expect(screen.getByRole('tooltip').textContent).toBe('first name')
  fireEvent.scroll(window)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(observers).toHaveLength(1)
  unmount()
  reads.length = 0
  await act(async () => {
    for (const observer of observers) observer.notify([...observer.targets].map(target => ({ target } as ResizeObserverEntry)), {} as ResizeObserver)
    fireEvent(window, new Event('resize'))
    await Promise.resolve()
  })
  expect(reads).toEqual([])
  for (const observer of observers) { expect(observer.unobserve).toHaveBeenCalledTimes(3); expect(observer.disconnect).toHaveBeenCalledOnce() }
})

it('measures tag widths and clipped names in one read phase before either changes the DOM', async () => {
  let notify!: ResizeObserverCallback
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { notify = callback } observe() {} unobserve() {} disconnect() {} })
  let available = 200, natural = 300
  const snapshots: { tab: string | null; visibleTags: number }[] = []
  const snapshot = () => snapshots.push({
    tab: document.querySelector('[data-truncated-text]')?.getAttribute('tabindex') ?? null,
    visibleTags: document.querySelector('[data-tag-overflow]')?.querySelectorAll(':scope > span:not([aria-hidden])').length ?? 0,
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => { snapshot(); return natural })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.hasAttribute('data-tag-overflow-measure')) snapshot()
    return { width: 70, height: 20, top: 0, bottom: 20 } as DOMRect
  })
  render(<><TagOverflow><span>VIP</span><span>member</span></TagOverflow><TruncatedText value="long standalone name" /></>)
  await act(async () => { await Promise.resolve() })
  expect(snapshots).toEqual(Array.from({ length: 3 }, () => ({ tab: null, visibleTags: 0 })))
  expect(screen.getByText('long standalone name').tabIndex).toBe(0)
  expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  expect(document.querySelector('[data-tag-overflow]')?.querySelectorAll(':scope > span:not([aria-hidden])')).toHaveLength(2)
  snapshots.length = 0
  available = 100; natural = 80
  await act(async () => {
    notify([document.querySelector('[data-tag-overflow]')!, screen.getByText('long standalone name')].map(target => ({ target } as ResizeObserverEntry)), {} as ResizeObserver)
    await Promise.resolve()
  })
  // Both subscribers run inside the same observer delivery, before either commit.
  expect(snapshots).toEqual([{ tab: '0', visibleTags: 2 }])
  expect(screen.getByText('long standalone name').hasAttribute('tabindex')).toBe(false)
  expect(screen.getByRole('button', { name: 'すべてのタグ（ほか1件）' })).toBeTruthy()
})
