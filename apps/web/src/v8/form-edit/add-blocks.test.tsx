// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ADD_GROUPS } from './model'
import AddGrid from './add-blocks'
import { formBlockIcon } from './block-icons'

afterEach(cleanup)
it('追加する種類を印と説明で見分け、全カードが元の生成処理を実行する', () => {
  const add = vi.fn()
  render(<AddGrid onAdd={add} />)
  for (const card of ADD_GROUPS.flatMap(group => group.cards)) {
    const button = screen.getByRole('button', { name: `${card.label}${card.fresh ? ' 新' : ''} ${card.hint}` })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.querySelector('svg.lucide-plus')).toBeNull()
    fireEvent.click(button)
    expect(add).toHaveBeenLastCalledWith(card.make)
  }
})
it('評価と添付の閉じた行も実際の入力の種類を示す', () => {
  const { container } = render(<>{formBlockIcon({ id: 'r', kind: 'input', type: 'rating', name: 'r', label: '評価' })}{formBlockIcon({ id: 'f', kind: 'input', type: 'file', name: 'f', label: '添付' })}</>)
  expect(container.querySelector('svg.lucide-star')).not.toBeNull()
  expect(container.querySelector('svg.lucide-paperclip')).not.toBeNull()
  expect(container.querySelector('svg.lucide-circle-help')).toBeNull()
})
