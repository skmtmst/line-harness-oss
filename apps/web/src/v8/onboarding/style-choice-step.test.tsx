// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStyle } from '@line-crm/shared'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import StyleSetupWizard from './wizard'
import StyleChoiceStep, { StyleChoiceStatus } from './style-choice-step'
import { STYLE_EXPERIENCE_SCRIPT } from './style-experience-player'
import { STYLE_CHOICES, styleLabel, type StyleState } from './model'

const calls = vi.hoisted(() => ({ save: vi.fn(), closed: vi.fn(), choose: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: {
  save: calls.save, activate: vi.fn(),
  starterSet: vi.fn(async () => ({ success: true, data: { definition: { items: [] }, preview: [] } })),
  starterItems: vi.fn(async () => ({ success: true, data: { items: [] } })),
} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', accounts: [{id:'a',name:'Test store'}], selectedAccount: {id:'a',name:'Test store'} }) }))
vi.mock('@/hooks/use-account-style', () => ({ accountStyleUpdated: vi.fn() }))
vi.mock('./use-wizard', async (original) => {
  const actual = await original<typeof import('./use-wizard')>()
  return { ...actual, useWizard: (...args: Parameters<typeof actual.useWizard>) => {
    const wizard = actual.useWizard(...args)
    return { ...wizard, chooseStyle: (style: AccountStyle) => { calls.choose(style); wizard.chooseStyle(style) } }
  } }
})
vi.mock('@/components/shared/list-navigation', async (original) => ({
  ...(await original<object>()),
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
  useListNavigationRouter: () => ({ push: vi.fn() }),
}))

const pending: StyleState = { style: 'standard', styleSelected: false, styleMode: 'later', shouldPromptStyleSelection: true, version: 3, answers: {} }
const group = () => screen.getByRole('group', { name: '見るスタイル' })
const view = (style: AccountStyle) => fireEvent.click(within(group()).getByRole('button', { name: new RegExp(`^${styleLabel(style)}`) }))
const viewing = () => within(group()).getAllByRole('button').find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent

beforeEach(() => {
  vi.clearAllMocks()
  setTestReducedMotion(true)
  document.documentElement.dataset.theme = 'v8'
  calls.save.mockResolvedValue({ success: true, data: { version: 4 } })
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

describe('スタイルを選ぶ画面（共通節 S）', () => {
  it('台本のスタイルは 6 つで、表示名は styleTerm の V01 と同じ', () => {
    expect(STYLE_EXPERIENCE_SCRIPT.order).toEqual(['restaurant', 'salon', 'consult', 'lesson', 'standard', 'ec'])
    for (const choice of STYLE_CHOICES) expect(STYLE_EXPERIENCE_SCRIPT.styles[choice.value].label).toBe(choice.label)
    for (const style of STYLE_EXPERIENCE_SCRIPT.order) expect(STYLE_EXPERIENCE_SCRIPT.styles[style].can).toHaveLength(3)
  })

  it('開いた直後は上部の見出しへ焦点を置き、切り替えだけでは保存しない', async () => {
    render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '飲食店でできること' })))
    const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
    expect(dialog.querySelectorAll('[data-style-switcher]')).toHaveLength(1)
    expect(dialog.querySelector('[data-window-body]')?.contains(group())).toBe(false)
    expect(within(group()).getAllByRole('button')).toHaveLength(6)
    for (const style of STYLE_EXPERIENCE_SCRIPT.order) {
      view(style)
      expect(screen.getByRole('heading', { name: `${styleLabel(style)}でできること` })).toBeTruthy()
      expect(viewing()).toBe(styleLabel(style))
    }
    expect(calls.save).not.toHaveBeenCalled()
  })

  it('見る・選ぶでは保存せず、［次へ］の先の保存で選んだスタイルだけを送る', async () => {
    render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
    expect(viewing()).toBe(styleLabel('restaurant'))
    view('salon')
    fireEvent.click(screen.getByRole('button', { name: 'このスタイルにする' }))
    view('lesson')
    expect(screen.getByText(`選んでいるスタイル：${styleLabel('salon')}`).getAttribute('role')).toBe('status')
    expect(screen.getByRole('button', { name: 'このスタイルにする' })).toBeTruthy()
    expect(calls.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    await screen.findByRole('dialog', { name: '最初のリッチメニューを選ぶ' })
    expect(calls.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '途中保存して閉じる' }))
    await waitFor(() => expect(calls.save).toHaveBeenCalledTimes(1))
    expect(calls.save.mock.calls[0][1]).toMatchObject({ expectedVersion: 3, style: 'salon' })
  })

  it('選ぶまで［次へ］は押せず、帯は「まだ選んでいません」', () => {
    render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
    expect(screen.getByText('まだ選んでいません').getAttribute('role')).toBe('status')
    expect(screen.getByText('スタイルを選んでください')).toBeTruthy()
    const next = screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.click(next)
    expect(screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })).toBeTruthy()
    expect(calls.save).not.toHaveBeenCalled()
  })

  it('保存済みのスタイルを最初に見せ、選んだ印を付ける', () => {
    render(<StyleSetupWizard accountId="a" state={{ ...pending, style: 'ec', styleSelected: true, styleMode: 'configured' }} onClose={calls.closed} />)
    expect(viewing()).toContain(styleLabel('ec'))
    expect(within(group()).getByRole('button', { name: `${styleLabel('ec')}（選んでいます）` })).toBeTruthy()
    expect(screen.getByText('選んでいます')).toBeTruthy()
  })

  it('左右の矢印で 6 つを移れ、hover では変わらない', () => {
    function Subject() {
      const [style, setStyle] = useState<AccountStyle>('restaurant')
      return <StyleChoiceStep viewing={style} onView={setStyle} chosen={null} onChoose={vi.fn()} />
    }
    render(<Subject />)
    const first = within(group()).getAllByRole('button')[0]
    fireEvent.mouseEnter(within(group()).getAllByRole('button')[3])
    expect(viewing()).toBe(styleLabel('restaurant'))
    for (const style of ['salon', 'consult', 'lesson', 'standard', 'ec', 'restaurant'] as const) {
      fireEvent.keyDown(first, { key: 'ArrowRight' })
      expect(viewing()).toBe(styleLabel(style))
    }
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(viewing()).toBe(styleLabel('ec'))
  })

  it('見本の枠は最小版と全部版で同じ枠のまま中身だけ替わる', () => {
    const { rerender } = render(<StyleChoiceStep viewing="salon" onView={vi.fn()} chosen={null} onChoose={vi.fn()} variant="minimal" />)
    const frame = screen.getByRole('region', { name: '見本' })
    const before = frame.className
    rerender(<StyleChoiceStep viewing="salon" onView={vi.fn()} chosen={null} onChoose={vi.fn()} variant="full" />)
    expect(screen.getByRole('region', { name: '見本' })).toBe(frame)
    expect(frame.className).toBe(before)
  })

  it('帯の 1 行は見ているスタイルではなく選んでいるスタイルを言う', () => {
    render(<StyleChoiceStatus chosen="consult" />)
    expect(screen.getByRole('status').textContent).toBe(`選んでいるスタイル：${styleLabel('consult')}`)
  })
})

