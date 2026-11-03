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

it('保存口のない吹き出しの確認が先でも、破棄される配信の変更を伝える', async () => {
  const parentDiscard = vi.fn(), bubbleDiscard = vi.fn(), leave = vi.fn()
  function FirstBubble() {
    const guard = useUnsavedGuard({ dirty: true, onDiscard: bubbleDiscard, subject: '吹き出しの変更' })
    return <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="吹き出しの変更" onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
  }
  function OtherParent() {
    useUnsavedGuard({ dirty: true, onDiscard: parentDiscard, subject: '配信の変更' })
    return null
  }
  render(<><FirstBubble /><OtherParent /></>)
  await act(async () => { requestUnsavedAction(leave) })
  const dialog = screen.getByRole('dialog', { name: '保存していない変更があります' })
  expect(dialog.textContent).toContain('吹き出しの変更')
  expect(dialog.textContent).toContain('配信の変更')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'すべて保存せずに移る' })) })
  expect(parentDiscard).toHaveBeenCalledTimes(1); expect(bubbleDiscard).toHaveBeenCalledTimes(1); expect(leave).toHaveBeenCalledTimes(1)
})

it('リンクの移動でも別の未保存内容を知らせる', async () => {
  const link = document.createElement('a'); link.href = '/events'; link.textContent = '移動先'; document.body.append(link)
  try {
    render(<><Parent save={async () => true} discard={() => {}} /><Bubble discard={() => {}} /></>)
    await act(async () => { fireEvent.click(link) })
    expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('吹き出しの作成内容')
  } finally { link.remove() }
})

it('確認を開いてから別の入力が増えたら保存前に再確認する', async () => {
  const save = vi.fn(async () => true)
  const view = render(<><Parent save={save} discard={() => {}} /></>)
  await act(async () => { requestUnsavedAction(() => {}) })
  view.rerender(<><Parent save={save} discard={() => {}} /><Bubble discard={() => {}} /></>)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存して移る' })) })
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('吹き出しの作成内容')
})

it('保存中に別の入力が増えたら保存成功後の移動を実行しない', async () => {
  let finish!: (value: boolean) => void
  const leave = vi.fn()
  function SavingParent() {
    const guard = useUnsavedGuard({ dirty: true })
    return <UnsavedLeaveDialog open={guard.leaveTarget !== null} onSave={() => new Promise(resolve => { finish = resolve })} onSavedLeave={leave} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
  }
  const view = render(<><SavingParent /></>)
  await act(async () => { requestUnsavedAction(() => {}) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存して移る' })) })
  view.rerender(<><SavingParent /><Bubble discard={() => {}} /></>)
  await act(async () => { finish(true) })
  expect(leave).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('吹き出しの作成内容')
})

it('破棄の確認後に別の入力が増えたら、先に確認を更新する', async () => {
  const leave = vi.fn(), discarded = vi.fn()
  function First() {
    const guard = useUnsavedGuard({ dirty: true, subject: '配信の変更' })
    return <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="配信の変更" onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
  }
  const view = render(<><First /></>)
  await act(async () => { requestUnsavedAction(leave) })
  view.rerender(<><First /><Bubble discard={discarded} /></>)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' })) })
  expect(leave).not.toHaveBeenCalled(); expect(discarded).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('吹き出しの作成内容')
})

it('子の局所キャンセルでは親の入力を捨てない', async () => {
  const parentDiscard = vi.fn(), childDiscard = vi.fn(), closeChild = vi.fn()
  function ParentInput() {
    useUnsavedGuard({ dirty: true, subject: '親の入力', onDiscard: parentDiscard })
    return null
  }
  function ChildInput() {
    const guard = useUnsavedGuard({ dirty: true, subject: '子の入力', onDiscard: childDiscard })
    return <><button onClick={() => guard.guarded(closeChild)}>子だけ閉じる</button><UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="子の入力" onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} /></>
  }
  render(<><ParentInput /><ChildInput /></>)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '子だけ閉じる' })) })
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('子の入力')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' })) })
  expect(childDiscard).toHaveBeenCalledTimes(1)
  expect(closeChild).toHaveBeenCalledTimes(1)
  expect(parentDiscard).not.toHaveBeenCalled()
})
