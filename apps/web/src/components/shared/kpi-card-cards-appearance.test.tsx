// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import KpiBand from './kpi-band'
import KpiCard from './kpi-card'

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }))
afterEach(cleanup)

describe('数のカードの形（案A）', () => {
  it('帯に形の印を付け、0 の数には薄い灰の印、流れの数には細いグラフを付ける', () => {
    const { container } = render(<KpiBand appearance="cards">
      <KpiCard presentation="band" title="配信の失敗" value={0} unit="件" detail="すべて届いています" />
      <KpiCard presentation="band" title="今日の友だち" value={3} unit="人" detail="ブロック 0 人" sparkline={[1, 2, 2, 3]} />
      <KpiCard presentation="band" title="次の配信" value={null} unit="" detail="読み込んでいます" loading sparkline={[1, 2]} />
    </KpiBand>)
    expect(container.querySelector('[data-kpi-strip]')?.getAttribute('data-kpi-appearance')).toBe('cards')
    const cards = [...container.querySelectorAll('[data-design-version]')]
    expect(cards.map((card) => card.hasAttribute('data-kpi-zero'))).toEqual([true, false, false])
    expect(cards.map((card) => card.querySelector('[data-kpi-sparkline]') !== null)).toEqual([false, true, false])
  })

  it('形の見た目は共通の値だけで書き、カードの面は共通のカードの変数を読む', () => {
    const css = readFileSync(join(__dirname, 'kpi-band-v8.css'), 'utf8')
    const block = css.slice(css.indexOf("[data-kpi-appearance='cards']"))
    expect(block).toMatch(/box-shadow: var\(--card-shadow\)/)
    expect(block).toMatch(/var\(--card-edge\)/)
    expect(block).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i)
  })
})
