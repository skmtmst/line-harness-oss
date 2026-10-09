// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const add = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('id=var-1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    commonVars: { ...actual.api.commonVars,
      detail: async () => ({ success: true, data: { id: 'var-1', name: '営業時間', key: 'hours', type: 'text', value: '10時', memo: '', status: 'active', validFrom: null, validUntil: null, version: 1, usages: [], history: [], usageCount: 0, usagePage: { total: 0, shown: 0 } } }),
      schedules: async () => ({ success: true, data: [] }), addSchedule: add,
    },
  } }
})
import Editor from './edit'
afterEach(cleanup)
it('共通情報の予定登録中は×・キャンセル・Escを止める', async () => {
  let resolve!: (value: unknown) => void
  add.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を足す' }))
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))
  expect(add).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '閉じる' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => resolve({ success: true, data: {} }))
})

it('B-139：名前を消して保存すると、口を呼ばず名前の欄が赤くなり、真下に理由が出て、そこへ移る', async () => {
  const { api } = await import('@/lib/api')
  const update = vi.spyOn(api.commonVars, 'update')
  render(<Editor />)
  const name = await screen.findByLabelText('名前') as HTMLInputElement
  fireEvent.change(name, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(update).not.toHaveBeenCalled()
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('cv-name-error')?.textContent).toBe('共通情報名を入力してください')
  expect(document.activeElement).toBe(name)
})

it('B-139：予定の開始日が空なら登録せず、開始日の欄に理由を出す', async () => {
  add.mockReset()
  render(<Editor />)
  fireEvent.click(await screen.findByRole('button', { name: '予定を足す' }))
  // 開始日を空にする（×で消す）
  fireEvent.click(screen.getByRole('button', { name: '日付を消す' }))
  fireEvent.click(screen.getByRole('button', { name: '登録する' }))
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(add).not.toHaveBeenCalled()
  expect(screen.getByText('開始日を入れてください')).toBeTruthy()
  expect(document.activeElement).toBe(document.getElementById('sc-date'))
})
