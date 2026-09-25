// @vitest-environment happy-dom
/*
 * 日時の選択・時刻の選択（★V7 `Fw065` の仲間）。
 * 値は今までどおり（日時 `YYYY-MM-DDTHH:mm`・時刻 `HH:mm`、空は ''）で、
 * 表示だけ日本語。保存の中身は変えない。
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DateTimeField, {
  TimeField,
  formatDateTimeLabel,
  formatTimeLabel,
  parseDateTime,
  parseTime,
} from './date-time-field'

afterEach(() => cleanup())

function DateTimeHarness({ initial = '2026-10-01T10:00' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateTimeField value={value} onChange={setValue} aria-label="送る日時" />
      <output data-testid="value">{value}</output>
    </>
  )
}

function TimeHarness({ initial = '10:00' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <TimeField value={value} onChange={setValue} aria-label="始まる時刻" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('日時の選択（★V7）', () => {
  it('表示は「2026年10月1日（木）10:00」、値は YYYY-MM-DDTHH:mm のまま', () => {
    render(<DateTimeHarness />)
    expect(screen.getByRole('button', { name: '送る日時' }).textContent).toContain('2026年10月1日（木）10:00')
    expect(formatDateTimeLabel(parseDateTime('2026-10-01T10:00')!)).toBe('2026年10月1日（木）10:00')
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01T10:00')
  })

  it('空は置き場所文。秒付きの既存値も読む', () => {
    render(<DateTimeHarness initial="" />)
    expect(screen.getByRole('button', { name: '送る日時' }).textContent).toContain('日時を選ぶ')
    expect(parseDateTime('2026-10-01T10:00:59')).toEqual({
      date: new Date(2026, 9, 1),
      hours: 10,
      minutes: 0,
    })
    expect(parseDateTime('')).toBeNull()
    expect(parseDateTime('2026-10-01')).toBeNull()
    expect(parseDateTime('2026-10-01T25:00')).toBeNull()
  })

  it('日付を選ぶと時刻 10:00 で値が決まる（日本時間の文字列）', () => {
    render(<DateTimeHarness initial="" />)
    fireEvent.click(screen.getByRole('button', { name: '送る日時' }))
    expect(screen.getByRole('dialog', { name: '日時を選ぶ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '日付' }))
    fireEvent.click(screen.getByRole('button', { name: '2026年10月1日（木）' }))
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01T10:00')
    expect(screen.getByRole('button', { name: '送る日時' }).textContent).toContain('2026年10月1日（木）10:00')
  })

  it('時・分を変えると値が替わる。箱は開いたまま', () => {
    render(<DateTimeHarness />)
    fireEvent.click(screen.getByRole('button', { name: '送る日時' }))
    fireEvent.change(screen.getByLabelText('時'), { target: { value: '09' } })
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01T09:00')
    fireEvent.change(screen.getByLabelText('分'), { target: { value: '30' } })
    expect(screen.getByTestId('value').textContent).toBe('2026-10-01T09:30')
    expect(screen.getByRole('dialog', { name: '日時を選ぶ' })).toBeTruthy()
  })

  it('↓で開く。Escで閉じて欄へ戻る。×で空にできる', () => {
    render(<DateTimeHarness />)
    const trigger = screen.getByRole('button', { name: '送る日時' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('dialog', { name: '日時を選ぶ' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog', { name: '日時を選ぶ' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(screen.getByRole('button', { name: '日時を消す' }))
    expect(screen.getByTestId('value').textContent).toBe('')
    expect(trigger.textContent).toContain('日時を選ぶ')
  })

  it('お任せ式（defaultValue）でも時を変えられる', () => {
    const onChange = vi.fn()
    render(<DateTimeField defaultValue="2026-10-01T10:00" onChange={onChange} aria-label="送る日時" />)
    fireEvent.click(screen.getByRole('button', { name: '送る日時' }))
    fireEvent.change(screen.getByLabelText('時'), { target: { value: '18' } })
    expect(onChange).toHaveBeenCalledWith('2026-10-01T18:00')
    expect(screen.getByRole('button', { name: '送る日時' }).textContent).toContain('2026年10月1日（木）18:00')
  })
})

describe('時刻の選択（★V7）', () => {
  it('表示は「10:00」、値は HH:mm のまま', () => {
    render(<TimeHarness />)
    expect(screen.getByRole('button', { name: '始まる時刻' }).textContent).toContain('10:00')
    expect(formatTimeLabel(parseTime('10:00')!)).toBe('10:00')
    expect(parseTime('')).toBeNull()
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('10:00:59')!.minutes).toBe(0)
  })

  it('分を変えると値が替わる。×で空にできる', () => {
    render(<TimeHarness />)
    fireEvent.click(screen.getByRole('button', { name: '始まる時刻' }))
    expect(screen.getByRole('dialog', { name: '時刻を選ぶ' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('分'), { target: { value: '30' } })
    expect(screen.getByTestId('value').textContent).toBe('10:30')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '時刻を消す' }))
    expect(screen.getByTestId('value').textContent).toBe('')
    expect(screen.getByRole('button', { name: '始まる時刻' }).textContent).toContain('時刻を選ぶ')
  })
})
