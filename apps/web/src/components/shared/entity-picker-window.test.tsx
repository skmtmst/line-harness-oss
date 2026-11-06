// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EntityPickerWindow } from './entity-picker'
afterEach(cleanup)
it('指定しない選ぶ窓は640のまま、見本なしで本文と操作を保つ', () => {
  render(<EntityPickerWindow title="選ぶ" onCancel={() => {}} footer={<button>決める</button>}><p>候補の本文</p></EntityPickerWindow>)
  const dialog = screen.getByRole('dialog')
  expect(dialog.style.getPropertyValue('--dialog-design-width')).toBe('640px')
  expect(screen.getByText('候補の本文')).toBeTruthy()
  expect(screen.getByRole('button', { name: '決める' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'テンプレートの中身' })).toBeNull()
})
it('指定した窓だけ960を使い、見本を閉じても広さを保つ', () => {
  const base = { title: '選ぶ', wide: true, onCancel: () => {}, footer: <button>決める</button>, children: <p>候補の本文</p> }
  const view = render(<EntityPickerWindow {...base} preview={{ title: '見本', content: '詳しい本文', actions: <button>見本から選ぶ</button>, onClose: () => {} }} />)
  expect(screen.getByRole('dialog').style.getPropertyValue('--dialog-design-width')).toBe('960px')
  expect(screen.getByRole('region', { name: 'テンプレートの中身' }).textContent).toContain('詳しい本文')
  view.rerender(<EntityPickerWindow {...base} />)
  expect(screen.getByRole('dialog').style.getPropertyValue('--dialog-design-width')).toBe('960px')
  expect(screen.queryByRole('region', { name: 'テンプレートの中身' })).toBeNull()
})

it('見本の操作を指定しなければ余分な操作の帯を出さない', () => {
  render(<EntityPickerWindow title="選ぶ" onCancel={() => {}} footer={<button>決める</button>} preview={{ title: '見本', content: '本文', onClose: () => {} }} />)
  const preview = screen.getByRole('region', { name: 'テンプレートの中身' })
  expect(preview.querySelector('footer')).toBeNull()
  expect(screen.getAllByRole('button', { name: '決める' })).toHaveLength(1)
})
