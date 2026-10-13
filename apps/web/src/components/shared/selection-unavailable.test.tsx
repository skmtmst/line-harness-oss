// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Checkbox, { UnavailableSelection } from './checkbox'
afterEach(cleanup)
it('対象外の行にも枠と理由を持ち、入力やクリックで対象へ加わらない', () => {
  render(<UnavailableSelection label="メール署名を選ぶ" reason="登録済みの経路だけを選べます" />)
  const input = screen.getByRole('checkbox', { name: 'メール署名を選ぶ' }) as HTMLInputElement
  expect(input.disabled).toBe(true)
  expect(input.title).toBe('登録済みの経路だけを選べます')
  fireEvent.click(input)
  expect(input.checked).toBe(false)
})
it('通常のCheckboxも処理中の無効状態では変更を返さない', () => {
  const change = vi.fn()
  render(<Checkbox checked={false} disabled aria-label="行" onCheckedChange={change} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '行' }))
  expect(change).not.toHaveBeenCalled()
})
