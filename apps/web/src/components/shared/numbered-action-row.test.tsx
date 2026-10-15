// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ActionList from './action-list'

type Step = { id: string; name: string; summary: string }
const initial: Step[] = [{ id: 'tag', name: 'タグを付ける', summary: '購入済み' }, { id: 'branch', name: '条件で分ける', summary: '初回購入かどうか' }]
function Harness({ readOnly = false, reorderable = true, minItems = 0 }) {
  const [value, onChange] = useState(initial)
  return <><output data-testid="value">{JSON.stringify(value)}</output><ActionList appearance="numbered" value={value} onChange={onChange} choices={[]}
    readOnly={readOnly} reorderable={reorderable} minItems={minItems} idOf={step => step.id} kindOf={step => step.name} titleOf={step => step.summary}
    renderEditor={(step, update) => <input aria-label="処理の中身" value={step.summary} onChange={event => update({ ...step, summary: event.target.value })} />} /></>
}
const data = () => JSON.parse(screen.getByTestId('value').textContent!) as Step[]
afterEach(cleanup)
describe('番号付き処理カード', () => {
  it('閉じた番号付きカードから上下移動し、実行順と端の操作を更新する', () => {
    render(<Harness />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect((screen.getByRole('button', { name: '1つ目の処理を上へ' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '1つ目の処理を下へ' }))
    expect(data().map(step => step.id)).toEqual(['branch', 'tag'])
    fireEvent.click(screen.getByRole('button', { name: '2つ目の処理を上へ' }))
    expect(data().map(step => step.id)).toEqual(['tag', 'branch'])
  })
  it('編集内容を保持し、分岐を含め一度に一つのカードだけを開く', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /1 タグを付ける/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '更新済み' } })
    fireEvent.click(screen.getByRole('button', { name: /2 条件で分ける/ }))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(data()[0].summary).toBe('更新済み')
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('初回購入かどうか')
  })
  it('削除を取り消したら保持し、確定してから実行順から除く', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '1つ目の処理を削除する' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }))
    expect(data()).toEqual(initial)
    fireEvent.click(screen.getByRole('button', { name: '1つ目の処理を削除する' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除する' }))
    expect(data().map(step => step.id)).toEqual(['branch'])
  })
  it('閲覧のみと並べ替え禁止、最低件数を守る', () => {
    const view = render(<Harness readOnly />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<Harness reorderable={false} minItems={2} />)
    expect(screen.queryByRole('button', { name: /処理を上へ|処理を下へ|処理を削除する/ })).toBeNull()
  })
})
