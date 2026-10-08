// @vitest-environment happy-dom
import React from 'react'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createEvent = vi.hoisted(() => vi.fn())
const createSlots = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ eventsApi: { createEvent, createSlots }, ApiError: class extends Error {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
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
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
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
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    fireEvent.change(screen.getByLabelText('イベント名'), { target: { value: '体験会' } })
    expect(screen.getByLabelText('イベント名').getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
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
