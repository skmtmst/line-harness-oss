// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const update = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, update } } }
})
vi.mock('@/components/shared/toast', () => ({ notifyToast: toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
import TagsTab from './tags-tab'
import { FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
afterEach(cleanup)
it('星を変えたあと最新の更新番号で元に戻し、再度の取り消しも更新する', async () => {
  update.mockReset(); toast.mockReset()
  update.mockImplementation(async (_id, data) => ({ success: true, data: { version: data.expectedVersion + 1 } }))
  const tag = { ...FRIEND_ATTRIBUTES_QA_TAGS[0], version: 7, isStarred: false }
  render(<TagsTab accountId="account-1" fixture={{ items: [tag], groups: [] }} canEdit narrow={false} csvOpen={false} onCsvClose={() => {}} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '友だち一覧に表示する' })) })
  await act(async () => { toast.mock.calls.at(-1)![1].onAction() })
  expect(update).toHaveBeenLastCalledWith(tag.id, expect.objectContaining({ isStarred: false, expectedVersion: 8 }))
  await act(async () => { toast.mock.calls.at(-1)![1].onAction() })
  expect(update).toHaveBeenLastCalledWith(tag.id, expect.objectContaining({ isStarred: true, expectedVersion: 9 }))
})
