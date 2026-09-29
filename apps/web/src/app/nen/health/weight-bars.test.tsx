// @vitest-environment happy-dom
/**
 * 体重の推移（8週）の小さな棒。8px 幅の棒に丸み（rounded-t-sm = 4px）を
 * 付けると、丸いはずの点が縦長に見える（8×16・8×24）。棒の上は丸めず、
 * 高さの違い（値の推移）だけを残すことが約束。
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WeightBars } from './health-tab'

describe('体重の推移の棒は丸めない（m22a）', () => {
  it('値のある週の棒に丸みの class が付かない', () => {
    const { container } = render(
      <WeightBars series={[3.0, 3.1, 3.0, 3.4, 3.2, 3.5, 3.1, 3.6]} warn={false} />,
    )
    const bars = [...container.querySelectorAll('span > span')].filter((el) =>
      el.className.includes('w-2') && !el.className.includes('h-0.5'),
    )
    expect(bars).toHaveLength(8)
    for (const bar of bars) {
      expect(bar.className).not.toMatch(/rounded/)
    }
  })

  it('記録の無い週は薄い線のまま・読み上げ名は変わらない', () => {
    const { container } = render(<WeightBars series={[3.0, null, null, 3.2, null, null, null, null]} warn={false} />)
    const img = container.firstElementChild as Element
    expect(img.getAttribute('role')).toBe('img')
    expect(img.getAttribute('aria-label')).toMatch(/体重の推移（8週）/)
    expect(container.querySelectorAll('[class*="h-0.5"]').length).toBeGreaterThan(0)
  })
})
