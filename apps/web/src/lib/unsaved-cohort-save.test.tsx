// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useUnsavedGuard } from './use-unsaved-guard'
import { UnsavedLeaveDialog } from './unsaved-leave-dialog'
import { requestUnsavedAction } from './unsaved-action'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
afterEach(cleanup)

function Parent({ save, discard, dirty = true }: { save: () => Promise<boolean>; discard: () => void; dirty?: boolean }) {
  const guard = useUnsavedGuard({ dirty, onDiscard: discard })
  return <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="配信の変更" onSave={save}
    onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
}
function Bubble({ discard, dirty = true }: { discard: () => void; dirty?: boolean }) {
  useUnsavedGuard({ dirty, onDiscard: discard, subject: '吹き出しの作成内容' })
  return <p>作成中の吹き出し</p>
}

it('配信と吹き出しの両方が未保存なら、片方だけの保存で何が消えるか示して選べる', async () => {
  const save = vi.fn(async () => true), parentDiscard = vi.fn(), bubbleDiscard = vi.fn()
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  try {
    render(<><Parent save={save} discard={parentDiscard} /><Bubble discard={bubbleDiscard} /></>)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(screen.getByText(/吹き出しの作成内容.*保存されず消えます/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    expect(bubbleDiscard).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '配信の変更だけ保存して移る' })) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(bubbleDiscard).toHaveBeenCalledTimes(1)
    expect(back).toHaveBeenCalledTimes(1)
  } finally { go.mockRestore(); back.mockRestore() }
})

it('保存中に別の入力が増えた場合は、移動せずに確認し直す', async () => {
  let finish!: (value: boolean) => void
  const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  try {
    const view = render(<><Parent save={save} discard={() => {}} /></>)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存して移る' })) })
    view.rerender(<><Parent save={save} discard={() => {}} /><Bubble discard={() => {}} /></>)
    await act(async () => { finish(true) })
    expect(back).not.toHaveBeenCalled()
  } finally { go.mockRestore(); back.mockRestore() }
})

it('同じ画面内の移動として扱う入力は離脱の対象にしない', async () => {
  const retained = vi.fn()
  function LocalInput() {
    useUnsavedGuard({ dirty: true, subject: '画面内の入力', samePage: () => true, onDiscard: retained })
    return null
  }
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  try {
    render(<><Parent save={async () => true} discard={() => {}} /><LocalInput /></>)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(screen.queryByText(/画面内の入力.*保存されず消えます/)).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存して移る' })) })
    expect(retained).not.toHaveBeenCalled()
    expect(back).toHaveBeenCalledTimes(1)
  } finally { go.mockRestore(); back.mockRestore() }
})

it('吹き出しも編集中に親の保存が失敗したら、確認の窓に失敗を示して留まる', async () => {
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  try {
    render(<><Parent save={async () => false} discard={() => {}} /><Bubble discard={() => {}} /></>)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '配信の変更だけ保存して移る' })) })
    expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('保存できませんでした')
    expect(back).not.toHaveBeenCalled()
  } finally { go.mockRestore(); back.mockRestore() }
})

it('保存失敗後に破棄して次の確認を開いても古い失敗を残さない', async () => {
  const parentDiscard = vi.fn(), bubbleDiscard = vi.fn()
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  try {
    const view = render(<><Parent save={async () => false} discard={parentDiscard} /><Bubble discard={bubbleDiscard} /></>)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '配信の変更だけ保存して移る' })) })
    expect(parentDiscard).not.toHaveBeenCalled(); expect(bubbleDiscard).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'すべて保存せずに移る' })) })
    view.rerender(<><Parent dirty={false} save={async () => false} discard={parentDiscard} /><Bubble dirty={false} discard={bubbleDiscard} /></>)
    view.rerender(<><Parent save={async () => false} discard={parentDiscard} /><Bubble discard={bubbleDiscard} /></>)
    await act(async () => { requestUnsavedAction(() => {}) })
    expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).not.toContain('保存できませんでした')
  } finally { go.mockRestore(); back.mockRestore() }
})
