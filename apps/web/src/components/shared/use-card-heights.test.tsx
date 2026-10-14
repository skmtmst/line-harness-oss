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
