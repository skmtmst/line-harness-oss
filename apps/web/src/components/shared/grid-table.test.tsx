// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GridCell, GridHeadRow, GridRow, GridTable } from './grid-table'

const design = { columns: '80px 80px 80px', gap: '8px', rowPadding: '12px', rowHeight: '40px', headHeight: '40px', fontSize: '12px' }
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('GridTableの見出し', () => {
  it('省略した文字見出しは全文をTabとフォーカスで確認でき、短い文字にTab停止を追加しない', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () { return this.textContent === '非常に長いメディア容量の見出し' ? 220 : 40 })
    render(<GridTable label="容量" design={design}><GridHeadRow><GridCell role="columnheader">非常に長いメディア容量の見出し</GridCell><GridCell role="columnheader" align="right">件数</GridCell></GridHeadRow><GridRow><GridCell>そのままの本文</GridCell></GridRow></GridTable>)
    const label = screen.getByTitle('非常に長いメディア容量の見出し')
    await waitFor(() => expect(label.tabIndex).toBe(0))
    expect(screen.getByTitle('件数').hasAttribute('tabindex')).toBe(false)
    expect(screen.getByRole('columnheader', { name: '件数' }).getAttribute('data-align')).toBe('right')
    fireEvent.focus(label)
    expect(screen.getByRole('tooltip').textContent).toBe('非常に長いメディア容量の見出し')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('cell').querySelector('[data-truncated-text]')).toBeNull()
  })

  it('複合見出し内の操作とsr-only、aria-hiddenの意味を保つ', () => {
    const click = vi.fn()
    const view = render(<GridTable label="複合見出し" design={design}><GridHeadRow>
      <GridCell role="columnheader"><button type="button" onClick={click}>名前で並べ替え</button></GridCell>
      <GridCell role="columnheader">操作</GridCell>
      <GridCell role="columnheader" aria-hidden="true">飾り</GridCell>
      <GridCell role="columnheader" className="sr-only">補助</GridCell>
    </GridHeadRow></GridTable>)
    fireEvent.click(screen.getByRole('button', { name: '名前で並べ替え' }))
    expect(click).toHaveBeenCalledOnce()
    expect(screen.getByRole('columnheader', { name: '操作' }).firstElementChild?.className).toBe('sr-only')
    expect(view.container.querySelector('[aria-hidden="true"]')?.textContent).toBe('飾り')
    expect(view.container.querySelector('[aria-hidden="true"] [data-truncated-text]')).toBeNull()
    expect(view.container.querySelector('.sr-only[data-align] [data-truncated-text]')).toBeNull()
    expect(view.container.querySelectorAll('[data-truncated-text]')).toHaveLength(0)
  })
})
