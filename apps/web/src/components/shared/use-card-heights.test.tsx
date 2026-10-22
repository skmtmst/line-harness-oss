// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
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
