// @vitest-environment happy-dom
/*
 * 受信箱の窓分け（2026-10-07 速さの作業）。
 *
 * - 吹き出し 1,000 個・会話 500 件でも、見えている所の前後だけを描く
 * - 読み上げ：吹き出しは feed／article、一覧は list／listitem で、
 *   「全 n 件中 m 件目」を aria-setsize・aria-posinset で伝える
 *   （続きがある間は全体数が分からないので -1）
 * - キーボード：吹き出し・行を矢印で前後へ移れる
 * - 寸法の取れない環境（見える高さ 0）は全部描く（従来どおり）
 *
 * happy-dom は寸法を持たないので、欄の高さ 400px・行の高さ 50px を与える。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, useRef } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import ChatThreadWindow from './chat-thread-window'
import ChatListWindow from './chat-list-window'

const restore: Array<() => void> = []
function stubLayout(withViewport: boolean) {
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return withViewport && (this as HTMLElement).dataset.testScroller !== undefined ? 400 : 0 },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return (this as HTMLElement).hasAttribute('data-vw-key') ? 50 : 0 },
  })
  // 位置：欄の上端を 0 とし、行 i は i*50 - scrollTop に置く（行の高さ 50px）。
  const rect = Element.prototype.getBoundingClientRect
  const scrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  const tops = new WeakMap<Element, number>()
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() { return tops.get(this as Element) ?? 0 },
    set(value: number) { tops.set(this as Element, value) },
  })
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const scroller = this.closest('[data-test-scroller]')
    const scrollTop = scroller ? (tops.get(scroller) ?? 0) : 0
    let top = 0
    if (this.hasAttribute('data-test-scroller')) top = 0
    else if (this.hasAttribute('data-vw-key')) top = Number((this as HTMLElement).dataset.index) * 50 - scrollTop
    else if (this.getAttribute('role') === 'feed' || this.getAttribute('role') === 'list') top = -scrollTop
    return { top, bottom: top + 50, left: 0, right: 0, width: 0, height: 50, x: 0, y: top, toJSON() {} } as DOMRect
  }
  restore.push(() => {
    if (client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', client)
    if (offset) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offset)
    if (scrollTopDesc) Object.defineProperty(Element.prototype, 'scrollTop', scrollTopDesc)
    Element.prototype.getBoundingClientRect = rect
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  cleanup()
  while (restore.length) restore.pop()?.()
  vi.unstubAllGlobals()
})

const messages = Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, text: `本文 ${i}` }))

function Thread({ hasMore, onLoadOlder = () => {} }: { hasMore: boolean; onLoadOlder?: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div ref={ref} data-test-scroller="" style={{ overflowY: 'auto', height: 400 }}>
      <ChatThreadWindow
        messages={messages}
        scrollerRef={ref}
        hasMore={hasMore}
        loadingOlder={false}
        onLoadOlder={onLoadOlder}
        renderMessage={(m) => <span>{m.text}</span>}
      />
    </div>
  )
}

describe('吹き出しの窓分け', () => {
  test('1,000 個でも描くのは一部だけ。いちばん新しい吹き出しから見せる', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Thread hasMore={false} />) })
    const articles = view.container.querySelectorAll('[role="article"]')
    expect(articles.length).toBeGreaterThan(0)
    expect(articles.length).toBeLessThan(100)
    const last = articles[articles.length - 1]
    expect(last.textContent).toBe('本文 999')
    expect(last.getAttribute('aria-posinset')).toBe('1000')
    expect(last.getAttribute('aria-setsize')).toBe('1000')
    // Tab で入れるのは最新の1つだけ
    expect(view.container.querySelectorAll('[role="article"][tabindex="0"]').length).toBe(1)
    expect(view.container.querySelector('[role="feed"]')?.getAttribute('data-loaded')).toBe('1000')
  })

  test('前がまだある間は全体数を -1（分からない）で伝える', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Thread hasMore />) })
    const last = [...view.container.querySelectorAll('[role="article"]')].pop()
    expect(last?.getAttribute('aria-setsize')).toBe('-1')
  })

  test('↑ で1つ前の吹き出しへ移る', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Thread hasMore={false} />) })
    const last = view.container.querySelector<HTMLElement>('[data-index="999"]')!
    last.focus()
    await act(async () => { fireEvent.keyDown(last, { key: 'ArrowUp' }) })
    expect(document.activeElement?.getAttribute('data-index')).toBe('998')
  })

  test('いちばん上で ↑ を押すと古い分を読む', async () => {
    stubLayout(false)
    const onLoadOlder = vi.fn()
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Thread hasMore onLoadOlder={onLoadOlder} />) })
    const first = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    first.focus()
    await act(async () => { fireEvent.keyDown(first, { key: 'ArrowUp' }) })
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  test('寸法の取れない環境では全部描く（従来どおり）', async () => {
    stubLayout(false)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<Thread hasMore={false} />) })
    expect(view.container.querySelectorAll('[role="article"]').length).toBe(1000)
  })
})

function List({ hasMore }: { hasMore: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const items = Array.from({ length: 500 }, (_, i) => ({ key: `c${i}`, render: () => <button type="button">会話 {i}</button> }))
  return (
    <div ref={ref} data-test-scroller="" style={{ overflowY: 'auto', height: 400 }}>
      <ChatListWindow items={items} scrollerRef={ref} hasMore={hasMore} />
    </div>
  )
}

describe('会話の一覧の窓分け', () => {
  test('500 件でも描くのは上の一部だけ。行の位置と全体数を伝える', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<List hasMore={false} />) })
    const rows = view.container.querySelectorAll('[role="listitem"]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
    expect(rows[0].getAttribute('aria-posinset')).toBe('1')
    expect(rows[0].getAttribute('aria-setsize')).toBe('500')
  })

  test('続きがある間は全体数を -1 で伝える', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<List hasMore />) })
    expect(view.container.querySelector('[role="listitem"]')?.getAttribute('aria-setsize')).toBe('-1')
  })

  test('スクロールすると、見えている所の行に描き替わる（欄と中身が同じ描画で生まれても）', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<List hasMore={false} />) })
    const scroller = view.container.querySelector<HTMLElement>('[data-test-scroller]')!
    await act(async () => {
      scroller.scrollTop = 10000 // 行 200 のあたり
      scroller.dispatchEvent(new Event('scroll'))
      await new Promise((done) => requestAnimationFrame(() => done(null)))
    })
    const indexes = [...view.container.querySelectorAll('[role="listitem"]')].map((row) => Number(row.getAttribute('data-index')))
    expect(Math.min(...indexes)).toBeLessThanOrEqual(200)
    expect(Math.max(...indexes)).toBeGreaterThanOrEqual(208)
    expect(Math.min(...indexes)).toBeGreaterThan(100)
  })

  test('↓ で次の行のボタンへ移る', async () => {
    stubLayout(true)
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<List hasMore={false} />) })
    const first = view.container.querySelector<HTMLElement>('[data-index="0"] button')!
    first.focus()
    await act(async () => { fireEvent.keyDown(first, { key: 'ArrowDown' }) })
    expect(document.activeElement?.textContent).toBe('会話 1')
  })
})
