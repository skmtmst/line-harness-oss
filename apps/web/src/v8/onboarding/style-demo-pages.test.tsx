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
  expect(screen.getByText('画面の見本です', { exact: false })).toBeTruthy()
  expect(screen.queryByText('画面と操作の見本です', { exact: false })).toBeNull()
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
  expect(screen.getByText('画面の見本です', { exact: false })).toBeTruthy()
  expect(screen.queryByText('画面と操作の見本です', { exact: false })).toBeNull()
  expect(choose).not.toHaveBeenCalled()
})
it('教室・レッスンではクラスの予定の見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('lesson')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  expect(screen.getByRole('heading', { name: 'クラスの予定を確認する' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'クラスの予定' })).toBeTruthy()
  expect(screen.getByText('10:00–11:00 はじめてのヨガ・残り 3・出欠待ち 2人')).toBeTruthy()
  expect(screen.queryByText('回数券')).toBeNull()
  expect(screen.queryByText('月謝')).toBeNull()
  expect(screen.getByText('見本のため実際の設定は変わりません。', { exact: false })).toBeTruthy()
  expect(screen.getByText('画面の見本です', { exact: false })).toBeTruthy()
  expect(screen.queryByText('画面と操作の見本です', { exact: false })).toBeNull()
  expect(choose).not.toHaveBeenCalled()
})
it('ECでは商品の案内の見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('ec')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  expect(screen.getByRole('heading', { name: '商品の案内を用意する' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '商品の案内' })).toBeTruthy()
  expect(screen.getByText('見本 焼き菓子セット・¥1,200')).toBeTruthy()
  expect(screen.getByText('見本 ハーブティー・¥800')).toBeTruthy()
  expect(screen.queryByText('残り', { exact: false })).toBeNull()
  expect(screen.getByText('在庫の管理はしません', { exact: false })).toBeTruthy()
  expect(screen.queryByText('掲載中')).toBeNull()
  expect(screen.queryByText('クーポン')).toBeNull()
  expect(screen.queryByText('定期便')).toBeNull()
  expect(screen.getByText('見本のため実際の設定は変わりません。', { exact: false })).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
})
it('飲食店では来店のあとの見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('restaurant')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: '来店のあともに進む' }))
  expect(screen.getByRole('heading', { name: '来店のあとも、つながりが続く' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '来店のあと' })).toBeTruthy()
  expect(screen.getByText('18:00–20:00 見本 たろう さま・2名・テーブル席')).toBeTruthy()
  expect(screen.getByText('昨日はありがとうございました。またのお越しをお待ちしています。')).toBeTruthy()
  expect(screen.getByText('送り始めるには設定と承認が必要で、保存しただけでは始まりません。', { exact: false })).toBeTruthy()
  expect(screen.queryByText('画面と操作の見本です', { exact: false })).toBeNull()
  expect(choose).not.toHaveBeenCalled()
})
it('サロンでは来店のあとの見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('salon')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: '来店のあともに進む' }))
  expect(screen.getByRole('heading', { name: '来店のあとも、つながりが続く' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '来店のあと' })).toBeTruthy()
  expect(screen.getByText('11:30–12:30 見本 みお さま・カット・担当 見本 あおい')).toBeTruthy()
  expect(screen.getByText('昨日はご来店ありがとうございました。またのご利用をお待ちしています。')).toBeTruthy()
  expect(screen.getByText('送り始めるには設定と承認が必要で、保存しただけでは始まりません。', { exact: false })).toBeTruthy()
  expect(screen.queryByText('画面と操作の見本です', { exact: false })).toBeNull()
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
