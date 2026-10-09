// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PeriodPicker, { pastPeriod, validPeriod } from './period-picker'
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
afterEach(cleanup)
it('B-158 決まり5：3期間と指定期間を同じ部品で選び、日付は日本時間の暦日を含める', () => {
 const onChange = vi.fn(), onRangeChange = vi.fn()
 render(<PeriodPicker days={30} onChange={onChange} onRangeChange={onRangeChange} />)
 for (const name of ['過去7日', '過去30日', '過去90日', '期間を指定']) expect(screen.getByRole('button', { name })).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: '過去7日' })); expect(onChange).toHaveBeenCalledWith(7)
 fireEvent.click(screen.getByRole('button', { name: '期間を指定' })); expect(screen.getByLabelText('期間の始まり')).toBeTruthy()
 expect(pastPeriod(7, new Date('2026-10-08T16:00:00Z'))).toEqual({ from: '2026-10-03', to: '2026-10-09' })
 expect(validPeriod({ from:'2026-10-09', to:'2026-10-08' })).toBe(false)
})
it('口が28日までのときは30日と偽らず、できない期間を出さない', () => {
 render(<PeriodPicker days={28} supportedDays={[7,28,90]} onChange={vi.fn()} />)
 expect(screen.getByRole('button',{name:'過去28日'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'過去30日'})).toBeNull()
 expect(screen.queryByRole('button',{name:'期間を指定'})).toBeNull()
})
