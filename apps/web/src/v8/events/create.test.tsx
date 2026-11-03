import { getPageAction } from '@/test-utils/page-action'
// @vitest-environment happy-dom
import React from 'react'
import { fireEvent, render, screen, cleanup, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createEvent = vi.hoisted(() => vi.fn())
const createSlots = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ eventsApi: { createEvent, createSlots }, ApiError: class extends Error {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: vi.fn(), cancelLeave: vi.fn() }) }))
vi.mock('./application-preview', () => ({ default: () => null }))
import EventsCreate from './create'

beforeEach(() => {
  createEvent.mockReset()
  createSlots.mockReset()
  push.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('イベント作成の入力確認', () => {
  it('保存前に不足する欄を知らせて名前へ移り、通信しない', () => {
    render(<EventsCreate />)
    fireEvent.click(getPageAction({ name: '下書きを保存' }))
    const name = screen.getByLabelText('イベント名')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(name)
    expect(screen.getByLabelText('定員').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual(['イベント名を入れてください', '定員は1以上の数で入れてください'])
    expect(screen.queryByText('直す所があります。赤い理由を確かめてください。')).toBeNull()
    expect(createEvent).not.toHaveBeenCalled()
    expect(name.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('名前を直すと名前の赤が消え、保存時は定員へ移る', () => {
    render(<EventsCreate />)
    fireEvent.click(getPageAction({ name: '下書きを保存' }))
    fireEvent.change(screen.getByLabelText('イベント名'), { target: { value: '体験会' } })
    expect(screen.getByLabelText('イベント名').getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(getPageAction({ name: '下書きを保存' }))
    expect(document.activeElement).toBe(screen.getByLabelText('定員'))
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('オンラインURLの誤りは、その欄だけで知らせる', () => {
    render(<EventsCreate />)
    fireEvent.change(screen.getByLabelText('イベント名'), { target: { value: '相談会' } })
    fireEvent.change(screen.getByLabelText('定員'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('オンラインの URL'), { target: { value: 'https://' } })
    fireEvent.click(screen.getByRole('button', { name: '公開する' }))
    expect(document.activeElement).toBe(screen.getByLabelText('オンラインの URL'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(createEvent).not.toHaveBeenCalled()
  })
})

it('初期日時は未来で、過去の日付を確認してから保存できる', async () => {
 vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-03T08:00:00Z'))
 try {
  createEvent.mockResolvedValue({id:'past-event',version:1,is_published:0})
  createSlots.mockImplementation(async (_account, eventId, slots) => ({items:[{...slots[0],id:'past-slot',event_id:eventId,version:1}]}))
  render(<EventsCreate />)
  expect(screen.getByLabelText('日付').getAttribute('title')).toContain('2026年11月4日')
  fireEvent.click(screen.getByLabelText('日付'))
  fireEvent.click(screen.getByRole('button',{name:'2026年11月2日（月）'}))
  expect(screen.getByText('開始日時が過去です。日時を確認してください。')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('イベント名'), { target: { value: '体験会' } })
  fireEvent.change(screen.getByLabelText('定員'), { target: { value: '20' } })
  fireEvent.click(getPageAction({ name: '下書きを保存' }))
  expect(createEvent).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('dialog', { name: '過去の日時で保存しますか？' })
  expect(within(confirmation).getByText(/開始日時が過去/)).toBeTruthy()
  fireEvent.click(within(confirmation).getByRole('button', { name: 'この日時で保存する' }))
  await waitFor(() => expect(push).toHaveBeenCalled())
  expect(createEvent).toHaveBeenCalledTimes(1)
  expect(createSlots.mock.calls[0][2][0].starts_at).toBe('2026-11-02T05:00:00.000Z')
 } finally { cleanup(); vi.useRealTimers() }
})
