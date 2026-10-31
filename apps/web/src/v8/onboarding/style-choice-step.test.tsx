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

const calls = vi.hoisted(() => ({ save: vi.fn(), closed: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: {
  save: calls.save, activate: vi.fn(),
  starterSet: vi.fn(async () => ({ success: true, data: { definition: { items: [] }, preview: [] } })),
  starterItems: vi.fn(async () => ({ success: true, data: { items: [] } })),
} }))
vi.mock('@/hooks/use-account-style', () => ({ accountStyleUpdated: vi.fn() }))
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
