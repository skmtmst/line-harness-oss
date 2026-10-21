// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TagOverflow from './tag-overflow'
import TagPill from './tag-pill'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('サイズ通知を使えない環境でも、列幅の変更後は全件と+Nを確認できる', async () => {
  vi.stubGlobal('ResizeObserver', undefined)
  let available = 220
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.tagName === 'BUTTON' ? 40 : 80, height: 20, top: 0, bottom: 20 } as DOMRect
  })
  render(<TagOverflow><TagPill name="VIP" /><TagPill name="会員" /></TagOverflow>)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  available = 100
  await act(async () => { window.dispatchEvent(new Event('resize')); await Promise.resolve() })
  expect(screen.getByRole('button', { name: 'すべてのタグ（ほか1件）' })).toBeTruthy()
})
it('列幅の通知では自然幅を再利用し、タグ変更後の全件と+Nを保つ', async () => {
  let available = 220
  const observers: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback) }
    observe() {} unobserve() {} disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  const measured = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.getAttribute('aria-hidden') === 'true' && this.tagName === 'SPAN') measured()
    return { width: this.tagName === 'BUTTON' ? 40 : 80, height: 20, top: 0, bottom: 20 } as DOMRect
  })
  const { container, rerender } = render(<TagOverflow><TagPill name="VIP" /><TagPill name="会員" /></TagOverflow>)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  measured.mockClear()
  available = 100
  await act(async () => {
    const host = container.querySelector('[data-tag-overflow]')!
    for (let i = 0; i < 4; i++) observers[0]([{ target: host } as ResizeObserverEntry], {} as ResizeObserver)
    await Promise.resolve()
  })
  expect(measured).not.toHaveBeenCalled()
  // 1つも入らない幅でも最初の札は省略して出し、残りを +N にする（+N だけにしない）。
  expect(screen.getByRole('button', { name: 'すべてのタグ（ほか1件）' }).textContent).toBe('+1')
  expect(container.querySelector('[data-tag-overflow]')?.textContent).toContain('VIP')
  available = 300
  rerender(<TagOverflow><TagPill name="VIP" /><TagPill name="会員" /><TagPill name="常連" /></TagOverflow>)
  await act(async () => { await Promise.resolve() })
  expect(measured).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  expect([...container.querySelector('[data-tag-overflow]')!.children].filter(el => el.getAttribute('aria-hidden') !== 'true').map(el => el.textContent)).toEqual(['VIP', '会員', '常連'])
})

it('見本のサイズ・フォント適用・同数のタグ変更では自然幅を更新し、解除後は測らない', async () => {
  const observers: ResizeObserverCallback[] = []
  const fonts = new EventTarget()
  let fontStatus = 'loading'
  let ready: () => void = () => {}
  const fontReady = new Promise<void>((resolve) => { ready = resolve })
  Object.defineProperties(fonts, { status: { get: () => fontStatus }, ready: { value: fontReady } })
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  const addFontListener = vi.spyOn(fonts, 'addEventListener')
  const removeFontListener = vi.spyOn(fonts, 'removeEventListener')
  const watched: { targets: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('ResizeObserver', class {
    targets: Element[] = []
    disconnect = vi.fn()
    constructor(callback: ResizeObserverCallback) { observers.push(callback); watched.push(this) }
    observe(target: Element) { this.targets.push(target) }
    unobserve() {}
  })
  let naturalWidth = 60
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180)
  const measured = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.hasAttribute('data-tag-overflow-measure')) measured()
    return { width: this.tagName === 'BUTTON' ? 40 : naturalWidth, height: 20, top: 0, bottom: 20 } as DOMRect
  })
  try {
    const { container, rerender, unmount } = render(<TagOverflow><TagPill name="VIP" /><TagPill name="会員" /></TagOverflow>)
    const flush = () => act(async () => { await Promise.resolve() })
    await flush()
    expect(measured).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
    measured.mockClear()
    naturalWidth = 100
    await act(async () => {
      const sample = container.querySelector('[data-tag-overflow-measure]')!
      observers[0]([{ target: sample } as ResizeObserverEntry], {} as ResizeObserver)
      await Promise.resolve()
    })
    expect(measured).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'すべてのタグ（ほか1件）' }).textContent).toBe('+1')
    measured.mockClear()
    naturalWidth = 60
    await act(async () => { fontStatus = 'loaded'; ready(); await fontReady })
    expect(measured).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
    measured.mockClear()
    naturalWidth = 110
    await act(async () => { fonts.dispatchEvent(new Event('loadingdone')); await Promise.resolve() })
    expect(measured).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'すべてのタグ（ほか1件）' }).textContent).toBe('+1')
    measured.mockClear()
    naturalWidth = 50
    rerender(<TagOverflow><TagPill name="新しいタグ" /><TagPill name="再訪" /></TagOverflow>)
    await flush()
    expect(measured).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
    expect(container.querySelector('[data-tag-overflow]')?.textContent).toContain('新しいタグ')
    measured.mockClear()
    const tagObservers = watched.filter((observer) => observer.targets.some((target) => target.hasAttribute('data-tag-overflow-measure')))
    const notifyTag = observers[watched.indexOf(tagObservers.at(-1)!)]
    unmount()
    await act(async () => { fonts.dispatchEvent(new Event('loadingdone')); notifyTag([], {} as ResizeObserver); await Promise.resolve() })
    expect(measured).not.toHaveBeenCalled()
    expect(tagObservers).toHaveLength(1)
    for (const observer of tagObservers) expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(addFontListener).toHaveBeenCalledOnce()
    expect(removeFontListener).toHaveBeenCalledOnce()
    expect(removeFontListener).toHaveBeenCalledWith('loadingdone', addFontListener.mock.calls[0][1])
  } finally {
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else Reflect.deleteProperty(document, 'fonts')
  }
})

it.each(['parent', 'initial-size'])('%sでタグの自然幅を二重に走査せず、中身が変わったら再計測する', async (trigger) => {
  const callbacks: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
    observe() {} unobserve() {} disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(220)
  const measured = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.hasAttribute('data-tag-overflow-measure')) measured()
    return { width: this.hasAttribute('data-tag-overflow-measure') ? 160 : this.tagName === 'BUTTON' ? 40 : 80, height: 20, top: 0, bottom: 20 } as DOMRect
  })
  const tags = (second = '会員', large = false) => <TagOverflow><TagPill name="VIP" /><TagPill name={second} size={large ? 'md' : 'sm'} /></TagOverflow>
  const { container, rerender } = render(tags())
  await act(async () => { await Promise.resolve() })
  expect(measured).toHaveBeenCalledTimes(2)
  measured.mockClear()
  const samples = container.querySelector('[data-tag-overflow-measure]')!
  if (trigger === 'initial-size') await act(async () => {
    callbacks[0]([{ target: samples, borderBoxSize: [{ inlineSize: 160, blockSize: 0 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    await Promise.resolve()
  })
  rerender(tags())
  await act(async () => { await Promise.resolve() })
  expect(measured).not.toHaveBeenCalled()
  rerender(tags('新しいタグ'))
  await act(async () => { await Promise.resolve() })
  expect(measured).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[data-tag-overflow]')?.textContent).toContain('新しいタグ')
  measured.mockClear()
  rerender(tags('新しいタグ', true))
  await act(async () => { await Promise.resolve() })
  expect(measured).toHaveBeenCalledTimes(2)
})
