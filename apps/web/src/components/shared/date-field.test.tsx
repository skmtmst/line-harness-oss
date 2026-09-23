// @vitest-environment happy-dom
/*
 * 日付の選択（★V7 `Fw065`）。値は YYYY-MM-DD のまま、表示は日本語。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DateField, { formatLabel, parseDate } from './date-field'

afterEach(() => cleanup())

function Harness({ initial = '2026-09-23', min }: { initial?: string; min?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateField value={value} onChange={setValue} min={min} aria-label="配信日" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('日付の選択（★V7）', () => {
  it('表示は「2026年9月23日（水）」、値は YYYY-MM-DD', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: '配信日' }).textContent).toContain('2026年9月23日（水）')
    expect(formatLabel(parseDate('2026-09-23')!)).toBe('2026年9月23日（水）')
    expect(parseDate('2026-09-23T10:00')!.getDate()).toBe(23)
    expect(parseDate('')).toBeNull()
  })

  it('開くと6週（42日）の暦で、選んだ日に焦点がある', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '配信日' }))
    expect(screen.getByRole('dialog', { name: '日付を選ぶ' })).toBeTruthy()
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^2026年9月23日（水）/)
  })

  it('矢印で動かし Enter で選ぶと、値が替わって閉じる', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '配信日' }))
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('PageDown で次の月へ送る（月末は月の長さに合わせる）', () => {
    render(<Harness initial="2026-01-31" />)
    fireEvent.click(screen.getByRole('button', { name: '配信日' }))
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'PageDown' })
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('2026年2月')
    expect(screen.getByRole('grid').getAttribute('data-slide')).toBe('next')
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' })
    expect(screen.getByTestId('value').textContent).toBe('2026-02-28')
  })

  it('最小日より前は選べない', () => {
    render(<Harness min="2026-09-10" />)
    fireEvent.click(screen.getByRole('button', { name: '配信日' }))
    fireEvent.click(screen.getByRole('button', { name: '2026年9月9日（水）' }))
    expect(screen.getByTestId('value').textContent).toBe('2026-09-23')
    expect(screen.getByRole('button', { name: '2026年9月9日（水）' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('Esc で閉じ、焦点は欄へ戻る。× で空にできる', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '配信日' })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(screen.getByRole('button', { name: '日付を消す' }))
    expect(screen.getByTestId('value').textContent).toBe('')
    expect(trigger.textContent).toContain('日付を選ぶ')
  })
})
