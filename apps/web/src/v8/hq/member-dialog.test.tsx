// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LineAccount } from '@line-crm/shared'
import MemberDialog from './member-dialog'

const accounts = [{ id: 'a', name: '渋谷' }, { id: 'b', name: '銀座' }] as LineAccount[]
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: accounts }) },
    lineAccountFolders: { list: async () => ({ success: true, data: { folders: [] } }) },
  } }
})
afterEach(cleanup)

it('統括の招待では全アカウントだけを付与する', () => {
  const submit = vi.fn()
  render(<MemberDialog open session={1} member={null} accounts={accounts} onSubmit={submit} onCancel={() => {}} />)
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '担当者' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'staff@example.com' } })
  expect(screen.queryByRole('radio', { name: '指定したアカウントだけ' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ scopedLineAccountIds: [], assignedLineAccountId: 'a', accountScope: 'all' }))
})


it('不正なメールの貼り付けはその場で知らせ、招待を送らない', () => {
  const submit = vi.fn()
  render(<MemberDialog open session={1} member={null} accounts={accounts} onSubmit={submit} onCancel={() => {}} />)
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '担当者' } })
  fireEvent.paste(screen.getByLabelText('メールアドレス'), { clipboardData: { getData: () => 'bad@' } })
  expect(screen.getByRole('alert').textContent).toContain('正しいメール')
  fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  expect(submit).not.toHaveBeenCalled()
})
