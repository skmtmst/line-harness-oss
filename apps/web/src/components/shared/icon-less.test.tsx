// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import KpiCard from './kpi-card'
import RadioCard from './radio-card'

afterEach(() => {
  cleanup()
})

/**
 * 図柄なしの形（j8p3yj の選ぶ箱・X4STXS の数のマス。絵は題＋説明／数だけ）。
 * `icon={null}` で図柄を消す。省略時は今までどおり既定の図柄。
 */
describe('図柄なしの形', () => {
  it('RadioCard は省略時・null とも図柄なし（本線の既定：印は渡したときだけ）', () => {
    const { container, unmount } = render(
      <RadioCard name="a" value="1" checked={false} onChange={() => {}} title="はい" />,
    )
    expect(container.querySelector('[class*="topIcon"]')).toBeNull()
    unmount()
    const none = render(
      <RadioCard name="a" value="1" checked={false} onChange={() => {}} title="はい" icon={null} />,
    )
    expect(none.container.querySelector('[class*="topIcon"]')).toBeNull()
    expect(screen.getByText('はい')).toBeTruthy()
  })

  it('KpiCard は省略時に棒グラフ・null で図柄なし', () => {
    const { container, unmount } = render(<KpiCard title="対応が必要" value="3" unit="件" />)
    expect(container.querySelector('[class*="icon"]')).not.toBeNull()
    unmount()
    const none = render(<KpiCard title="対応が必要" value="3" unit="件" icon={null} />)
    expect(none.container.querySelector('p [class*="icon"]')).toBeNull()
    expect(screen.getByText('対応が必要')).toBeTruthy()
  })
})
