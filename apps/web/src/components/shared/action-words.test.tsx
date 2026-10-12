// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { normalizeActionLabel } from './action-words'
import Button from './button'
import KpiCard from './kpi-card'
afterEach(cleanup)
it.each([
  ['直す', '編集する'], ['編集', '編集する'], ['フォルダを直す', 'フォルダを編集する'],
  ['読み直す', '読み直す'], ['作り直す', '作り直す'], ['最新を取り込んで直す', '最新を取り込んで直す'],
])('同じ編集の言葉だけをそろえる', (input, text) => { expect(normalizeActionLabel(input)).toBe(text) })
it('操作の口へ渡した言葉だけをそろえ、処理と任意の名前を保つ', () => {
  const edit = vi.fn()
  render(<><Button actionWording onClick={edit}>直す</Button><Button>編集</Button></>)
  fireEvent.click(screen.getByRole('button', { name: '編集する' }))
  expect(edit).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '編集' })).toBeTruthy()
})
it('数の帯は同じ操作の口で既存の絞り込みを呼び、リンクも保つ', () => {
  const filter = vi.fn()
  render(<><KpiCard title="空のまま" value={2} unit="件" detail="確認してください" action={{ label: '直す', onClick: filter }} /><KpiCard title="履歴" value={4} unit="件" detail="記録" action={{ label: '詳しく見る', href: '/history' }} /></>)
  fireEvent.click(screen.getByRole('button', { name: '編集する' }))
  expect(filter).toHaveBeenCalledOnce()
  expect(screen.getByRole('link', { name: '詳しく見る' }).getAttribute('href')).toBe('/history')
})
