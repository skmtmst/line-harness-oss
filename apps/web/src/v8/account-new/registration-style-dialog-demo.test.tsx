// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import RegistrationStyleDialog from './registration-style-dialog'

beforeEach(() => { setTestReducedMotion(true) })
afterEach(cleanup)
it('登録のデモで選ぶと、onChooseへ渡し選択済みボタンへ焦点を移す', async () => {
  const choose = vi.fn()
  function Subject() {
    const [choice, setChoice] = useState<AccountStyle | ''>('')
    return <RegistrationStyleDialog open accountId="a" menu={{ value: 'simple' }} onMenuChange={vi.fn()} choice={choice} busy={false} ready error="" onChoose={style => { choose(style); setChoice(style) }} onSave={vi.fn()} onSkip={vi.fn()} onClose={vi.fn()} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
  const action = within(dialog).getByRole('button', { name: 'このスタイルにする' })
  expect(action.closest('[data-dialog-actions]')).toBeTruthy()
  fireEvent.click(action)
  expect(choose).toHaveBeenCalledExactlyOnceWith('restaurant')
  const selected = within(dialog).getByRole('button', { name: '選んでいます' })
  await waitFor(() => expect(document.activeElement).toBe(selected))
  expect(within(dialog).getByText('選んでいるスタイル：飲食店')).toBeTruthy()
})
