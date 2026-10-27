// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PageHeading } from './page-frame'
import { ListPage } from './list-page'
afterEach(cleanup)
it('画面の説明は題の横の「？」で開き、同じ場所で閉じる（帯は出さない）', () => {
  const { container } = render(<PageHeading title="配信" explanation="送る相手と日時を決めます。" />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  expect(container.querySelector('[data-template-region="heading"]')?.contains(toggle)).toBe(true)
  expect(container.textContent).not.toContain('送る相手と日時を決めます。')
  fireEvent.click(toggle)
  expect(screen.getByRole('note').textContent).toBe('送る相手と日時を決めます。')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('note')).toBeNull()
})

it('認証画面の見出し段と、フォーカス先のIDを共通部品でも保つ', () => {
  render(<PageHeading title="ログイン" titleAs="h1" titleId="login-heading" titleTabIndex={-1} />)
  const title=screen.getByRole('heading', {name:'ログイン',level:1})
  expect(title.id).toBe('login-heading')
  title.focus()
  expect(document.activeElement).toBe(title)
})

it('題の補足と画面全体の説明は「？」1つにまとめ、最初は広げない', () => {
  const { container } = render(<PageHeading title="一覧" help="短い言葉の意味" explanation="画面全体の説明" />)
  expect(container.textContent).not.toContain('短い言葉の意味')
  expect(container.textContent).not.toContain('画面全体の説明')
  expect(screen.queryByRole('button', { name: '一覧の説明' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  const note = screen.getByRole('note').textContent ?? ''
  expect(note.indexOf('短い言葉の意味')).toBeLessThan(note.indexOf('画面全体の説明'))
})

it.each(['heading','list'])('X3: %s は題の補足を先に、画面の説明を後に1つの「？」で出す', (type) => {
  const props={title:'一覧',help:'用語の意味',explanation:'画面全体の説明'}
  render(type==='list'?<ListPage {...props}>本文</ListPage>:<PageHeading {...props} />)
  expect(screen.getAllByRole('button',{name:'この画面の説明'})).toHaveLength(1)
  fireEvent.click(screen.getByRole('button',{name:'この画面の説明'}))
  const note=screen.getByRole('note').textContent ?? ''
  expect(note).toContain('用語の意味')
  expect(note).toContain('画面全体の説明')
})

it('X4: title accessories keep their position before the help mark',()=>{
  render(<ListPage title="配信" titleAccessory={<span data-testid="state">停止中</span>} help="用語" explanation="画面の説明">本文</ListPage>)
  const state=screen.getByTestId('state'),explanation=screen.getByRole('button',{name:'この画面の説明'})
  expect(state.compareDocumentPosition(explanation)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('題の補足だけの時はこれまでどおり「〇〇の説明」', () => {
  render(<PageHeading title="配信" help="用語" />)
  expect(screen.getByRole('button', { name: '配信の説明' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'この画面の説明' })).toBeNull()
})
