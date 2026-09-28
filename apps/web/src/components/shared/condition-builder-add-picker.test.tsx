// @vitest-environment happy-dom
/*
 * 条件の足し口（m22c）。15個の札を並べっぱなしにしない。
 * 検索できる候補（Combobox）で足す。札に戻すと赤くなる。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: {}, enabled: () => true }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    tags: { list: async () => ({ success: true as const, data: [] }) },
    friendFields: { list: async () => ({ success: true as const, data: [] }) },
    supportMarks: { list: async () => ({ success: true as const, data: [] }) },
    scenarios: { list: async () => ({ success: true as const, data: [] }) },
    segments: { count: async () => ({ success: true as const, data: { count: 0 } }) },
  },
}))

import ConditionBuilder from './condition-builder'

afterEach(() => cleanup())

function renderBuilder(onChange: (value: unknown) => void = () => {}) {
  return render(<ConditionBuilder value={null} onChange={onChange} />)
}

describe('条件の足し口（m22c）', () => {
  it('15個の札ボタンは並べない。検索できる候補が1つある', () => {
    renderBuilder()
    // 候補つき入力が「すべて」「or条件」の2か所に1つずつあるだけ。
    expect(screen.getAllByRole('combobox', { name: '追加する条件を選ぶ' })).toHaveLength(1)
    // 札ボタンに戻っていたら赤：15種の名前がボタンとして並ぶ。
    for (const label of ['個別メモ', 'ステータスメッセージ', '友だち登録日', '対応マーク', '行動スコア']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
  })

  it('「タグ」と打って選ぶと条件が1つ足りる。欄は空に戻る', async () => {
    const seen: unknown[] = []
    renderBuilder((next) => {
      seen.push(next)
    })
    const field = screen.getByRole('combobox', { name: '追加する条件を選ぶ' })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'タグ' } })
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    // タグ・対応マークなど「タグ」を含む候補に絞られる。まとまり名も出る。
    expect(options.length).toBeGreaterThan(0)
    expect(listbox.textContent).toContain('タグ・記入欄')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0])).toContain('tag_exists')
    // 選んだ直後は欄が空に戻り、続けてもう1つ足せる。
    expect((field as HTMLInputElement).value).toBe('')
  })
})
