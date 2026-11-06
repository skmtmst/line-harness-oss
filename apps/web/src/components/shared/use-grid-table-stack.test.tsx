// @vitest-environment happy-dom
/* 名前の列が細すぎる幅では行を2段にする（834px の「対応が要るもの」で名前が 5px につぶれた）。 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GridCell, GridHeadRow, GridRow, GridTable } from './grid-table'
import { canStackGridTable, GRID_TABLE_NAME_MIN, restGridTracks, splitGridTracks } from './use-grid-table-stack'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('列の指定を分ける', () => {
  it('かっこの中の空白では分けない', () => {
    expect(splitGridTracks('minmax(0, 1fr) var(--a) calc(var(--b) + 4px) 28px')).toEqual(['minmax(0, 1fr)', 'var(--a)', 'calc(var(--b) + 4px)', '28px'])
    expect(restGridTracks('minmax(0, 1fr) 120px 90px')).toBe('120px 90px')
  })

  it('1 列目が伸び縮みし、ほかに列がある表だけが 2 段になれる', () => {
    expect(canStackGridTable('minmax(0, 1fr) 120px')).toBe(true)
    expect(canStackGridTable('2fr 1fr')).toBe(true)
    expect(canStackGridTable('minmax(0, 1fr)')).toBe(false)
    expect(canStackGridTable('24px minmax(0, 1fr)')).toBe(false)
  })
})

function renderTable(nameWidth: number, presentation?: 'metrics') {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.getAttribute('role') === 'columnheader' && this.textContent === 'アカウント' ? nameWidth : 120
    return { width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
  const { container } = render(
    <GridTable label="対応が要るもの" presentation={presentation} design={{ columns: 'minmax(0, 1fr) 120px 28px', gap: '16px', rowPadding: '0 24px', fontSize: '14px' }}>
      <GridHeadRow><GridCell role="columnheader">アカウント</GridCell><GridCell role="columnheader">件数</GridCell><GridCell role="columnheader">操作</GridCell></GridHeadRow>
      <GridRow><GridCell>然 渋谷店</GridCell><GridCell>3 件</GridCell><GridCell>…</GridCell></GridRow>
    </GridTable>,
  )
  return container.querySelector<HTMLElement>('[role="table"]')!
}

describe('名前の列が細すぎる時だけ 2 段', () => {
  it(`名前が ${GRID_TABLE_NAME_MIN}px より細いと 2 段、2 段目の列は 1 列目を除いた列`, () => {
    const table = renderTable(5)
    expect(table.hasAttribute('data-stacked')).toBe(true)
    expect(table.style.getPropertyValue('--grid-table-rest-columns')).toBe('120px 28px')
  })

  it('名前に幅がある時は 1 段のまま', () => {
    expect(renderTable(GRID_TABLE_NAME_MIN).hasAttribute('data-stacked')).toBe(false)
  })

  it('分析の表（列の並びが意味を持つ）は 2 段にしない', () => {
    expect(renderTable(5, 'metrics').hasAttribute('data-stacked')).toBe(false)
  })
})
