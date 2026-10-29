// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OpsApplication } from '@/lib/api'

const state = vi.hoisted(() => ({
  get: vi.fn(), contact: vi.fn(), approve: vi.fn(), resendInvite: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=application-1') }))
vi.mock('./use-ops-read-only', () => ({ useOpsReadOnly: () => false }))
vi.mock('@/lib/api', () => ({ api: { ops: { applications: state } } }))

import OpsApplicationDetail from './application-detail'

const initial = {
  id: 'application-1', company_name: '申込会社', contact_name: '担当者',
  email: 'applicant@example.com', phone: '03-1234-5678', referral_source: 'SNS',
  status: 'pending', contact_note: null, contacted_at: null, approved_at: null,
  invite_sent_at: null, tenant_id: null, created_at: '2026-10-29T01:40:00.000Z',
} as OpsApplication

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('申込詳細の連絡から承認まで', () => {
  it('連絡内容を保存した後だけ承認確認を開き、確定すると招待結果を表示する', async () => {
    state.get.mockResolvedValue({ success: true, data: initial })
    state.contact.mockResolvedValue({ success: true, data: { ...initial, status: 'contacted', contact_note: '電話で内容を確認', contacted_at: '2026-10-29T02:30:00.000Z' } })
    state.approve.mockResolvedValue({ success: true, data: { mailSent: true, application: { ...initial, status: 'approved', contact_note: '電話で内容を確認', contacted_at: '2026-10-29T02:30:00.000Z', approved_at: '2026-10-29T02:31:00.000Z' } } })
    render(<OpsApplicationDetail />)
    const approve = await screen.findByRole('button', { name: '承認して招待メールを送る' })
    expect((approve as HTMLButtonElement).disabled).toBe(true)
    const save = screen.getByRole('button', { name: '連絡済みとして保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '担当者からの連絡メモ' }), { target: { value: '電話で内容を確認' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(state.contact).toHaveBeenCalledWith('application-1', '電話で内容を確認'))
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(approve)
    expect(screen.getByRole('dialog', { name: 'この申込を承認しますか？' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '承認して招待を送る' }))
    await waitFor(() => expect(state.approve).toHaveBeenCalledWith('application-1'))
    expect(await screen.findByText('承認し、招待メールを送りました')).not.toBeNull()
  })
})
