// @vitest-environment happy-dom
/*
 * 詳細条件の「条件を保存する」は、ブラウザ1台だけの保存ではなく API へ保存する。
 * 保存した条件は別の端末・別の担当者の友だち一覧からも呼び出せる。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ create: vi.fn(async () => ({ success: true as const, data: { id: 'view-1' } })) }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: { ...actual.api.friends, list: () => Promise.resolve({ success: true as const, data: { items: [], total: 0 } }) },
      friendSavedViews: {
        ...actual.api.friendSavedViews,
        list: () => Promise.resolve({ success: true as const, data: [] }),
        create: net.create,
      },
    },
  }
})

import AdvancedSearchDialog from './advanced-search-dialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('条件を保存すると今のアカウントの保存の口へ送り、ブラウザには書かない', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  render(<AdvancedSearchDialog open accountId="acc" tags={[]} fieldNames={[]} marks={[]} scenarios={[]} onClose={() => {}} onApply={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: '条件を保存する' }))
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
  const nested = screen.getAllByRole('dialog').at(-1)!
  fireEvent.change(within(nested).getByPlaceholderText('例：VIPかつ未契約'), { target: { value: 'VIPかつ未契約' } })
  await act(async () => { fireEvent.click(within(nested).getByRole('button', { name: '保存する' })) })
  expect(net.create).toHaveBeenCalledWith('acc', expect.objectContaining({ name: 'VIPかつ未契約', isShared: false, conditions: expect.any(Object) }))
  expect(await screen.findByText('条件を保存しました')).toBeTruthy()
  expect(setItem.mock.calls.some(([key]) => String(key).startsWith('friends.savedSearch'))).toBe(false)
})
