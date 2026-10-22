// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CalendarTimeEntries } from './calendar-parts'

const day = '2026-10-21'
const entry = (id: string, start = '10:00', end = '11:00') => ({ id, day, start, end, title: `予約${id}`, name: `名前${id}` })
const position = () => ({ insetBlockStart: 0, blockSize: 100, inlineSize: 200 })
beforeEach(() => { document.documentElement.dataset.theme = 'v8' })
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('shows both overlapping reservations and keeps every free start in a separate lane/list', async () => {
  const onOpen = vi.fn(), onSlot = vi.fn()
  render(<CalendarTimeEntries days={[day]} entries={[entry('a'), entry('b')]} free={[{ day, start: '10:00', end: '11:00' }, { day, start: '10:30', end: '11:30' }]} canWrite position={position} onOpen={onOpen} onSlot={onSlot} />)
  const bookings = [screen.getByRole('button', { name: '10:00〜11:00 予約a 名前a' }), screen.getByRole('button', { name: '10:00〜11:00 予約b 名前b' })]
  expect(bookings.map(button => button.style.getPropertyValue('--calendar-lane'))).toEqual(['0', '1'])
  const slots = screen.getByRole('button', { name: `${day} 10:00からの空き2件を選ぶ` })
  expect(slots.style.getPropertyValue('--calendar-lane')).toBe('2')
  expect([...bookings, slots].every(button => button.style.getPropertyValue('--calendar-lanes') === '3')).toBe(true)
  bookings.forEach(button => fireEvent.click(button))
  for (const [start, end] of [['10:00', '11:00'], ['10:30', '11:30']]) {
    fireEvent.click(slots)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: `${day} ${start}〜${end}に予約を入れる` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
  expect(onOpen.mock.calls).toEqual([['a'], ['b']])
  expect(onSlot.mock.calls).toEqual([[day, '10:00'], [day, '10:30']])
  expect(document.querySelector('[class*="blockOver"]')).toBeNull()
})

it('shows every transitive peak-two entry without a misleading overflow count', () => {
  render(<CalendarTimeEntries days={[day]} entries={[entry('a', '10:00', '11:00'), entry('b', '10:30', '11:30'), entry('c', '11:00', '12:00')]} free={[]} canWrite={false} position={position} onOpen={vi.fn()} onSlot={vi.fn()} />)
  expect(screen.getAllByRole('button')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /すべて見る/ })).toBeNull()
})

it('opens a common keyboard dialog for all IDs and retains read-only detail access', async () => {
  const onOpen = vi.fn(), onSlot = vi.fn()
  render(<CalendarTimeEntries days={[day]} entries={[entry('a'), entry('b'), entry('c'), entry('d')]} free={[{ day, start: '10:00', end: '11:00' }]} canWrite={false} position={position} onOpen={onOpen} onSlot={onSlot} />)
  const trigger = screen.getByRole('button', { name: 'ほか2件・この時間帯の予約4件をすべて見る' })
  expect(screen.queryByRole('button', { name: /に予約を入れる/ })).toBeNull()
  trigger.focus(); fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: 'この時間帯の予約（4件）' })
  const rows = within(dialog).getAllByRole('button', { name: /予約[a-d] 名前[a-d]/ })
  expect(rows).toHaveLength(4)
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  const controls = within(dialog).getAllByRole('button')
  controls[controls.length - 1].focus(); fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(controls[0])
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(controls[controls.length - 1])
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  for (const id of ['a', 'b', 'c', 'd']) {
    fireEvent.click(trigger)
    const current = await screen.findByRole('dialog')
    fireEvent.click(within(current).getByRole('button', { name: `10:00〜11:00 予約${id} 名前${id}` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
  expect(onOpen.mock.calls).toEqual([['a'], ['b'], ['c'], ['d']])
  expect(onSlot).not.toHaveBeenCalled()
})

it('closes an available-time list when edit access is revoked, and drops stale IDs after data switches', async () => {
  const onOpen = vi.fn(), onSlot = vi.fn(), days = [day], entries = [entry('a'), entry('b'), entry('c')]
  const free = [{ day, start: '10:00', end: '11:00' }, { day, start: '10:30', end: '11:30' }]
  const props = { days, entries, free, position, onOpen, onSlot }
  const { rerender } = render(<CalendarTimeEntries {...props} canWrite />)
  fireEvent.click(screen.getByRole('button', { name: `${day} 10:00からの空き2件を選ぶ` }))
  await screen.findByRole('dialog')
  rerender(<CalendarTimeEntries {...props} canWrite={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('button', { name: /空き2件を選ぶ/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /ほか1件/ }))
  await screen.findByRole('dialog')
  rerender(<CalendarTimeEntries {...props} entries={[entry('different')]} canWrite={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('button', { name: /予約a 名前a/ })).toBeNull()
  expect(onSlot).not.toHaveBeenCalled()
  expect(onOpen).not.toHaveBeenCalled()
})
