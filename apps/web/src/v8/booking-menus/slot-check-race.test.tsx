// @vitest-environment happy-dom
/*
 * 監査 WEB054：空きを確かめている途中で条件を変えたら、古い条件の結果を出さない。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookingMenu } from '@/lib/api'

const net = vi.hoisted(() => ({ resolve: null as null | ((v: unknown) => void) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    bookingApi: {
      ...actual.bookingApi,
      listStaff: async () => ({ staff: [] }),
      checkAvailability: () => new Promise((resolve) => { net.resolve = resolve }),
    },
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

vi.mock('@/components/shared/date-field', () => ({
  default: ({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <input aria-label={rest['aria-label']} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))
vi.mock('@/components/shared/date-time-field', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/date-time-field')>()
  return {
    ...actual,
    TimeField: ({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; 'aria-label'?: string }) => (
      <input aria-label={rest['aria-label']} value={value} onChange={(event) => onChange(event.target.value)} />
    ),
  }
})

import { SlotCheckV8 } from './tabs/hours-tab'

afterEach(cleanup)

const menus = [{ id: 'm1', name: 'カット', is_active: 1 }] as unknown as BookingMenu[]

describe('空きを確かめる（WEB054）', () => {
  it('確かめている途中で時刻を変えたら、古い結果を出さない', async () => {
    render(<SlotCheckV8 accountId="a" menus={menus} />)
    const date = screen.getByLabelText('確かめる日付') as HTMLInputElement
    const time = screen.getByLabelText('確かめる開始時刻') as HTMLInputElement
    fireEvent.change(date, { target: { value: '2026-10-20' } })
    fireEvent.change(time, { target: { value: '10:00' } })
    await act(async () => { screen.getByRole('button', { name: '確かめる' }).click() })
    expect(net.resolve).not.toBeNull()
    fireEvent.change(time, { target: { value: '11:00' } })
    await act(async () => { net.resolve?.({ bookable: true, per_staff: [] }) })
    expect(screen.queryByText(/空いています/)).toBeNull()
  })
})