it('窓上部のスタイル切り替えから Escape を押すとデモだけ閉じる', async () => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  const styleButton = within(group()).getByRole('button', { name: 'サロン' })
  styleButton.focus()
  fireEvent.keyDown(styleButton, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '詳しく見る' })).toBeTruthy()
  expect(screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })).toBeTruthy()
  expect(calls.closed).not.toHaveBeenCalled()
})

it('窓の唯一の閉じるボタンはデモから選択画面へ戻し、選択操作は下の帯に置く', () => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
  expect(within(dialog).getAllByRole('button', { name: '閉じる' })).toHaveLength(1)
  const previous = within(dialog).getByRole('button', { name: '前のページ' })
  expect(previous.closest('[data-dialog-actions]')).toBeTruthy()
  expect(previous.getAttribute('aria-disabled')).toBe('true')
  previous.focus()
  fireEvent.click(previous)
  expect(document.activeElement).toBe(previous)
  expect(within(dialog).getByRole('button', { name: 'このスタイルにする' })).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: '次のページ' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
  expect(screen.getByRole('button', { name: '詳しく見る' })).toBeTruthy()
  expect(calls.closed).not.toHaveBeenCalled()
})


it('はじめの質問のデモで選ぶと、選択を渡し選択済みボタンへ焦点を移す', async () => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
  const action = within(dialog).getByRole('button', { name: 'このスタイルにする' })
  expect(action.closest('[data-dialog-actions]')).toBeTruthy()
  fireEvent.click(action)
  expect(calls.choose).toHaveBeenCalledExactlyOnceWith('restaurant')
  const selected = within(dialog).getByRole('button', { name: '選んでいます' })
  await waitFor(() => expect(document.activeElement).toBe(selected))
  expect(within(dialog).getByText('選んでいるスタイル：飲食店')).toBeTruthy()
})

