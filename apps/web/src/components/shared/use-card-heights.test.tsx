// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Card from './card'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme') })
it('縦に並ぶカードの幅・高さを内容幅に縮めない', () => {
  document.documentElement.dataset.theme = 'v8'
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const { container } = render(<div style={{ display: 'flex', flexDirection: 'column' }}><Card style={{ minHeight: 140, alignSelf: 'stretch' }}>短文</Card><Card>長い内容</Card></div>)
  frames.splice(0).forEach(cb => cb(0))
  const cards = container.querySelectorAll<HTMLElement>('[data-design-part="card"]')
  expect(cards[0].style.minHeight).toBe('140px')
  expect(cards[0].style.alignSelf).toBe('stretch')
  expect(cards[1].style.alignSelf).toBe('')
  expect(cards[1].style.height).toBe('')
})

it('枠を外した入力段へ箱用の余白を追加せず、枠のある箱だけ対象にする', () => {
  document.documentElement.dataset.theme = 'v8'
  const { container } = render(<div><Card style={{ border: 0, outline: 'none', boxShadow: 'none' }}>入力段</Card><Card style={{ border: '1px solid black', outline: 'none', boxShadow: 'none' }}>枠の箱</Card></div>)
  const cards = container.querySelectorAll<HTMLElement>('[data-design-part="card"]')
  expect(cards[0].hasAttribute('data-card-unframed')).toBe(true)
  expect(cards[1].hasAttribute('data-card-unframed')).toBe(false)
})

it.each([undefined, 'natural'] as const)('横のカードは指定された高さの揃え方を保つ（%s）', cardHeight => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const naturalHeight = this.textContent === '短文' ? 80 : 100
    const height = Math.max(naturalHeight, parseFloat(this.style.minHeight) || 0)
    return { top: 0, left: 0, right: 200, bottom: height, x: 0, y: 0, width: 200, height, toJSON() {} }
  })
  const { container } = render(<div data-card-height={cardHeight} style={{ display: 'grid' }}><Card>短文</Card><Card>長い内容</Card></div>)
  frames.splice(0).forEach(cb => cb(0))
  const cards = container.querySelectorAll<HTMLElement>('[data-design-part="card"]')
  expect([...cards].map(card => card.style.minHeight)).toEqual(cardHeight === 'natural' ? ['', ''] : ['100px', '100px'])
})

it.each([48, 49, 200])('同じ幅に並ぶ情報と操作を持つカードは、自然高の差%sでも高い方へそろえる', difference => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const natural = this.getAttribute('aria-label') === '短い' ? 100 : 100 + difference
    return { top: 0, width: 200, height: Math.max(natural, parseFloat(this.style.minHeight) || 0) } as DOMRect
  })
  const { container } = render(<div style={{ display: 'grid' }}>
    <Card as="article" layout="vertical" aria-label="短い" actions={<button>開く</button>}>情報</Card>
    <Card as="article" layout="vertical" aria-label="長い" actions={<button>開く</button>}>情報と補足</Card>
  </div>)
  frames.splice(0).forEach(cb => cb(0))
  const cards = [...container.querySelectorAll<HTMLElement>('article')]
  expect(cards.map(card => parseFloat(card.style.minHeight))).toEqual([100 + difference, 100 + difference])
  expect(cards.map(card => card.style.alignSelf)).toEqual(['flex-start', 'flex-start'])
})

it.each([
  ['outline', 'solid', '1px', 'none'],
  ['shadow', 'none', '0px', 'rgb(0, 0, 0) 0px 1px 2px'],
])('枠が%sで確定したカードはborder幅を読まない', (_frame, outlineStyle, outlineWidth, boxShadow) => {
  const nativeStyle = window.getComputedStyle.bind(window)
  const borders = vi.fn(() => '0px')
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    if (!element.matches('[data-design-part="card"]')) return nativeStyle(element)
    return { outlineStyle, outlineWidth, boxShadow, getPropertyValue: borders } as unknown as CSSStyleDeclaration
  })
  const { container } = render(<Card>吹き出し</Card>)
  expect(container.querySelector('[data-design-part="card"]')?.hasAttribute('data-card-unframed')).toBe(false)
  expect(borders).not.toHaveBeenCalled()
})

