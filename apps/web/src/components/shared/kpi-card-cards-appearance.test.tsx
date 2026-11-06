// @vitest-environment happy-dom
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

  it('一覧の線の帯（カードの形でない帯）でも 0 の数に同じ印を付ける', () => {
    const { container } = render(<KpiBand>
      <KpiCard presentation="band" title="友だち" value={0} unit="人" detail="" />
      <KpiCard presentation="band" title="予約" value={12} unit="件" detail="" />
    </KpiBand>)
    expect(container.querySelector('[data-kpi-strip]')?.hasAttribute('data-kpi-appearance')).toBe(false)
    expect([...container.querySelectorAll('[data-design-version]')].map((card) => card.hasAttribute('data-kpi-zero'))).toEqual([true, false])
  })

  it('注意・危険の数は数字に色を付けず、右上の札（黄「要確認」・赤「要対応」）で知らせる。0 件は札を出さない', () => {
    const { container } = render(<KpiBand>
      <KpiCard presentation="band" title="接続に問題" value={2} unit="件" detail={null} valueTone="warning" />
      <KpiCard presentation="band" title="失敗した更新" value={1} unit="回" detail={null} valueTone="danger" />
      <KpiCard presentation="band" title="未配席" value={0} unit="件" detail={null} valueTone="default" />
      <KpiCard presentation="band" title="未返信" value={3} unit="件" detail={null} valueTone="warning" badge="明日" badgeTone="neutral" />
    </KpiBand>)
    const cards = [...container.querySelectorAll('[data-design-version]')]
    const badges = cards.map((card) => { const el = card.querySelector('[data-kpi-badge]'); return el ? [el.getAttribute('data-kpi-badge'), el.textContent] : null })
    expect(badges).toEqual([['warning', '要確認'], ['danger', '要対応'], null, ['neutral', '明日']])
    for (const card of cards) {
      const number = card.querySelector('[data-kpi-number]')?.closest('p')
      expect(number?.className ?? '').not.toMatch(/warning|danger/i)
    }
  })
})
