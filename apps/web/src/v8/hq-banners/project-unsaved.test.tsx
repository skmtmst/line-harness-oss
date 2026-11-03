// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CreateProjectDialogV8 } from './dialogs'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
afterEach(() => { cleanup(); push.mockReset() })

it('プロジェクトの入力中は画面を離れる前に確認し、続けると入力を残す', () => {
  render(<><a href="/templates">テンプレート</a><CreateProjectDialogV8 open onSubmit={vi.fn()} onCancel={vi.fn()} /></>)
  fireEvent.change(screen.getByRole('textbox', { name: /プロジェクト名/ }), { target: { value: '春の企画' } })
  fireEvent.click(screen.getByRole('link', { name: 'テンプレート' }))
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect((screen.getByRole('textbox', { name: /プロジェクト名/ }) as HTMLInputElement).value).toBe('春の企画')
  expect(push).not.toHaveBeenCalled()
})

it('名前の変更中に戻る操作を止める', () => {
  render(<CreateProjectDialogV8 open onSubmit={vi.fn()} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: /説明/ }), { target: { value: '説明' } })
  fireEvent.popState(window)
  expect(screen.getByText('保存していない変更があります')).toBeTruthy()
})

it('キャンセルでは確認を経て一度だけ閉じ、保存中は破棄できない', () => {
  const close = vi.fn()
  const { rerender } = render(<CreateProjectDialogV8 open onSubmit={vi.fn()} onCancel={close} />)
  fireEvent.change(screen.getByRole('textbox', { name: /プロジェクト名/ }), { target: { value: '春の企画' } })
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(close).not.toHaveBeenCalled()
  rerender(<CreateProjectDialogV8 open busy onSubmit={vi.fn()} onCancel={close} />)
  expect((screen.getByRole('button', { name: '処理中…' }) as HTMLButtonElement).disabled).toBe(true)
  rerender(<CreateProjectDialogV8 open onSubmit={vi.fn()} onCancel={close} />)
  fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
  expect(close).toHaveBeenCalledTimes(1)
})
