// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PageExplanationBody, PageExplanationProvider, PageExplanationToggle } from './page-explanation'
import { ListPage } from '@/components/templates/list-page'

/*
 * 画面の説明は題の右の「？」1つ（洗い出し 74）。灰の帯・青い「この画面の説明 ⌃」は出さない。
 * 押すと吹き出しで中身を読め、もう一度押すと閉じる。
 */
function Screen() {
  return <PageExplanationProvider pageKey="scenarios">
    <PageExplanationToggle />
    <PageExplanationBody>配信を始める前にテストを送ります。</PageExplanationBody>
  </PageExplanationProvider>
}
afterEach(() => cleanup())

it('初めは閉じた「？」で、押すと吹き出しで説明を読める', () => {
  render(<Screen />)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.body.textContent).not.toContain('テストを送ります')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('note').textContent).toContain('テストを送ります')
  fireEvent.click(toggle)
  expect(screen.queryByRole('note')).toBeNull()
})

it('画面に説明の帯を出さない', () => {
  const view = render(<Screen />)
  expect(view.container.querySelector('[role="region"]')).toBeNull()
  expect(view.container.textContent).not.toContain('この画面の説明')
})

it('外のProviderの説明は一覧の見出しの「？」1つに、題の補足と一緒に入る', () => {
  const view = render(<PageExplanationProvider pageKey="scenarios-list">
    <ListPage title="シナリオ" help="用語の説明" explanationToggle={<PageExplanationToggle />}>
      <PageExplanationBody keepMounted>配信を始める前にテストを送ります。</PageExplanationBody>
    </ListPage>
  </PageExplanationProvider>)
  const toggle = screen.getByRole('button', { name: 'この画面の説明' })
  expect(view.container.querySelector('[data-template-region="heading"]')?.contains(toggle)).toBe(true)
  expect(screen.queryByRole('button', { name: 'シナリオの説明' })).toBeNull()
  fireEvent.click(toggle)
  const note = screen.getByRole('note').textContent ?? ''
  expect(note).toContain('用語の説明')
  expect(note).toContain('テストを送ります')
})

it('説明本文と明示した入口を渡す一覧は入口を二重に作らない', () => {
  render(<ListPage title="一覧" explanation="画面全体の説明" explanationToggle={<PageExplanationToggle />}>本文</ListPage>)
  expect(screen.getAllByRole('button', { name: 'この画面の説明' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  expect(screen.getByRole('note').textContent).toContain('画面全体の説明')
})
