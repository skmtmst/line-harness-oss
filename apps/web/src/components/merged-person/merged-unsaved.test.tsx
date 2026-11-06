// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MergedProfileDialog from './merged-profile-dialog'
import MergedDeliveryDialog from './merged-delivery-dialog'
import { useDetailPanelUrl } from '@/components/shared/detail-panel'
import { useRef } from 'react'
import { requestUnsavedAction } from '@/lib/unsaved-action'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(cleanup)

it('プロフィールの採用値を選んでいる間はリンク移動を確かめる', () => {
  const candidates = [{ fieldKey: 'name', fieldLabel: '名前', options: [{ candidateId: 'c', sourceFriendId: 'f', sourceLabel: '本店', valuePreview: 'A', verified: true }] }]
  render(<><a href="/templates">テンプレート</a><MergedProfileDialog open candidates={candidates} draft={{ name: { optionIndex: '0', updateMode: 'fixed' } }} revision={1} busy={false} onChange={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()} /></>)
  fireEvent.click(screen.getByRole('link', { name: 'テンプレート' }))
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
})

it('親のパンくず操作は確認まで待ち、破棄後に一度だけ実行する', () => {
  const close = vi.fn(), leave = vi.fn()
  const candidates = [{ fieldKey: 'name', fieldLabel: '名前', options: [{ candidateId: 'c', sourceFriendId: 'f', sourceLabel: '本店', valuePreview: 'A', verified: true }] }]
  render(<MergedProfileDialog open candidates={candidates} draft={{ name: { optionIndex: '0', updateMode: 'fixed' } }} revision={1} busy={false} onChange={vi.fn()} onCancel={close} onSave={vi.fn()} />)
  act(() => requestUnsavedAction(leave))
  expect(leave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
  expect(close).toHaveBeenCalledTimes(1)
  expect(leave).toHaveBeenCalledTimes(1)
})

it('配信元の順番を変えたら戻る前に確かめる', () => {
  const priorities = [
    { purpose: 'broadcast' as const, friendId: 'a', lineAccountId: 'a', lineAccountName: '本店', priority: 1, isActive: true, reason: '' },
    { purpose: 'broadcast' as const, friendId: 'b', lineAccountId: 'b', lineAccountName: '支店', priority: 2, isActive: true, reason: '' },
  ]
  render(<MergedDeliveryDialog open priorities={priorities} revision={1} busy={false} onCancel={vi.fn()} onSave={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '支店を上へ' }))
  fireEvent.popState(window)
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
})

it('詳細のURLを戻しても親が編集窓を先に消さない', async () => {
  window.history.replaceState({}, '', '/friends?person=1')
  const candidates = [{ fieldKey: 'name', fieldLabel: '名前', options: [{ candidateId: 'c', sourceFriendId: 'f', sourceLabel: '本店', valuePreview: 'A', verified: true }] }]
  function Parent() {
    const editing = useRef(false)
    const [person] = useDetailPanelUrl('person', () => editing.current)
    return person ? <MergedProfileDialog open candidates={candidates} draft={{ name: { optionIndex: '0', updateMode: 'fixed' } }} revision={1} busy={false} onChange={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()} onDirtyChange={dirty => { editing.current = dirty }} /> : null
  }
  render(<Parent />)
  await waitFor(() => expect(screen.getByRole('dialog', { name: '統合プロフィールを編集' })).toBeTruthy())
  window.history.replaceState({}, '', '/friends')
  fireEvent.popState(window)
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
  expect(screen.getByRole('dialog', { name: '統合プロフィールを編集' })).toBeTruthy()
})
