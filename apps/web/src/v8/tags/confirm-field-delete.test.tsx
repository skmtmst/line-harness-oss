// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { PageExplanationProvider } from '@/components/shared/page-explanation'
import FieldsTab from './fields-tab'
import { ApiError } from '@/lib/api'
const net = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    friendFields: { ...actual.api.friendFields, list: net.list, delete: net.remove, stats: async () => ({ success: true, data: null }) },
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
  } }
})
const item = { id: 'field', accountId: 'account', name: '好きな色', fieldKey: 'color', type: 'text', isInherited: false, usageCount: 0, formUsageCount: 0, displayTargets: [] }
beforeEach(() => { vi.clearAllMocks(); verifiedStaffRole('owner'); net.list.mockResolvedValue({ success: true, data: [item] }); net.remove.mockResolvedValue({ success: true, data: null }) })
afterEach(() => { cleanup(); verifiedStaffRole(null) })
function Host({ canEdit = true }: { canEdit?: boolean }) {
  return <PageExplanationProvider pageKey="tags:fields"><FieldsTab accountId="account" canEdit={canEdit} /></PageExplanationProvider>
}
async function openDelete() {
  const view = render(<Host />)
  fireEvent.click(await screen.findByRole('button', { name: '項目「好きな色」の操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '削除する' }))
  return { view, dialog: await screen.findByRole('alertdialog') }
}
it('409は窓内の具体理由と使用状況の確認を出し、再送せず、閉じた後に一覧を読み直す', async () => {
  net.remove.mockRejectedValueOnce(new ApiError(409, '使われているため削除できません'))
  const { dialog } = await openDelete()
  fireEvent.click(within(dialog).getByRole('button', { name: '削除する' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('使われているため削除できません この窓を閉じ、最新の使用状況を確かめてください。')
  const retry = within(dialog).getByRole('button', { name: 'もう一度' })
  expect(retry.hasAttribute('disabled')).toBe(true)
  fireEvent.click(retry); expect(net.remove).toHaveBeenCalledTimes(1)
  fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
  await waitFor(() => expect(net.list).toHaveBeenCalledTimes(2))
  expect(screen.getByText('好きな色')).toBeTruthy()
})
it('確認中に閲覧のみへ変わったら、灰色と共通の理由で止まりAPIへ送らない', async () => {
  const { view, dialog } = await openDelete()
  act(() => { verifiedStaffRole('viewer'); view.rerender(<Host canEdit={false} />) })
  const button = within(dialog).getByRole('button', { name: '削除する' })
  expect(button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')).toBe(true)
  fireEvent.focus(button)
  expect(await screen.findByRole('tooltip')).toBeTruthy()
  fireEvent.click(button)
  expect(net.remove).not.toHaveBeenCalled()
})
it('HTTPが受け付けてもsuccess:falseなら削除完了にせず窓を残す', async () => {
  net.remove.mockResolvedValueOnce({ success: false, error: 'この項目は削除できません。' })
  const { dialog } = await openDelete()
  fireEvent.click(within(dialog).getByRole('button', { name: '削除する' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('この項目は削除できません。')
  expect(screen.getByRole('alertdialog')).toBe(dialog)
  expect(net.list).toHaveBeenCalledTimes(1)
})
it('削除を受け付けた時だけ窓を閉じ、一覧を読み直す', async () => {
  const { dialog } = await openDelete()
  await act(async () => { const button = within(dialog).getByRole('button', { name: '削除する' }); fireEvent.click(button); fireEvent.click(button) })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(net.remove).toHaveBeenCalledExactlyOnceWith('field', 'account')
  await waitFor(() => expect(net.list).toHaveBeenCalledTimes(2))
})