it.each(['top', 'right', 'bottom', 'left'])('outlineと影がない%s辺だけの枠も認識する', side => {
  const nativeStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    if (!element.matches('[data-design-part="card"]')) return nativeStyle(element)
    return { outlineStyle: 'none', outlineWidth: '0px', boxShadow: 'none',
      getPropertyValue: (property: string) => property === `border-${side}-width` ? '1px' : '0px',
    } as CSSStyleDeclaration
  })
  const { container } = render(<Card>辺の枠</Card>)
  expect(container.querySelector('[data-design-part="card"]')?.hasAttribute('data-card-unframed')).toBe(false)
})

it('同じカードでも再描画後のclass・枠の変更をその都度確認する', () => {
  const nativeStyle = window.getComputedStyle.bind(window)
  const reads = vi.fn()
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    if (!element.matches('[data-design-part="card"]')) return nativeStyle(element)
    reads(element.className)
    const framed = element.classList.contains('framed')
    return { outlineStyle: framed ? 'solid' : 'none', outlineWidth: framed ? '1px' : '0px', boxShadow: 'none',
      getPropertyValue: () => '0px',
    } as unknown as CSSStyleDeclaration
  })
  const { container, rerender } = render(<Card className="unframed">入力段</Card>)
  const card = container.querySelector('[data-design-part="card"]')
  expect(card?.hasAttribute('data-card-unframed')).toBe(true)
  rerender(<Card className="framed">枠の箱</Card>)
  expect(container.querySelector('[data-design-part="card"]')).toBe(card)
  expect(card?.hasAttribute('data-card-unframed')).toBe(false)
  rerender(<Card className="unframed">入力段</Card>)
  expect(card?.hasAttribute('data-card-unframed')).toBe(true)
  expect(reads).toHaveBeenCalledTimes(3)
})


it('同じclassでもinlineの枠変更と枠の解除を再描画で反映する', () => {
  const { container, rerender } = render(<Card style={{ border: 0, outline: 'none', boxShadow: 'none' }}>入力段</Card>)
  const card = container.querySelector('[data-design-part="card"]')
  expect(card?.hasAttribute('data-card-unframed')).toBe(true)
  rerender(<Card style={{ border: 0, outline: '1px solid black', boxShadow: 'none' }}>枠の箱</Card>)
  expect(card?.hasAttribute('data-card-unframed')).toBe(false)
  rerender(<Card style={{ border: 0, outline: 'none', boxShadow: 'none' }}>入力段</Card>)
  expect(card?.hasAttribute('data-card-unframed')).toBe(true)
})

it('幅の違う本文と横の欄は、印の無い段ではそろえない', () => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const main = this.getAttribute('aria-label') === '本文'
    return { top: 0, width: main ? 800 : 320, height: Math.max(main ? 600 : 120, parseFloat(this.style.minHeight) || 0) } as DOMRect
  })
  const { container } = render(<div style={{ display: 'grid' }}>
    <Card as="article" aria-label="本文">本文</Card>
    <Card as="article" aria-label="横の欄">横</Card>
  </div>)
  frames.splice(0).forEach(cb => cb(0))
  expect([...container.querySelectorAll<HTMLElement>('article')].map(card => parseFloat(card.style.minHeight))).toEqual([0, 0])
})

