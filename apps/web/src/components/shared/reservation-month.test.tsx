// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReservationBoardEntry } from '@line-crm/shared'
import ReservationMonth from './reservation-month'

const entry = {
  id: 'reservation-1', startsAt: '2028-02-28T15:30:00Z',
  customerName: '長い名前のお客さま（追加情報を含む）',
} as ReservationBoardEntry
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('JSTの翌日に置き、長い名前を全文確認して同じ予約を開く', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80)
  const open = vi.fn()
  render(<ReservationMonth month="2028-02" entries={[entry]} onOpen={open} readableNames />)
  const label = `00:30 ${entry.customerName}`
  const button = screen.getByRole('button', { name: label })
  expect(button.parentElement?.querySelector('strong')?.textContent).toBe('29日')
  expect(button.title).toBe(label)
  expect(button.querySelector('[data-folder-dot]')).toBeNull()
  fireEvent.focus(button)
  expect((await screen.findByRole('tooltip')).textContent).toBe(label)
  fireEvent.click(button)
  expect(open).toHaveBeenCalledWith(entry.id)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('指定しない月は以前の名前操作の形と行き先を保つ', () => {
  const open = vi.fn()
  render(<ReservationMonth month="2028-02" entries={[entry]} onOpen={open} />)
  const button = screen.getByRole('button', { name: `00:30 ${entry.customerName}` })
  expect(button.querySelector('[data-list-name]')).toBeNull()
  expect(button.hasAttribute('data-full-width')).toBe(false)
  expect(button.hasAttribute('title')).toBe(false)
  fireEvent.click(button)
  expect(open).toHaveBeenCalledWith(entry.id)
})

it('対象外の月の予約は描かず、閏年でない2月は28日まで', () => {
  render(<ReservationMonth month="2027-02" entries={[entry]} onOpen={vi.fn()} />)
  expect(screen.getByText('28日')).toBeTruthy()
  expect(screen.queryByText('29日')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})
