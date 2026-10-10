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
