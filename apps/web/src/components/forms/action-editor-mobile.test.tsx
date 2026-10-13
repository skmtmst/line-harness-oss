// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FormAction } from '@line-crm/shared'
import ActionEditor from './action-editor'
import { EMPTY_REFS } from './form-refs'
function Editor({ initial }: { initial: FormAction[] }) {
  const [value, setValue] = useState(initial)
  return <><output data-testid="value">{JSON.stringify(value)}</output><ActionEditor value={value} onChange={setValue} refs={EMPTY_REFS} /></>
}
afterEach(cleanup)
describe('B-169 フォームの動作は行の下で編集する', () => {
  it('本文の改訂を保存用の値へ返す', () => {
    render(<Editor initial={[{ kind: 'send_text', text: 'ありがとうございます' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'テキストを送る「ありがとうございます」' }))
    fireEvent.change(screen.getByRole('textbox', { name: '送る文面' }), { target: { value: 'またお越しください' } })
    expect(screen.getByTestId('value').textContent).toContain('またお越しください')
  })
  it('友だち情報の値を保って編集する', () => {
    render(<Editor initial={[{ kind: 'friend_field', fieldId: '', value: '123' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /未設定/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '書き込む値' }), { target: { value: '456' } })
    expect(screen.getByTestId('value').textContent).toContain('456')
  })
  it('リマインダには本文の入力を出さない', () => {
    render(<Editor initial={[{ kind: 'reminder', reminderId: '' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /未設定/ }))
    expect(screen.queryByRole('textbox', { name: '送る文面' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: '書き込む値' })).toBeNull()
  })
})
