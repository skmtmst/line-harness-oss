// @vitest-environment happy-dom
import React, { type ComponentProps, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InlineEdit from './inline-edit'

const reason = '閲覧のみのため、この名前は変えられません。'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const button = () => screen.getByRole('button', { name: 'シナリオ名を変更する' }) as HTMLButtonElement
const input = () => screen.getByRole('textbox', { name: 'シナリオ名' }) as HTMLInputElement
const props = { value: '元の名前', label: 'シナリオ名' }
// 試験だけでReactがDOMへ保持する実handlerを読み、再描画前の操作を呼ぶ。
function retained<T extends HTMLElement>(element: T): ComponentProps<'input'> {
  const key = Object.keys(element).find(key => key.startsWith('__reactProps$'))
  expect(key).toBeTypeOf('string')
  return (element as unknown as Record<string, ComponentProps<'input'>>)[key!]
}
const enter = () => new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }) as unknown as ReactKeyboardEvent<HTMLInputElement>

it('未指定と許可callbackの通常ボタン/編集中DOM・Tabは同じで、明示保存を1回行う', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const { container, rerender } = render(<InlineEdit {...props} onSave={save} />)
  const before = container.innerHTML
  rerender(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  expect(container.innerHTML).toBe(before)
  expect(button().tabIndex).toBe(0)
  fireEvent.click(button())
  fireEvent.change(input(), { target: { value: '下書き' } })
  rerender(<InlineEdit {...props} onSave={save} />)
  const editing = container.innerHTML
  rerender(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  expect(container.innerHTML).toBe(editing)
  expect(input().disabled).toBe(false)
  await act(async () => fireEvent.keyDown(input(), { key: 'Enter' }))
  expect(save).toHaveBeenCalledExactlyOnceWith('下書き')
})

it('理由付きの編集ボタンは値と焦点と吹き出しを保ち起動しない', async () => {
  const save = vi.fn()
  render(<InlineEdit {...props} onSave={save} lockedReason={reason} disabled canSaveNow={() => false} />)
  expect(button().textContent).toBe('元の名前')
  expect(button().disabled).toBe(false)
  expect(button().getAttribute('aria-disabled')).toBe('true')
  expect(button().hasAttribute('data-permission-locked')).toBe(true)
  expect(button().hasAttribute('data-no-name-tip')).toBe(true)
  const descriptionIds = button().getAttribute('aria-describedby')!.split(' ')
  expect(descriptionIds).toHaveLength(1)
  expect(document.getElementById(descriptionIds[0])?.hidden).toBe(true)
  expect(document.getElementById(descriptionIds[0])?.textContent).toBe(reason)
  expect(button().tabIndex).toBe(0)
  fireEvent.click(button()); fireEvent.doubleClick(button())
  fireEvent.keyDown(button(), { key: 'Enter' }); fireEvent.keyDown(button(), { key: ' ' })
  await act(async () => button().focus())
  expect(screen.getAllByRole('tooltip')).toHaveLength(1)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

it('touchでも理由は1つだけで名前の吹き出しと重ならない', () => {
  render(<InlineEdit {...props} onSave={vi.fn()} lockedReason={reason} />)
  fireEvent.pointerDown(button(), { pointerType: 'touch' })
  expect(screen.getAllByRole('tooltip')).toHaveLength(1)
  expect(screen.getByRole('tooltip').textContent).toBe(reason)
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('編集中にロックされても下書きは残り、文字変更・Enter・保持したEnterは保存0', async () => {
  const save = vi.fn()
  const { rerender } = render(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  const held = retained(input()).onKeyDown!
  const heldChange = retained(input()).onChange!
  rerender(<InlineEdit {...props} onSave={save} lockedReason={reason} disabled canSaveNow={() => false} />)
  expect(input().value).toBe('下書き')
  expect(input().readOnly).toBe(true)
  expect(input().disabled).toBe(false)
  expect(input().getAttribute('aria-disabled')).toBe('true')
  fireEvent.change(input(), { target: { value: '書換え' } })
  await act(async () => {
    heldChange({ target: { value: '旧操作の書換え' } } as React.ChangeEvent<HTMLInputElement>)
    held(enter())
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.keyDown(input(), { key: ' ' })
  })
  expect(input().value).toBe('下書き')
  fireEvent.blur(input())
  expect(input().value).toBe('下書き')
  await act(async () => input().focus())
  expect(screen.getAllByRole('tooltip')).toHaveLength(1)
  expect(save).not.toHaveBeenCalled()
  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(button().textContent).toBe('元の名前')
})

it('本人未確定に変わった編集中の入力は理由なしreadonlyで下書き保持・保存0・Escape取消可', async () => {
  const save = vi.fn()
  const { rerender } = render(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  const held = retained(input()).onKeyDown!
  rerender(<InlineEdit {...props} onSave={save} disabled canSaveNow={() => false} />)
  expect(input().disabled).toBe(false)
  expect(input().readOnly).toBe(true)
  expect(input().hasAttribute('data-permission-locked')).toBe(false)
  expect(input().getAttribute('aria-disabled')).toBe('true')
  expect(input().value).toBe('下書き')
  await act(async () => held(enter()))
  expect(save).not.toHaveBeenCalled()
  expect(screen.queryByRole('tooltip')).toBeNull()
  await act(async () => input().focus())
  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(button().disabled).toBe(true)
  expect(button().hasAttribute('data-permission-locked')).toBe(false)
})

it.each([false, true])('保持したEnterは描画ごとに違う最新callback=%sを読む', async allowed => {
  const save = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  rerender(<InlineEdit {...props} onSave={save} canSaveNow={() => !allowed} />)
  const held = retained(input()).onKeyDown!
  rerender(<InlineEdit {...props} onSave={save} canSaveNow={() => allowed} />)
  await act(async () => held(enter()))
  expect(save).toHaveBeenCalledTimes(allowed ? 1 : 0)
  if (allowed) expect(save).toHaveBeenCalledWith('下書き')
})

it('callbackがtrueでも現在disabledがtrueなら保持したEnterは保存0', async () => {
  const save = vi.fn()
  const { rerender } = render(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  const held = retained(input()).onKeyDown!
  rerender(<InlineEdit {...props} onSave={save} disabled canSaveNow={() => true} />)
  await act(async () => held(enter()))
  expect(save).not.toHaveBeenCalled()
})

it('理由だけを後から渡しても、保持したEnterは保存0', async () => {
  const save = vi.fn()
  const { rerender } = render(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  const held = retained(input()).onKeyDown!
  rerender(<InlineEdit {...props} onSave={save} lockedReason={reason} canSaveNow={() => true} />)
  await act(async () => held(enter()))
  expect(save).not.toHaveBeenCalled()
})

it('保持した編集の入口も現在のcallbackとdisabledを見て開かない', () => {
  const { rerender } = render(<InlineEdit {...props} onSave={vi.fn()} canSaveNow={() => true} />)
  const held = retained(button()).onClick!
  rerender(<InlineEdit {...props} onSave={vi.fn()} disabled canSaveNow={() => false} />)
  act(() => held({} as React.MouseEvent<HTMLInputElement>))
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('許可が戻っただけでは保存せず、Enterで同じ下書きを1回保存する', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  rerender(<InlineEdit {...props} onSave={save} lockedReason={reason} canSaveNow={() => false} />)
  rerender(<InlineEdit {...props} onSave={save} canSaveNow={() => true} />)
  expect(save).not.toHaveBeenCalled()
  expect(input().value).toBe('下書き')
  await act(async () => fireEvent.keyDown(input(), { key: 'Enter' }))
  expect(save).toHaveBeenCalledExactlyOnceWith('下書き')
})


it('未指定から後で理由だけを渡しても、保持したEnterは新しい権限で保存0', async () => {
  const save = vi.fn()
  const { rerender } = render(<InlineEdit {...props} onSave={save} />)
  fireEvent.click(button()); fireEvent.change(input(), { target: { value: '下書き' } })
  const held = retained(input()).onKeyDown!
  rerender(<InlineEdit {...props} onSave={save} lockedReason={reason} />)
  await act(async () => held(enter()))
  expect(save).not.toHaveBeenCalled()
  expect(input().value).toBe('下書き')
  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(screen.queryByRole('textbox')).toBeNull()
})
