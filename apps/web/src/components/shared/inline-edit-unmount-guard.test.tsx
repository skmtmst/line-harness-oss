// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InlineEdit from './inline-edit'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
afterEach(cleanup)

function Host({ onSave }: { onSave: () => Promise<unknown> }) {
  const [visible, setVisible] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const guard = useUnsavedGuard({ dirty, busy })
  return <>
    {visible && <InlineEdit value="受け取り口" label="名前" onSave={onSave} onDirtyChange={setDirty} onSavingChange={setBusy} preserveDirtyOnBlur />}
    <button onClick={() => setVisible(false)}>行を消す</button>
    <button onClick={() => guard.guarded(() => { document.body.dataset.leave = 'yes' })}>画面を移る</button>
    <UnsavedLeaveDialog open={guard.leaveTarget !== null} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
  </>
}

it.each(['編集途中', '保存中'])('%sの行が消えたら離脱を妨げない', async (state) => {
  delete document.body.dataset.leave
  render(<Host onSave={() => new Promise(() => {})} />)
  fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
  const input = screen.getByRole('textbox', { name: '名前' })
  fireEvent.change(input, { target: { value: '変更中' } })
  if (state === '保存中') fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: '行を消す' }))
  fireEvent.click(screen.getByRole('button', { name: '画面を移る' }))
  expect(document.body.dataset.leave).toBe('yes')
  expect(screen.queryByRole('dialog', { name: '保存していない変更があります' })).toBeNull()
})
