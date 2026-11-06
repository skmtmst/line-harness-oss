// @vitest-environment happy-dom
/*
 * カードの一覧（ListPageCards）は、同じ行のカードを高い方にそろえる。
 * 警告の帯の分だけ高いカードがあっても（差が48を超えても）そろえ、行ごとに別の高さを持つ。
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
import Card from '@/components/shared/card'
import { ListPageCards } from './list-page'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const natural: Record<string, { top: number; height: number }> = {
  '警告あり': { top: 0, height: 260 },
  '警告なし': { top: 0, height: 180 },
  'アーカイブ': { top: 0, height: 150 },
  '次の行': { top: 300, height: 170 },
  '次の行の警告': { top: 300, height: 250 },
}

it('同じ行のカードは差が大きくても高い方にそろえ、行ごとに分ける', () => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  // 試験の環境は CSS Modules を読まないので、型の段が grid であることだけを渡す。
  const nativeStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => element.hasAttribute('data-card-columns')
    ? { display: 'grid', flexDirection: 'row' } as CSSStyleDeclaration
    : nativeStyle(element))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const own = natural[this.getAttribute('aria-label') ?? ''] ?? { top: 0, height: 0 }
    const height = Math.max(own.height, parseFloat(this.style.minHeight) || 0)
    return { top: own.top, left: 0, right: 200, bottom: own.top + height, x: 0, y: own.top, width: 200, height, toJSON() {} }
  })
  const { container } = render(<ListPageCards>
    {Object.keys(natural).map(label => <Card key={label} as="article" layout="vertical" aria-label={label} actions={<button type="button">入る</button>}>{label}</Card>)}
  </ListPageCards>)
  frames.splice(0).forEach(cb => cb(0))
  const heights = Object.fromEntries([...container.querySelectorAll<HTMLElement>('article')].map(card => [card.getAttribute('aria-label'), card.style.minHeight]))
  expect(heights).toEqual({
    '警告あり': '260px', '警告なし': '260px', 'アーカイブ': '260px',
    '次の行': '250px', '次の行の警告': '250px',
  })
})
