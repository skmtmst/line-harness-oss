// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PageHeading } from './page-frame'
afterEach(cleanup)
it('B-245：画面の説明は初めに開き、同じ場所で開閉する', () => {
  const { container } = render(<PageHeading title="配信" explanation="送る相手と日時を決めます。" />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  const panel = container.querySelector<HTMLElement>('[data-screen-explanation]')!
  expect(panel.hidden).toBe(false)
  expect(panel.textContent).toBe('送る相手と日時を決めます。')
  fireEvent.click(toggle)
  expect(panel.hidden).toBe(true)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(panel.hidden).toBe(false)
})

it('認証画面の見出し段と、フォーカス先のIDを共通部品でも保つ', () => {
  render(<PageHeading title="ログイン" titleAs="h1" titleId="login-heading" titleTabIndex={-1} />)
  const title=screen.getByRole('heading', {name:'ログイン',level:1})
  expect(title.id).toBe('login-heading')
  title.focus()
  expect(document.activeElement).toBe(title)
})

it('短い言葉の説明は最初から本文へ広げず、画面全体の説明と別に開く', () => {
  const { container } = render(<PageHeading title="一覧" help="短い言葉の意味" explanation="画面全体の説明" />)
  expect(container.querySelector('[data-screen-explanation]')?.textContent).toBe('画面全体の説明')
  expect(container.textContent).not.toContain('短い言葉の意味')
  fireEvent.click(screen.getByRole('button', { name: '一覧の説明' }))
  expect(screen.getByRole('note').textContent).toContain('短い言葉の意味')
})
