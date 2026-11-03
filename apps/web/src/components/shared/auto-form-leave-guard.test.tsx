// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { AutoFormLeaveGuard } from './form-leave-guard'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { notifySaved, clearToastsForTest } from './toast'
afterEach(() => { cleanup(); clearToastsForTest() })
test('作成の型は入力を守り、保存できた値からは離れられる', () => {
  const cancel = vi.fn()
  function Form() {
    const [name, setName] = useState('')
    return <div data-page-template="create"><AutoFormLeaveGuard /><input aria-label="名前" value={name} onChange={(event) => setName(event.target.value)} /><button onClick={() => notifySaved()}>保存する</button><button onClick={cancel}>キャンセル</button></div>
  }
  render(<Form />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '編集中' } })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('編集中')
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(cancel).toHaveBeenCalledTimes(1)
})

test('作成画面のキャンセルは別の作りかけも知らせる', () => {
  const cancel = vi.fn()
  function Child() {
    const guard = useUnsavedGuard({ dirty: true, subject: '作りかけのフォルダ' })
    return <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="作りかけのフォルダ" onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
  }
  function Form() {
    const [name, setName] = useState('')
    return <><div data-page-template="create"><AutoFormLeaveGuard /><input aria-label="名前" value={name} onChange={event => setName(event.target.value)} /><button onClick={cancel}>キャンセル</button></div><Child /></>
  }
  render(<Form />)
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '編集中' } })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  const message = screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent
  expect(message).toContain('作りかけのフォルダ')
  expect(message).toContain('ほかの未保存の入力')
  expect(cancel).not.toHaveBeenCalled()
})

test('画面の入力が未変更でも子の作りかけを確認してからキャンセルする', () => {
  const cancel = vi.fn()
  function Child() {
    const guard = useUnsavedGuard({ dirty: true, subject: '作りかけのフォルダ' })
    return <UnsavedLeaveDialog open={guard.leaveTarget !== null} subject="作りかけのフォルダ" onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
  }
  render(<><div data-page-template="create"><AutoFormLeaveGuard /><input aria-label="名前" /><button onClick={cancel}>キャンセル</button></div><Child /></>)
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.getByRole('dialog', { name: '保存していない変更があります' }).textContent).toContain('作りかけのフォルダ')
  expect(cancel).not.toHaveBeenCalled()
})
