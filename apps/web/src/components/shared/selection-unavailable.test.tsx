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

it('閲覧のみの選択を省き、対象外の行と処理中の選択の枠は残す', () => {
  render(<><UnavailableSelection label="このページを選ぶ" /><UnavailableSelection label="閲覧の行を選ぶ" reason="閲覧のみのため選べません" /><UnavailableSelection label="対象外の行" reason="登録済みの経路だけを選べます" /><Checkbox checked={false} disabled aria-label="処理中の行" onCheckedChange={vi.fn()} /></>)
  expect(screen.queryByRole('checkbox',{name:'このページを選ぶ'})).toBeNull()
  expect(screen.queryByRole('checkbox',{name:'閲覧の行を選ぶ'})).toBeNull()
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  expect((screen.getByRole('checkbox',{name:'対象外の行'}) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('checkbox',{name:'処理中の行'}) as HTMLInputElement).disabled).toBe(true)
})
