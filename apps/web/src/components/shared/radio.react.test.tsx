// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import Radio from './radio'

afterEach(cleanup)
it('文字のクリックで同じ群のラジオを切り替え、フォームに選択値を残す', () => {
  render(<form aria-label="対象"><Radio name="audience" value="tag" defaultChecked>タグで絞る</Radio><Radio name="audience" value="all">すべての友だち</Radio></form>)
  fireEvent.click(screen.getByText('すべての友だち'))
  expect((screen.getByRole('radio', { name: 'すべての友だち' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('radio', { name: 'タグで絞る' }) as HTMLInputElement).checked).toBe(false)
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('audience')).toBe('all')
})
it('無効のラジオはフォームの選択値に入らない', () => {
  render(<form aria-label="対象"><Radio name="audience" value="tag" disabled defaultChecked>タグで絞る</Radio></form>)
  expect((screen.getByRole('radio') as HTMLInputElement).disabled).toBe(true)
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).has('audience')).toBe(false)
})
