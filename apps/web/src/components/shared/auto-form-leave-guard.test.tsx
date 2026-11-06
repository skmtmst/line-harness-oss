// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { AutoFormLeaveGuard } from './form-leave-guard'
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