function observeActionSlots() {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const slot = this.hasAttribute('data-card-actions') ? this : [...this.children].find(child => child.hasAttribute('data-card-actions')) as HTMLElement | undefined
    const natural = Number(slot?.firstElementChild?.getAttribute('data-natural-height') ?? 0)
    const slotHeight = Math.max(natural, parseFloat(slot?.style.minHeight ?? '') || 0)
    const height = this.hasAttribute('data-card-actions') ? slotHeight : Math.max(100 + slotHeight, parseFloat(this.style.minHeight) || 0)
    return { top: Number(this.dataset.row ?? 0) * 200, width: 200, height } as DOMRect
  })
  return { frames, flush: () => frames.splice(0).forEach(cb => cb(0)) }
}

it('明示equalの同じ行は理由の自然高に操作枠をそろえ、カード高も収める', () => {
  const { flush } = observeActionSlots()
  const { container } = render(<div data-card-height="equal" style={{ display: 'grid' }}>
    <Card actions={<div data-natural-height="36">操作だけ</div>}>情報</Card>
    <Card actions={<div data-natural-height="64">操作と理由全文</div>}>情報</Card>
  </div>)
  flush()
  const slots = [...container.querySelectorAll<HTMLElement>('[data-card-actions]')]
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['64px', '64px'])
  expect([...container.querySelectorAll<HTMLElement>('[data-design-part="card"]')].map(card => card.style.minHeight)).toEqual(['164px', '164px'])
  expect(slots[1].textContent).toBe('操作と理由全文')
})

it.each(['unmarked', 'natural', 'vertical', 'single', 'missing', 'separate-rows'] as const)('操作枠の対象外（%s）に寸法を足さない', mode => {
  const { flush } = observeActionSlots()
  const { container } = render(<div data-card-height={mode === 'unmarked' ? undefined : mode === 'natural' ? 'natural' : 'equal'} style={{ display: mode === 'vertical' ? 'flex' : 'grid', flexDirection: 'column' }}>
    <Card actions={<div data-natural-height="36">操作</div>}>情報</Card>
    {mode !== 'single' ? <Card data-row={mode === 'separate-rows' ? 1 : 0} actions={mode === 'missing' ? undefined : <div data-natural-height="64">操作と理由</div>}>情報</Card> : null}
  </div>)
  flush()
  expect([...container.querySelectorAll<HTMLElement>('[data-card-actions]')].map(slot => slot.style.minHeight)).toEqual(mode === 'single' || mode === 'missing' ? [''] : ['', ''])
})

it('理由が減った再計測では古い操作枠高を解除して縮める', async () => {
  const { frames, flush } = observeActionSlots()
  const content = (height: number) => <div data-card-height="equal" style={{ display: 'grid' }}>
    <Card actions={<div data-natural-height="36">操作</div>}>情報</Card>
    <Card actions={<div data-natural-height={height}>{height === 64 ? '操作と理由' : '操作'}</div>}>情報</Card>
  </div>
  const { container, rerender } = render(content(64))
  flush()
  const slots = [...container.querySelectorAll<HTMLElement>('[data-card-actions]')]
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['64px', '64px'])
  rerender(content(24))
  await waitFor(() => expect(frames.length).toBeGreaterThan(0))
  flush()
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['36px', '36px'])
  expect([...container.querySelectorAll<HTMLElement>('[data-design-part="card"]')].map(card => card.style.minHeight)).toEqual(['136px', '136px'])
})

it('natural切替とcleanupは操作枠の元のinline寸法を復元する', async () => {
  const { frames, flush } = observeActionSlots()
  const content = (height: string) => <div data-card-height={height} style={{ display: 'grid' }}>
    <Card actions={<div data-natural-height="36">操作</div>}>情報</Card>
    <Card actions={<div data-natural-height="64">操作と理由</div>}>情報</Card>
  </div>
  const { container, rerender, unmount } = render(content('equal'))
  const slots = [...container.querySelectorAll<HTMLElement>('[data-card-actions]')]
  slots[0].style.minHeight = '12px'
  flush()
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['64px', '64px'])
  rerender(content('natural'))
  await waitFor(() => expect(frames.length).toBeGreaterThan(0))
  flush()
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['12px', ''])
  rerender(content('equal'))
  await waitFor(() => expect(frames.length).toBeGreaterThan(0))
  flush()
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['64px', '64px'])
  unmount()
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['12px', ''])
})

