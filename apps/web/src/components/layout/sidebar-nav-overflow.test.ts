// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchNavOverflow } from './sidebar-nav-overflow'

const observers = vi.hoisted(() => ({ callbacks: [] as (() => void)[], stop: vi.fn(), nodes: [] as Element[][] }))
vi.mock('../shared/element-resize-observer', () => ({
  observeElementResize: vi.fn((nodes: Element[], callback: () => void) => {
    observers.nodes.push(nodes); observers.callbacks.push(callback)
    return observers.stop
  }),
}))
let mutation: () => void
let disconnect: ReturnType<typeof vi.fn>
const flush = async () => { await Promise.resolve() }
const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top } as DOMRect)

beforeEach(() => {
  observers.callbacks.length = 0; observers.nodes.length = 0; observers.stop.mockClear()
  disconnect = vi.fn()
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { mutation = callback }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup() {
  const nav = document.createElement('nav')
  nav.innerHTML = '<a href="/first">最初</a><button>最後</button>'
  document.body.append(nav)
  Object.defineProperty(nav, 'scrollHeight', { configurable: true, value: 200 })
  Object.defineProperty(nav, 'clientHeight', { configurable: true, value: 100 })
  nav.scrollTop = 10
  const bounds = vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(rect(0, 100))
  vi.spyOn(nav.children[0], 'getBoundingClientRect').mockReturnValue(rect(-10, 20))
  vi.spyOn(nav.children[1], 'getBoundingClientRect').mockReturnValue(rect(80, 120))
  return { nav, bounds }
}

describe('左メニューの切れ判定', () => {
  it('通知をまとめて上下の切れを維持し、同じ結果ではCSS・属性を書き直さない', async () => {
    const { nav, bounds } = setup()
    const style = vi.spyOn(nav.style, 'setProperty')
    const attribute = vi.spyOn(nav, 'setAttribute')
    const stop = watchNavOverflow(nav)!
    expect(bounds).not.toHaveBeenCalled()
    nav.dispatchEvent(new Event('scroll')); observers.callbacks.at(-1)!(); mutation()
    await flush()
    expect(bounds).toHaveBeenCalledOnce()
    expect(nav.style.getPropertyValue('--nav-cut-top')).toBe('20px')
    expect(nav.style.getPropertyValue('--nav-cut-bottom')).toBe('20px')
    expect(nav.hasAttribute('data-clipped')).toBe(true)
    style.mockClear(); attribute.mockClear()
    observers.callbacks.at(-1)!(); nav.dispatchEvent(new Event('scroll'))
    await flush()
    expect(style).not.toHaveBeenCalled()
    expect(attribute).not.toHaveBeenCalled()
    nav.scrollTop = 0
    Object.defineProperty(nav, 'scrollHeight', { value: 101 })
    nav.dispatchEvent(new Event('scroll'))
    await flush()
    expect(nav.hasAttribute('data-clipped')).toBe(false)
    expect(nav.style.getPropertyValue('--nav-cut-top')).toBe('0px')
    expect(nav.style.getPropertyValue('--nav-cut-bottom')).toBe('0px')
    stop()
  })

  it('権限などで項目が増えた場合も購読し、取り外し後の通知・予約処理は止める', async () => {
    const { nav, bounds } = setup()
    const stop = watchNavOverflow(nav)!
    await flush()
    const added = document.createElement('div')
    nav.append(added); mutation()
    expect(observers.nodes.at(-1)).toContain(added)
    bounds.mockClear()
    stop()
    observers.callbacks.at(-1)!(); mutation(); nav.dispatchEvent(new Event('scroll'))
    await flush()
    expect(bounds).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(observers.stop).toHaveBeenCalled()
  })
})
