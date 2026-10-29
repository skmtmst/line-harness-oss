// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { EmptyBookings } from './empty-bookings'
import { PERMISSION_LOCK_REASON } from '@/components/shared/permission-lock'

afterEach(cleanup)
it.each(['salon', 'consult'] as const)('%sの空日の主操作は1つで、権限がなければ表示も直接のhandlerも拒否する', style => {
  for (const role of ['admin', 'viewer', null]) {
    const canWrite = role === 'admin', onBook = vi.fn()
    const result = EmptyBookings({ style, today: { rows: [] }, canWrite, role, onBook })!
    const action = result.props.action as ReactElement<{ onClick: () => void; disabled: boolean; lockedReason?: string }>
    expect(action.props.disabled).toBe(role === null)
    expect(action.props.lockedReason).toBe(role === 'viewer' ? PERMISSION_LOCK_REASON.viewer : undefined)
    action.props.onClick()
    expect(onBook).toHaveBeenCalledTimes(canWrite ? 1 : 0)
    onBook.mockClear()
    const view = render(result)
    expect(screen.getAllByText('今日の予約はありません')).toHaveLength(1)
    const button = screen.getByRole('button', { name: '予約を入れる' })
    if (role === 'viewer') expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(onBook).toHaveBeenCalledTimes(canWrite ? 1 : 0)
    view.unmount()
  }
})
it.each(['restaurant', 'lesson'] as const)('%sにはサロン・面談の案内を出さない', style => {
  expect(EmptyBookings({ style, today: { rows: [] }, canWrite: true, role: 'admin', onBook: vi.fn() })).toBeNull()
})
