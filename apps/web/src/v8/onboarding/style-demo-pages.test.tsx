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

it('デモを開き、ページを飛ばし、閉じたら入口へ焦点が戻る', () => {
  const choose = vi.fn()
  render(<StyleChoiceStep viewing="restaurant" onView={vi.fn()} chosen={null} onChoose={choose} />)
  const open = screen.getByRole('button', { name: '詳しく見る' })
  fireEvent.click(open)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'デモを閉じる' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  expect(screen.getByRole('heading', { name: 'LINE来店フォロー' })).toBeTruthy()
  expect(screen.getByText('予約の前日')).toBeTruthy()
  expect(choose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'musubo ならではに進む' }))
  fireEvent.click(screen.getByRole('button', { name: 'このスタイルにする' }))
  expect(choose).toHaveBeenCalledWith('restaurant')
  fireEvent.click(screen.getByRole('button', { name: 'デモを閉じる' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '詳しく見る' }))
})

it('6スタイルの切り替えは見るだけで、ページを最初へ戻す', () => {
  const choose = vi.fn()
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('restaurant')
    return <StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={choose} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  const group = screen.getByRole('group', { name: '見るスタイル' })
  for (const name of ['サロン', '面談・相談', '教室・レッスン', '標準', 'EC', '飲食店']) {
    fireEvent.click(within(group).getByRole('button', { name }))
    expect(screen.getByText('1 / 5')).toBeTruthy()
  }
  fireEvent.click(within(group).getByRole('button', { name: '標準' }))
  fireEvent.click(screen.getByRole('button', { name: 'よく使う操作に進む' }))
  expect(screen.getAllByText('お知らせを作る').length).toBeGreaterThan(0)
  expect(choose).not.toHaveBeenCalled()
})

it('Escape はデモだけを閉じ、選んだ後も焦点を失わない', () => {
  function Subject() {
    const [chosen, setChosen] = useState<AccountStyle | null>(null)
    return <StyleChoiceStep viewing="restaurant" onView={vi.fn()} chosen={chosen} onChoose={setChosen} />
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  const choose = screen.getByRole('button', { name: 'このスタイルにする' })
  choose.focus()
  fireEvent.click(choose)
  expect(document.activeElement?.textContent).toContain('選んでいます')
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '詳しく見る' }))
})

it('窓の帯に切り替えがある場合もデモ中の切り替えで最初のページに戻る', () => {
  function Subject() {
    const [viewing, setViewing] = useState<AccountStyle>('restaurant')
    return <><button onClick={() => setViewing('salon')}>外の切り替え</button><StyleChoiceStep viewing={viewing} onView={setViewing} chosen={null} onChoose={vi.fn()} switcher="external" /></>
  }
  render(<Subject />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  fireEvent.click(screen.getByRole('button', { name: '設定のしかたに進む' }))
  fireEvent.click(screen.getByRole('button', { name: '外の切り替え' }))
  expect(screen.getByText('1 / 5')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'デモを閉じる' })).toBeTruthy()
})
