// @vitest-environment happy-dom
/*
 * 担当の編集の「指名料」（要件 B9）。
 * - オーナー・管理者が変えたときだけ nominationFee を保存に載せる
 * - スタッフには額を読むだけで出し、保存にも載せない（口が管理者だけなので、載せると担当ごと保存できない）
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const who = vi.hoisted(() => ({ role: 'admin' as string | null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => who.role }))
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: { staff: { list: async () => ({ success: true, data: [] }) } } }))
const { StaffEditModal } = await import('./staff-edit-dialog')

const person = { id: 'bs-1', name: 'staff', display_name: '担当者', is_active: 1, is_designation_optional: 0, nomination_fee: 300 }

beforeEach(() => { who.role = 'admin' })
afterEach(cleanup)

it('管理者が指名料を変えたら、その額を保存に載せる', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<StaffEditModal staff={person} onSave={onSave} onClose={() => {}} />)
  await act(async () => {})
  const fee = screen.getByRole('spinbutton', { name: '指名料（円）' }) as HTMLInputElement
  expect(fee.value).toBe('300')
  fireEvent.change(fee, { target: { value: '500' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'bs-1', nominationFee: 500 }))
})

it('変えていなければ指名料は送らない。0より小さい・小数は止める', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<StaffEditModal staff={person} onSave={onSave} onClose={() => {}} />)
  await act(async () => {})
  fireEvent.change(screen.getByDisplayValue('担当者'), { target: { value: '担当者A' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('nominationFee')
  fireEvent.change(screen.getByRole('spinbutton', { name: '指名料（円）' }), { target: { value: '-1' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  expect(screen.getByText('指名料は0以上の整数で入力してください')).toBeTruthy()
  expect(onSave).toHaveBeenCalledTimes(1)
})

it('スタッフには指名料を読むだけで出し、保存にも載せない', async () => {
  who.role = 'staff'
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<StaffEditModal staff={person} onSave={onSave} onClose={() => {}} />)
  await act(async () => {})
  const fee = screen.getByRole('textbox', { name: /指名料/ }) as HTMLInputElement
  expect(fee.readOnly).toBe(true)
  expect(fee.value).toBe('300')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  expect(onSave.mock.calls[0]![0]).not.toHaveProperty('nominationFee')
})
