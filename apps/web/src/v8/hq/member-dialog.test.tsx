// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MemberDialog from './member-dialog'

afterEach(cleanup)

it('統括の招待では全アカウントだけを付与する', () => {
  const submit = vi.fn()
  render(<MemberDialog open session={1} member={null} onSubmit={submit} onCancel={() => {}} />)
  expect(screen.queryByText('最初に表示するアカウント')).toBeNull()
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '担当者' } })
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'staff@example.com' } })
  expect(screen.queryByRole('radio', { name: '指定したアカウントだけ' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ scopedLineAccountIds: [], accountScope: 'all' }))
})


it('不正なメールの貼り付けはその場で知らせ、招待を送らない', () => {
  const submit = vi.fn()
  render(<MemberDialog open session={1} member={null} onSubmit={submit} onCancel={() => {}} />)
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '担当者' } })
  fireEvent.paste(screen.getByLabelText('メールアドレス'), { clipboardData: { getData: () => 'bad@' } })
  expect(screen.getByRole('alert').textContent).toContain('正しいメール')
  fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  expect(submit).not.toHaveBeenCalled()
})
