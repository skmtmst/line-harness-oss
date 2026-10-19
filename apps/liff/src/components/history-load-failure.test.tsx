// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ bookingWaitlists: vi.fn(), myEventBookings: vi.fn(), makeupCredits: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: net }))
vi.mock('./makeup-picker.js', () => ({ default: () => null }))
vi.mock('./absence-sheet.js', () => ({ default: () => null, mdHm: () => '' }))
vi.mock('./waitlist-offer-sheet.js', () => ({ default: () => null }))
import LessonHistorySection from './lesson-history-section.js'
import WaitlistSection from './waitlist-section.js'
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('キャンセル待ちの取得失敗は0件に置き換えず、再読込で回復する', async () => {
  net.bookingWaitlists.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ waitlist: [] })
  render(<WaitlistSection />)
  expect(await screen.findByText('読み込めませんでした')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await vi.waitFor(() => expect(screen.queryByText('読み込めませんでした')).toBeNull())
  expect(net.bookingWaitlists).toHaveBeenCalledTimes(2)
})
it('教室の履歴の一部が取得できなければ知らせ、再読込で回復する', async () => {
  net.myEventBookings.mockResolvedValue({ items: [] })
  net.makeupCredits.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ credits: [] })
  render(<LessonHistorySection />)
  expect(await screen.findByText('読み込めませんでした')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await vi.waitFor(() => expect(screen.queryByText('読み込めませんでした')).toBeNull())
  expect(net.makeupCredits).toHaveBeenCalledTimes(2)
})
