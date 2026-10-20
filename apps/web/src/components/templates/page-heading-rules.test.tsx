// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PageHeading } from './page-frame'
import { ListPage } from './list-page'
afterEach(cleanup)
it('画面の説明は初めに開き、同じ場所で開閉する', () => {
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

it.each(['heading','list'])('X3: %s puts help before explanation and both remain operable', (type) => {
  const props={title:'一覧',help:'用語の意味',explanation:'画面全体の説明'}
  const {container}=render(type==='list'?<ListPage {...props}>本文</ListPage>:<PageHeading {...props} />)
  const help=screen.getByRole('button',{name:'一覧の説明'})
  const explanation=screen.getByRole('button',{name:'この画面の説明'})
  expect(help.compareDocumentPosition(explanation)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(help)
  expect(screen.getByRole('note').textContent).toContain('用語の意味')
  fireEvent.click(explanation)
  expect(explanation.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[data-screen-explanation],[data-screen-explanation-body]')?.textContent ?? container.textContent).toContain('画面全体の説明')
})

it('X4: title accessories keep their position before help and screen explanation',()=>{
  render(<ListPage title="配信" titleAccessory={<span data-testid="state">停止中</span>} help="用語" explanation="画面の説明">本文</ListPage>)
  const state=screen.getByTestId('state'),help=screen.getByRole('button',{name:'配信の説明'}),explanation=screen.getByRole('button',{name:'この画面の説明'})
  expect(state.compareDocumentPosition(help)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(help.compareDocumentPosition(explanation)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
