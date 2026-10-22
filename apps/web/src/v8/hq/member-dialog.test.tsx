// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

it('担当範囲は窓で仮選択し、取消では反映せず確定してから招待に使う', async () => {
  const submit = vi.fn()
  render(<MemberDialog open session={1} member={null} accounts={accounts} onSubmit={submit} onCancel={() => {}} />)
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '担当者' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'staff@example.com' } })
  fireEvent.click(screen.getByRole('radio', { name: '全アカウント' }))
  fireEvent.click(screen.getByRole('radio', { name: '指定したアカウントだけ' }))
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '担当アカウント：選ぶ' }))
  const picker = await screen.findByRole('dialog', { name: '担当アカウントを選ぶ' })
  const candidate = within(picker).getByRole('checkbox', { name: /銀座/ })
  fireEvent.click(candidate)
  fireEvent.click(within(picker).getByRole('button', { name: 'キャンセル' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '担当アカウントを選ぶ' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '担当アカウント：選ぶ' }))
  const reopened = await screen.findByRole('dialog', { name: '担当アカウントを選ぶ' })
  expect((within(reopened).getByRole('checkbox', { name: /銀座/ }) as HTMLInputElement).checked).toBe(false)
  fireEvent.click(within(reopened).getByRole('checkbox', { name: /銀座/ }))
  fireEvent.click(within(reopened).getByRole('button', { name: '選ぶ（1件）' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '担当アカウントを選ぶ' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ scopedLineAccountIds: ['b'], assignedLineAccountId: 'a', accountScope: 'accounts' }))
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
