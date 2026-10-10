// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { list, updateHierarchy } = vi.hoisted(() => ({ list: vi.fn(), updateHierarchy: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { lineAccounts: { list, updateHierarchy } } }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: vi.fn(), cancelLeave: vi.fn() }) }))
import AccountOrdering from './account-ordering'

const accounts = [
  { id: 'parent', name: '本店', parentLineAccountId: null },
  { id: 'child', name: '支店', parentLineAccountId: 'parent' },
  { id: 'free', name: 'イベント', parentLineAccountId: null },
]
beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  list.mockReset().mockResolvedValue({ success: true, data: accounts })
  updateHierarchy.mockReset().mockResolvedValue({ success: true, data: {} })
})
afterEach(cleanup)
const moveFree = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'イベントの移動先を選ぶ' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'イベントの移動先を選ぶ' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /「本店」の子にする/ }))
}

it('ドラッグを使わなくても未設定から子へ移し、変更した親子だけ保存して閉じる', async () => {
  const onSaved = vi.fn()
  render(<AccountOrdering onClose={vi.fn()} onSaved={onSaved} />)
  await moveFree()
  fireEvent.click(screen.getByRole('button', { name: '構成を保存する' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(updateHierarchy).toHaveBeenCalledWith([{ id: 'free', parentLineAccountId: 'parent' }])
})

it('親を自身の子の下へ移す循環はメニューからも実行できない', async () => {
  render(<AccountOrdering onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '本店の移動先を選ぶ' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '本店の移動先を選ぶ' }))
  expect((screen.getByRole('menuitem', { name: /「支店」の子にする/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(updateHierarchy).not.toHaveBeenCalled()
})

it('変更中の Escape では確認を開き、編集を続けると変更を保持する', async () => {
  const onClose = vi.fn()
  render(<AccountOrdering onClose={onClose} />)
  await moveFree()
  await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect((screen.getByRole('button', { name: '構成を保存する' }) as HTMLButtonElement).disabled).toBe(false)
  expect(updateHierarchy).not.toHaveBeenCalled()
})
