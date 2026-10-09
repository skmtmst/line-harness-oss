// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PageHeading } from './page-frame'
afterEach(cleanup)
it('B-158 決まり2：説明は？を開いたときだけ読み、本文への再表示を検出する', () => {
  const { container } = render(<PageHeading title="配信" help="送る相手と日時を決めます。" />)
  expect(screen.queryByText('送る相手と日時を決めます。')).toBeNull()
  expect(container.querySelector('p')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '配信の説明' }))
  expect(screen.getByText('送る相手と日時を決めます。')).toBeTruthy()
})

it('認証画面の見出し段と、フォーカス先のIDを共通部品でも保つ', () => {
  render(<PageHeading title="ログイン" titleAs="h1" titleId="login-heading" titleTabIndex={-1} />)
  const title=screen.getByRole('heading', {name:'ログイン',level:1})
  expect(title.id).toBe('login-heading')
  title.focus()
  expect(document.activeElement).toBe(title)
})
