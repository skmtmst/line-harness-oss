// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountStyle } from '@line-crm/shared'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import StyleChoiceStep from './style-choice-step'
import { STYLE_EXPERIENCE_SCRIPT } from './style-experience-player/script'
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
it('面談・相談では相談のあとの見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('consult')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: '相談のあともに進む' }))
  expect(screen.getByRole('heading', { name: '相談のあとも、つながりが続く' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '相談のあと' })).toBeTruthy()
  expect(screen.getByText('10:00–10:45 見本 ひな さま・オンライン・担当 見本 かい')).toBeTruthy()
  expect(screen.getByText('昨日はご相談ありがとうございました。次のご案内をお待ちください。')).toBeTruthy()
  expect(screen.getByText('お礼を自動で送る機能の有無と条件は確認中のため', { exact: false })).toBeTruthy()
  expect(screen.getByText('「翌日 12:00」や「停止中」を含め', { exact: false })).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
})
it('教室・レッスンではレッスンのあとの見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('lesson')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'レッスンのあともに進む' }))
  expect(screen.getByRole('heading', { name: 'レッスンのあとも、つながりが続く' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'レッスンのあと' })).toBeTruthy()
  expect(screen.getByText('9:00–10:00 朝のヨガ・出席 12人')).toBeTruthy()
  expect(screen.getByText('昨日はご参加ありがとうございました。ご質問がありましたら、このトークでお知らせください。')).toBeTruthy()
  expect(screen.getByText('お礼を自動で送る機能の有無と条件は確認中のため', { exact: false })).toBeTruthy()
  expect(screen.getByText('「翌日 12:00」や「停止中」を含め', { exact: false })).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
})
it('標準では問い合わせのあとの見本を見せ、選ばずに戻れる', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('standard')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: '問い合わせのあともに進む' }))
  expect(screen.getByRole('heading', { name: '問い合わせのあとも、つながりが続く' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '問い合わせのあと' })).toBeTruthy()
  expect(screen.getByText('見本 さくら さま・見学のご相談')).toBeTruthy()
  expect(screen.getByText('受信箱・未返信 2件（最新の1件の見本）')).toBeTruthy()
  expect(screen.getByText('お問い合わせありがとうございます。担当者からご返事します。')).toBeTruthy()
  expect(screen.getByText('何も送信しません', { exact: false })).toBeTruthy()
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

it.each(['consult', 'lesson'] as const)('%s の体験台本もお礼の自動送信を断定しない', (style) => {
  const script = STYLE_EXPERIENCE_SCRIPT.styles[style]
  const thanks = script.scenes.find(scene => scene.step === 'thanks')
  expect(thanks?.line).toBe('お礼の文と時刻の見本です（自動で送る機能の有無と条件は確認中です）')
  expect(script.can[2].text).toContain('お礼を自動で送る機能の有無と条件は確認中です')
  expect(JSON.stringify(script)).not.toMatch(/翌日にお礼を送れます|面談のお礼を送れます|参加のお礼を送れます/)
})
it('サロンの体験台本は翌日を時刻の見本として説明する', () => {
  const thanks = STYLE_EXPERIENCE_SCRIPT.styles.salon.scenes.find(scene => scene.step === 'thanks')
  expect(thanks?.line).toBe('来店のお礼の文と翌日の時刻の見本です（送信には設定と承認が必要です）')
  expect(thanks?.line).not.toContain('翌日にお礼を送れます')
})
