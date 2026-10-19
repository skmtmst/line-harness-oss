// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActionMenu from './action-menu'
import { Field } from './form-controls'
import ScreenExplanation from './screen-explanation'
import SaveFeedback, { useSaveFeedback } from './save-feedback'
import AggregationStatus from './aggregation-status'
import FriendFilterBand, { friendFilterHref } from './friend-filter-band'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { requiredText } from '@/lib/form-requirement'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() })
})
afterEach(() => { cleanup(); forgetStaffIdentity(); vi.unstubAllGlobals() })

describe('共通の必須と行メニュー', () => {
  it('空欄の検査と必須の札を1つの定義で決め、欄下の理由と赤枠をつなぐ', () => {
    const rule = requiredText('名前を入れてください')
    function Form() {
      const [value, setValue] = useState(''), [error, setError] = useState<string | null>(null)
      return <><Field label="名前" requirement={rule} error={error}><input aria-label="名前" value={value} onChange={e => setValue(e.target.value)} /></Field><button onClick={() => setError(rule.check(value))}>保存</button></>
    }
    render(<Form />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: '名前' })
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('必須')).toBeTruthy()
    expect(screen.queryByText('任意')).toBeNull()
    fireEvent.click(screen.getByText('保存'))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const reason = screen.getByRole('alert')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(reason.id)
    fireEvent.change(input, { target: { value: '入力を残す' } })
    expect(input.value).toBe('入力を残す')
    fireEvent.click(screen.getByText('保存'))
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('元の配列・権限・実行を保ち、見る→整理→停止・削除で区切り全項目に印を付ける', () => {
    const stop = vi.fn(), view = vi.fn()
    const items = [
      { id: 'stop', label: '停止する', onSelect: stop },
      { id: 'edit', label: '名前を変える', disabled: true, disabledReason: '管理者だけが変えられます' },
      { id: 'view', label: '予約の詳細を見る', onSelect: view },
      { id: 'delete', label: '削除する' },
      { id: 'move', label: 'フォルダを変える' },
    ]
    render(<ActionMenu open inline items={items} onClose={() => {}} />)
    const buttons = screen.getAllByRole('menuitem')
    expect(buttons.map(button => button.textContent)).toEqual(['予約の詳細を見る', expect.stringContaining('名前を変える'), 'フォルダを変える', '停止する', '削除する'])
    expect(items[0].id).toBe('stop')
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelectorAll('[role="menu"] hr')).toHaveLength(2)
    expect(screen.getByText('見る')).toBeTruthy()
    expect(screen.getByText('変える・整理する')).toBeTruthy()
    for (const button of buttons) expect(button.querySelector('svg')).toBeTruthy()
    expect(buttons[3].className).toMatch(/danger/)
    fireEvent.click(buttons[1]); expect(stop).not.toHaveBeenCalled()
    fireEvent.click(buttons[0]); expect(view).toHaveBeenCalledOnce()
  })
})

it('初めは開き、閉じた状態を人・画面ごとに覚える', () => {
  const person = (id: string) => rememberStaffIdentity({ id } as Parameters<typeof rememberStaffIdentity>[0])
  person('operator-a')
  const view = render(<ScreenExplanation title={<h2>予約</h2>} screenKey="booking">説明の本文</ScreenExplanation>)
  const button = screen.getByRole('button', { name: 'この画面の説明' })
  expect(button.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('false')
  view.unmount()
  const second = render(<ScreenExplanation title={<h2>予約</h2>} screenKey="booking">説明の本文</ScreenExplanation>)
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  second.unmount(); person('operator-b')
  const other = render(<ScreenExplanation title={<h2>予約</h2>} screenKey="booking">説明の本文</ScreenExplanation>)
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  other.unmount(); person('operator-a')
  render(<ScreenExplanation title={<h2>配信</h2>} screenKey="broadcasts">説明の本文</ScreenExplanation>)
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
})

it('保存中の二重実行を防ぎ、一部成功と残りの再試行を分ける', () => {
  const retry = vi.fn(), began = vi.fn()
  function Form() {
    const feedback = useSaveFeedback()
    return <><button disabled={feedback.busy} onClick={() => { began(feedback.begin('予約')); began(feedback.begin('予約')) }}>{feedback.busy ? '保存しています…' : '保存'}</button>
      <button onClick={() => feedback.failure('担当への通信が切れました', ['予約のルール'], ['担当の設定'])}>途中で失敗</button>
      <SaveFeedback state={feedback.state} onRetry={retry} /></>
  }
  render(<Form />); fireEvent.click(screen.getByText('保存'))
  expect(began.mock.calls).toEqual([[true], [false]])
  expect((screen.getByText('保存しています…') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByText('途中で失敗'))
  expect(screen.getByText('できた分：予約のルール')).toBeTruthy()
  expect(screen.getByText('残り：担当の設定')).toBeTruthy()
  expect(screen.getByText('入力は残っています。')).toBeTruthy()
  fireEvent.click(screen.getByText('残りだけもう一度')); expect(retry).toHaveBeenCalledOnce()
})

it('E1：名前をURLへ入れず、絞り込みだけ外して友だち詳細へ戻る', () => {
  const href = friendFilterHref('/scenarios?active=1&friendId=old', 'fixture/a')
  expect(href).toBe('/scenarios?active=1&friendId=fixture%2Fa')
  render(<FriendFilterBand friend={{ id: 'fixture/a', displayName: '表示する名前' }} subject="シナリオ" listHref={href} />)
  const all = screen.getByRole('link', { name: '全員のシナリオを見る' })
  const back = screen.getByRole('link', { name: '表示する名前さんの詳細へ戻る' })
  expect(all.getAttribute('href')).toContain('/scenarios?active=1')
  expect(all.getAttribute('href')).not.toContain('friendId')
  expect(back.getAttribute('href')).toContain('id=fixture%2Fa')
  expect(back.getAttribute('href')).not.toContain('表示する名前')
})

it('E2：まだ・集計中・失敗・完成を分け、集計中は実行の口を出さない', () => {
  const run = vi.fn()
  const view = render(<AggregationStatus state={{ kind: 'empty' }} onRun={run} />)
  fireEvent.click(screen.getByText('集計する')); expect(run).toHaveBeenCalledOnce()
  view.rerender(<AggregationStatus state={{ kind: 'running', startedAt: '2026-10-11T12:00:00Z' }} onRun={run} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText(/始めた時刻/)).toBeTruthy()
  view.rerender(<AggregationStatus state={{ kind: 'failed', reason: '通信を確認してください' }} onRun={run} />)
  expect(screen.getByText('通信を確認してください')).toBeTruthy()
  fireEvent.click(screen.getByText('もう一度')); expect(run).toHaveBeenCalledTimes(2)
  view.rerender(<AggregationStatus state={{ kind: 'complete', dataAt: '2026-10-11T12:00:00Z' }} onRun={run} />)
  expect(screen.getByText(/データの時点/)).toBeTruthy()
  expect(screen.getByText('集計し直す')).toBeTruthy()
})
