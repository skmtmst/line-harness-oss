// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { GridNameCell } from './grid-table'
import TruncatedText from './truncated-text'

afterEach(cleanup)
it('フォルダ一覧の既定の未分類の丸と、名前の全文を保つ', () => {
  render(<GridNameCell name={<TruncatedText value="試験の名前" />} />)
  expect(screen.getByRole('img', { name: 'フォルダ：未分類' })).toBeTruthy()
  expect(screen.getByRole('cell').textContent).toContain('試験の名前')
})
it('フォルダ分けの無い名簿は、明示したときだけ丸を外す', () => {
  render(<GridNameCell folder={false} name={<TruncatedText value="試験の名前" />} />)
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByRole('cell').textContent).toContain('試験の名前')
})
