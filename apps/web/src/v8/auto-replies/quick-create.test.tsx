// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const apiMock = vi.hoisted(() => ({ createDraft: vi.fn(), saveDraft: vi.fn(), conflicts: vi.fn(), publishDraft: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { autoReplies: apiMock }, describeSaveFailure: () => '保存失敗' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
import QuickCreate from './quick-create'
const created = vi.fn()
beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.clearAllMocks()
  apiMock.createDraft.mockResolvedValue({ success: true, data: { autoReplyId: 'draft-1', versionNumber: 1 } })
  apiMock.saveDraft.mockResolvedValue({ success: true, data: { autoReplyId: 'draft-1', versionNumber: 2 } })
  apiMock.conflicts.mockResolvedValue({ success: true, data: { conflicts: [{ autoReplyId: 'rule-1', name: '既存ルール' }] } })
  apiMock.publishDraft.mockResolvedValue({ success: true })
})
afterEach(cleanup)
async function fill() {
  render(<QuickCreate accountId="account-1" onClose={vi.fn()} onCreated={created} />)
  fireEvent.change(screen.getByLabelText('追加する言葉'), { target: { value: '営業時間' } })
  fireEvent.keyDown(screen.getByLabelText('追加する言葉'), { key: 'Enter' })
  fireEvent.change(screen.getByLabelText('返す文'), { target: { value: '10時からです' } })
  await save()
  expect(apiMock.publishDraft).not.toHaveBeenCalled()
}
async function save() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: '有効にして保存' })) }) }
it('確認後に返信を直したら最新の下書きを保存し、重なりを再確認する', async () => {
  await fill()
  fireEvent.change(screen.getByLabelText('返す文'), { target: { value: '11時からです' } })
  await save()
  expect(apiMock.saveDraft).toHaveBeenCalledWith('draft-1', expect.objectContaining({ responseContent: '11時からです', expectedVersion: 1 }))
  expect(apiMock.conflicts).toHaveBeenCalledTimes(2)
  expect(apiMock.publishDraft).not.toHaveBeenCalled()
  await save()
  expect(apiMock.publishDraft).toHaveBeenCalledWith('draft-1', { acknowledgedConflictIds: ['rule-1'] }, expect.any(String))
  expect(created).toHaveBeenCalledTimes(1)
})
it('確認後に言葉を変えて重なりが変わると、再度確認してから公開する', async () => {
  await fill()
  fireEvent.change(screen.getByLabelText('追加する言葉'), { target: { value: '定休日' } })
  fireEvent.keyDown(screen.getByLabelText('追加する言葉'), { key: 'Enter' })
  apiMock.conflicts.mockResolvedValue({ success: true, data: { conflicts: [{ autoReplyId: 'rule-2', name: '別ルール' }] } })
  await save()
  expect(screen.getByText(/別ルール/)).toBeTruthy()
  expect(apiMock.publishDraft).not.toHaveBeenCalled()
  await save()
  expect(apiMock.publishDraft).toHaveBeenCalledWith('draft-1', { acknowledgedConflictIds: ['rule-2'] }, expect.any(String))
})
it('重なりの通信が失敗したら公開を止め、再試行でも確認する', async () => {
  apiMock.conflicts.mockRejectedValueOnce(new Error('確認できません'))
  render(<QuickCreate accountId="account-1" onClose={vi.fn()} onCreated={created} />)
  fireEvent.change(screen.getByLabelText('追加する言葉'), { target: { value: '営業時間' } })
  fireEvent.keyDown(screen.getByLabelText('追加する言葉'), { key: 'Enter' })
  fireEvent.change(screen.getByLabelText('返す文'), { target: { value: '10時からです' } })
  await save()
  expect(apiMock.publishDraft).not.toHaveBeenCalled()
  await save()
  expect(apiMock.conflicts).toHaveBeenCalledTimes(2)
  expect(apiMock.publishDraft).not.toHaveBeenCalled()
})

it('書きかけでアカウントを切り替えると確認まで止まる', async () => {
  await fill()
  const change = vi.fn()
  const { requestUnsavedAction } = await import('@/lib/unsaved-action')
  act(() => requestUnsavedAction(change))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect(change).not.toHaveBeenCalled()
})
it('日本語の変換を確定する Enter では言葉を札にしない（変換が終わった Enter で札にする）', () => {
  render(<QuickCreate accountId="account-1" onClose={vi.fn()} onCreated={created} />)
  const input = screen.getByLabelText('追加する言葉') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'えいぎょう' } })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(screen.queryByRole('button', { name: '「えいぎょう」を外す' })).toBeNull()
  expect(input.value).toBe('えいぎょう')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('button', { name: '「えいぎょう」を外す' })).toBeTruthy()
})