it.each(STYLE_EXPERIENCE_SCRIPT.order.flatMap(style => [0, 1, 2, 3, 4].map(page => ({ style, page }))))('$style の $page ページからスタイルを選べる', ({ style, page }) => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  view(style)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  for (let index = 0; index < page; index++) fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  fireEvent.click(screen.getByRole('button', { name: 'このスタイルにする' }))
  expect(calls.choose).toHaveBeenCalledExactlyOnceWith(style)
  expect(calls.save).not.toHaveBeenCalled()
})

it.each(STYLE_EXPERIENCE_SCRIPT.order)('%s の最後のページにそのスタイルのメニューを表示する', style => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  view(style)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  for (let page = 0; page < 4; page++) fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  const guide = within(screen.getByRole('region', { name: '見本から始める案内' }))
  for (const item of STYLE_EXPERIENCE_SCRIPT.styles[style].richMenu ?? []) expect(guide.getByText(item.label)).toBeTruthy()
  expect(calls.choose).not.toHaveBeenCalled()
})

it('メニューの見本が空の場合は案内を表示する', () => {
  const script = STYLE_EXPERIENCE_SCRIPT.styles.ec
  const original = script.richMenu
  try {
    script.richMenu = []
    render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
    view('ec')
    fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
    for (let page = 0; page < 4; page++) fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    expect(screen.getByText('メニューの内容を確認できません。')).toBeTruthy()
  } finally { script.richMenu = original }
})

it('ECの注文と未返信の見本を確認する', () => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  view('ec')
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  for (let page = 0; page < 3; page++) fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  const section = within(screen.getByRole('region', { name: '注文のあとの見本' }))
  expect(section.getByText('今日の注文 5件')).toBeTruthy()
  const rows = section.getAllByRole('listitem')
  expect(rows.map(row => Number(row.textContent?.match(/(\d+)件/)?.[1]))).toEqual([2, 1, 2])
  expect(rows.reduce((sum, row) => sum + Number(row.textContent?.match(/(\d+)件/)?.[1]), 0)).toBe(5)
  expect(section.getByText('お問い合わせ・未返信 1件')).toBeTruthy()
  expect(section.getByText('見本 あかり さま・届き日のご相談')).toBeTruthy()
})


it.each(['standard', 'ec'] as const)('%s のデモに予約の言葉を出さない', style => {
  render(<StyleSetupWizard accountId="a" state={pending} onClose={calls.closed} />)
  view(style)
  fireEvent.click(screen.getByRole('button', { name: '詳しく見る' }))
  for (let index = 0; index < 5; index++) {
    const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
    expect(dialog.textContent).not.toContain('予約')
    if (index < 4) fireEvent.click(within(dialog).getByRole('button', { name: '次のページ' }))
  }
})
