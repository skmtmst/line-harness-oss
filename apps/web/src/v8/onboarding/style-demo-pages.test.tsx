// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountStyle } from '@line-crm/shared'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import StyleChoiceStep from './style-choice-step'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
beforeEach(() => { setTestReducedMotion(true) })
afterEach(cleanup)
it('ページを飛ばしてもスタイルは自動で選ばれない', () => {
  const choose = vi.fn()
  function Subject() {
    const [page, setPage] = useState(0)
    return <StyleChoiceStep viewing="restaurant" onView={vi.fn()} chosen={null} onChoose={choose} demoPage={page} onDemoPage={setPage} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'LINE来店フォローに進む' }))
  expect(screen.getByRole('heading', { name: 'LINE来店フォローで、かんたんに作る' })).toBeTruthy()
  expect(screen.getByText('保存の結果を確認します。まだ送信されていません。 見本のため実際の設定は変わりません。')).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
})
it('サロンでは担当ごとの予定の見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('salon')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  expect(screen.getByRole('heading', { name: '担当ごとの予定を確認する' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '担当ごとの予定' })).toBeTruthy()
  expect(screen.getByText('見本 あおい・次の空き 14:00')).toBeTruthy()
  expect(screen.getByText('11:30–12:30 見本 みお さま・カット')).toBeTruthy()
  expect(screen.getByText('見本のため実際の設定は変わりません。', { exact: false })).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
})
it('面談・相談では相談の予定の見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('consult')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  expect(screen.getByRole('heading', { name: '相談の予定を確認する' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '相談の予定' })).toBeTruthy()
  expect(screen.getByText('見本 かい・次の空き 11:00')).toBeTruthy()
  expect(screen.getByText('10:00–10:45 見本 ひな さま・オンライン')).toBeTruthy()
  expect(screen.getByText('見本のため実際の設定は変わりません。', { exact: false })).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
})
it('スタイルを変えると最初のページに戻り、標準ではお知らせを見せる', () => {
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('restaurant')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={vi.fn()} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'LINE来店フォローに進む' }))
  fireEvent.click(within(screen.getByRole('group', { name: '見るスタイル' })).getByRole('button', { name: '標準' }))
  expect(screen.getByText('1 / 5')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'お知らせを作るに進む' }))
  expect(screen.getByRole('heading', { name: 'お知らせを作る' })).toBeTruthy()
})
