// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ reason: '', endsAt: '2026-10-12T12:30' }))
const apply = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=ev-1') }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('./change-review-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./change-review-model')>()
  return { ...actual, useChangeReview: () => ({
    selectedAccountId: 'account-a', status: 'ready',
    event: { id: 'ev-1', name: '教室', is_published: 1, venue_name: null },
    slotList: [{ id: 'slot-1', starts_at: '2026-10-12T01:00:00Z', ends_at: '2026-10-12T03:00:00Z', capacity: 12, active_count: 10, is_active: 1 }],
    edits: { 'slot-1': { startsAt: '2026-10-12T10:30', endsAt: state.endsAt, capacity: '12', isActive: true } },
    setEdits: vi.fn(), venueName: '', setVenueName: vi.fn(), venueUrl: '', setVenueUrl: vi.fn(),
    preview: { blocked: false, total_confirmed: 10, total_waiting: 2, impacts: [] },
    previewBusy: false, previewError: '', reason: state.reason, setReason: vi.fn(),
    applyBusy: false, applyError: null, applied: null, isPublished: true,
    refresh: vi.fn(), touchEdits: vi.fn(), runApply: apply,
  }) }
})
import ChangeReview from './change-review'

beforeEach(() => {
  state.reason = ''
  state.endsAt = '2026-10-12T12:30'
  apply.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('イベント変更の入力確認', () => {
  it('公開中の理由が空なら、確認窓を開かず理由へ移る', () => {
    render(<ChangeReview />)
    fireEvent.click(screen.getByRole('button', { name: '変えてお知らせする' }))
    const reason = screen.getByLabelText('変える理由')
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(reason)
    expect(reason.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual(['変える理由を入れてください'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })

  it('終了が開始より前なら、その日時欄を知らせて変更を止める', () => {
    state.reason = '会場の都合'
    state.endsAt = '2026-10-12T09:00'
    render(<ChangeReview />)
    expect(screen.getByLabelText('終了日時').getAttribute('data-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: '変えてお知らせする' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('終了日時は開始日時より後にしてください')
    expect(apply).not.toHaveBeenCalled()
  })
})
