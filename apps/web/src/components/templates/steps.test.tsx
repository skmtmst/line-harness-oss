// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Steps } from './steps'
import type { StepperStep } from '@/components/shared/stepper'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const back = vi.fn()
const STEPS: StepperStep[] = [
  { key: 'basic', label: '基本設定', state: 'done', onSelect: back },
  { key: 'audience', label: '配信対象', state: 'done', onSelect: vi.fn() },
  { key: 'message', label: 'メッセージを作成', state: 'todo', onSelect: vi.fn() },
  { key: 'schedule', label: '送信設定', state: 'todo' },
]

/**
 * ★V8 の手順（共通部品 Fa8ED・決まりの板 q1xNMz。2026-10-08 オーナー）。
 * 丸24（済み＝緑に白い✓・今＝墨に白い数字・まだ＝薄い枠に灰の数字）・名13（今だけ太字）・線24×1.5。
 */
describe('手順（型の共通部品 Steps）', () => {
  it('質問の縦の列では未回答にも移れ、現在の場所と回答済みを分ける', () => {
    const select = vi.fn()
    render(<Steps label="はじめの質問の一覧" layout="sidebar" currentKey="now" steps={[
      { key: 'done', label: '使い方', state: 'done', onSelect: () => select('done') },
      { key: 'now', label: '見た目', state: 'todo', onSelect: () => select('now') },
      { key: 'next', label: '通知', state: 'todo', onSelect: () => select('next') },
    ]} />)
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('見た目')
    for (const name of ['使い方', '見た目', '通知']) fireEvent.click(screen.getByRole('button', { name }))
    expect(select.mock.calls.flat()).toEqual(['done', 'now', 'next'])
  })
  it('段ごとに済み・今・まだの印を付け、今の段だけ aria-current="step"', () => {
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const nav = screen.getByRole('navigation', { name: '配信作成の進み' })
    const items = [...nav.querySelectorAll('li')]
    expect(items.map((li) => li.getAttribute('data-step-state'))).toEqual(['done', 'current', 'todo', 'todo'])
    expect(items.map((li) => li.querySelector('[data-step-dot]')?.getAttribute('data-step-dot'))).toEqual(['done', 'current', 'todo', 'todo'])
    /* 済みは ✓（番号を出さない）、今とまだは番号。 */
    expect(items[0].querySelector('[data-step-dot] svg')).toBeTruthy()
    expect(items[1].querySelector('[data-step-dot]')?.textContent).toBe('2')
    expect(items[2].querySelector('[data-step-dot]')?.textContent).toBe('3')
    const current = nav.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('配信対象')
    /* 段の間の線：済みの段の後ろは緑。 */
    expect([...nav.querySelectorAll('[data-step-line]')].map((line) => line.getAttribute('data-step-line'))).toEqual(['done', 'todo', 'todo'])
  })

  it('済みの段は押して戻れる（読み上げ「〇〇に戻る」）。今とまだの段は押せない', () => {
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['基本設定に戻る'])
    fireEvent.click(screen.getByRole('button', { name: '基本設定に戻る' }))
    expect(back).toHaveBeenCalledTimes(1)
    /* まだの段に行き先があっても押せない。今の段も押せない。 */
    expect(screen.queryByRole('button', { name: 'メッセージを作成に戻る' })).toBeNull()
    expect(screen.queryByRole('button', { name: '配信対象に戻る' })).toBeNull()
  })

  it('済みの段はボタンなので、キーボード（Enter・Space）でも押せる', () => {
    render(<Steps label="配信作成の進み" steps={STEPS} currentKey="audience" />)
    const button = screen.getByRole('button', { name: '基本設定に戻る' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('currentKey を渡さないときは、state が current の最初の段だけを今にする（印が2つ付かない）', () => {
    render(<Steps label="シナリオ作成の進み方" steps={[
      { label: 'シナリオ情報', state: 'current' },
      { label: '配信方式', state: 'current' },
      { label: '1通目を設定', state: 'todo' },
    ]} />)
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('シナリオ情報')
  })

  it('直す段にも戻れるが、今の段と未完の段へは進めない', () => {
    const repair = vi.fn()
    render(<Steps label="手順" currentKey="basic" steps={[
      { key: 'basic', label: '基本設定', state: 'current' },
      { key: 'repair', label: '入力を確認', state: 'attention', onSelect: repair },
      { key: 'future', label: '送信', state: 'todo', onSelect: vi.fn() },
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: '入力を確認に戻る' }))
    expect(repair).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '送信に戻る' })).toBeNull()
  })
})

it('完了した内容だけを1行で要約し、変える操作を元の段へつなぐ', () => {
  const change = vi.fn()
  render(<Steps label="作成" currentKey="message" summaries={{ basic: '夏のお知らせ', audience: 'タグ：会員', message: '未完成の本文' }} steps={[
    { key: 'basic', label: '基本', state: 'done', onSelect: change },
    { key: 'audience', label: '対象', state: 'done' },
    { key: 'message', label: '本文', state: 'todo' },
  ]} />)
  expect(screen.getByText('夏のお知らせ').getAttribute('title')).toBe('夏のお知らせ')
  expect(screen.getByText('タグ：会員')).toBeTruthy()
  expect(screen.queryByText('未完成の本文')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '基本を変える' }))
  expect(change).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '対象を変える' })).toBeNull()
})

it('閲覧のみでは要約を読めるが、変えるボタンを出さない', () => {
  render(<Steps readOnly label="確認" currentKey="next" summaries={{ saved: '保存済みの名前' }} steps={[
    { key: 'saved', label: '基本', state: 'done', onSelect: vi.fn() },
    { key: 'next', label: '確認', state: 'todo' },
  ]} />)
  expect(screen.getByText('保存済みの名前')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '基本を変える' })).toBeNull()
})


it('完了した入力が無いときは、空の要約の段を置かない', () => {
  render(<Steps label="作る" currentKey="first" summaries={{ first: '入力中' }} steps={[{ key: 'first', label: '基本', state: 'todo' }]} />)
  expect(screen.queryByRole('list', { name: '設定済みの内容' })).toBeNull()
})
