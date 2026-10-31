// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EMPTY_DEFINITION } from './editor-model'
import { ReturningMessage } from './editor-message'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shared/insert-text-field', () => ({ default: ({ value, onValueChange, ...props }: { value: string; onValueChange: (value: string) => void; 'aria-label': string }) => <textarea aria-label={props['aria-label']} value={value} onChange={event => onValueChange(event.target.value)} /> }))
afterEach(cleanup)

it('初回メッセージの編集は右上の×で閉じ、誤った破棄確認を出さず入力を残す', async () => {
  function Parent() {
    const [definition, setDefinition] = useState({ ...EMPTY_DEFINITION, returningMode: 'other' as const })
    return <ReturningMessage definition={definition} setDefinition={setDefinition as React.Dispatch<React.SetStateAction<typeof EMPTY_DEFINITION>>} scenarios={[]} canEdit />
  }
  render(<Parent />)
  fireEvent.click(screen.getByRole('button', { name: '初回メッセージを確認・変更' }))
  const dialog = await screen.findByRole('dialog', { name: '初回メッセージ' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: '最初に送るメッセージ' }), { target: { value: 'おかえりなさい' } })
  expect(dialog.querySelector('[data-window-actions]')?.textContent).toBe('')
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる', exact: true }))
  expect(screen.queryByText('入力を破棄しますか？')).toBeNull()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '初回メッセージを確認・変更' }))
  expect((await screen.findByRole('textbox', { name: '最初に送るメッセージ' }) as HTMLTextAreaElement).value).toBe('おかえりなさい')
})
