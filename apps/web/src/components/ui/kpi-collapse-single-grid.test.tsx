// @vitest-environment happy-dom
/*
 * DASH-22 の固定検査。
 *
 * 「今日やること」の4枚がPC幅でも2×2の左半分にしか並ばなかったのは、
 * 先頭2件と残りを別グリッドに分けていたため。ここでは実DOMへ置いて、
 * ・全件が1つのグリッドに並ぶ
 * ・末尾のカードだけが狭い幅を隠すクラスを持つ
 * ・「集計を見る」で隠しクラスが外れる
 * ことを固定する。
 */
import React from 'react'
import { afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import KpiCollapse from './kpi-collapse'

afterEach(() => cleanup())

function renderFour() {
  return render(
    <KpiCollapse gridClassName="grid grid-cols-4 probe-grid">
      <div>A</div>
      <div>B</div>
      <div>C</div>
      <div>D</div>
    </KpiCollapse>,
  )
}

describe('KpiCollapse の単一グリッド（DASH-22）', () => {
  it('4件のカードは1つのグリッドへ全て並ぶ', () => {
    const { container } = renderFour()
    const grids = container.querySelectorAll('.probe-grid')
    expect(grids.length).toBe(1)
    expect(grids[0]!.children.length).toBe(4)
  })

  it('末尾のカードだけが狭い幅を隠すクラスを持つ', () => {
    const { container } = renderFour()
    const grid = container.querySelector('.probe-grid')!
    expect(grid.children[0]!.className).not.toContain('max-sm:hidden')
    expect(grid.children[1]!.className).not.toContain('max-sm:hidden')
    expect(grid.children[2]!.className).toContain('max-sm:hidden')
    expect(grid.children[3]!.className).toContain('max-sm:hidden')
  })

  it('「集計を見る」で末尾の隠しクラスが外れ、閉じると戻る', () => {
    const { container } = renderFour()
    const grid = container.querySelector('.probe-grid')!
    fireEvent.click(screen.getByRole('button', { name: /集計を見る/ }))
    expect(grid.children[2]!.className).not.toContain('max-sm:hidden')
    fireEvent.click(screen.getByRole('button', { name: '集計を閉じる' }))
    expect(grid.children[2]!.className).toContain('max-sm:hidden')
  })

  it('先頭の枠内に収まるなら開閉ボタンを出さずそのまま並べる', () => {
    const { container, queryByRole } = render(
      <KpiCollapse gridClassName="grid probe-grid">
        <div>A</div>
        <div>B</div>
      </KpiCollapse>,
    )
    expect(container.querySelector('.probe-grid')!.children.length).toBe(2)
    expect(queryByRole('button')).toBeNull()
  })
})