it('複数から単独へ減ったとき操作枠と本体の元の寸法を両方復元する', async () => {
  const { frames, flush } = observeActionSlots()
  const content = (multiple: boolean) => <div data-card-height="equal" style={{ display: 'grid' }}>
    <Card key="first" style={{ minHeight: 17, alignSelf: 'stretch' }} actions={<div data-natural-height="36">操作</div>}>情報</Card>
    {multiple ? <Card key="second" actions={<div data-natural-height="64">操作と理由</div>}>情報</Card> : null}
  </div>
  const { container, rerender } = render(content(true))
  const cards = [...container.querySelectorAll<HTMLElement>('[data-design-part="card"]')]
  const slots = [...container.querySelectorAll<HTMLElement>('[data-card-actions]')]
  slots[0].style.minHeight = '12px'
  flush()
  expect(cards[0].style.minHeight).toBe('164px')
  rerender(content(false))
  await waitFor(() => expect(frames.length).toBeGreaterThan(0))
  flush()
  expect(cards[0].style.minHeight).toBe('17px')
  expect(cards[0].style.alignSelf).toBe('stretch')
  expect(slots.map(slot => slot.style.minHeight)).toEqual(['12px', ''])
})

it('共有利用者が一つ残る間は監視を解除せず、最後の解除だけ復元する', () => {
  const { flush } = observeActionSlots()
  const content = (both: boolean) => <div data-card-height="equal" style={{ display: 'grid' }}>
    <Card key="first" actions={<div data-natural-height="36">操作</div>}>情報</Card>
    {both ? <Card key="second" actions={<div data-natural-height="64">操作と理由</div>}>情報</Card> : <section key="plain" data-design-part="card"><div data-card-actions><div data-natural-height="64">操作と理由</div></div></section>}
  </div>
  const { container, rerender, unmount } = render(content(true))
  flush()
  const first = container.querySelector<HTMLElement>('[data-card-actions]')!
  const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect')
  rerender(content(false))
  expect(disconnect).not.toHaveBeenCalled()
  expect(first.style.minHeight).toBe('64px')
  unmount()
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(first.style.minHeight).toBe('')
})

it('最終解除後の未解決fontsと遅延frameは寸法を再設定しない', async () => {
  let resolveFonts!: () => void
  const pending = new Promise<void>(resolve => { resolveFonts = resolve })
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: pending } })
  try {
    const { frames, flush } = observeActionSlots()
    const { container, unmount } = render(<div data-card-height="equal" style={{ display: 'grid' }}>
      <Card actions={<div data-natural-height="36">操作</div>}>情報</Card>
      <Card actions={<div data-natural-height="64">操作と理由</div>}>情報</Card>
    </div>)
    const delayedFrame = frames[0]
    flush()
    const cards = [...container.querySelectorAll<HTMLElement>('[data-design-part="card"]')]
    const slots = [...container.querySelectorAll<HTMLElement>('[data-card-actions]')]
    expect(slots.map(slot => slot.style.minHeight)).toEqual(['64px', '64px'])
    unmount()
    const requested = vi.mocked(window.requestAnimationFrame).mock.calls.length
    await act(async () => { resolveFonts(); await pending })
    delayedFrame(0)
    expect(vi.mocked(window.requestAnimationFrame)).toHaveBeenCalledTimes(requested)
    expect(slots.map(slot => slot.style.minHeight)).toEqual(['', ''])
    expect(cards.map(card => card.style.minHeight)).toEqual(['', ''])
  } finally {
    if (descriptor) Object.defineProperty(document, 'fonts', descriptor)
    else Reflect.deleteProperty(document, 'fonts')
  }
})
