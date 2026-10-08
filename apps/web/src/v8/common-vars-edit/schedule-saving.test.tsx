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
