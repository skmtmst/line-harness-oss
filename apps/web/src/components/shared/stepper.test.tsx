import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Stepper, { type StepperStep } from './stepper'

const steps: StepperStep[] = [
  { key: 'base', label: '基本設定', order: 1, state: 'done', anchor: 'sec-base' },
  { key: 'target', label: '対象者', order: 2, state: 'current' },
  { key: 'message', label: 'メッセージ', order: 3, state: 'todo' },
]

const html = (list: StepperStep[] = steps) =>
  renderToStaticMarkup(<Stepper label="配信作成の進み" steps={list} />)

describe('Stepper（手順の1本化）', () => {
  test('段の名前を順に出す', () => {
    const out = html()
    expect(out).toContain('基本設定')
    expect(out).toContain('対象者')
    expect(out).toContain('メッセージ')
  })

  test('済んだ段は番号でなく ✓ を出す', () => {
    const out = html()
    expect(out).toContain('✓')
    expect(out).not.toContain('>1<')
    expect(out).toContain('>2<')
    expect(out).toContain('>3<')
  })

  test('いまの段だけに aria-current="step" が付く', () => {
    const out = html()
    expect((out.match(/aria-current="step"/g) ?? []).length).toBe(1)
  })

  test('押して戻れるのは済みの段だけ', () => {
    const out = html()
    const buttons = out.match(/<button/g) ?? []
    expect(buttons.length).toBe(1)
    expect(out).toContain('基本設定へ戻る')
    expect(out).not.toContain('対象者へ戻る')
    expect(out).not.toContain('メッセージへ戻る')
  })

  test('行き先のない済みの段は押せない', () => {
    const out = html([{ key: 'a', label: '済み', order: 1, state: 'done' }])
    expect(out).not.toContain('<button')
    expect(out).toContain('✓')
  })

  test('読み上げ名が nav に付く', () => {
    const out = html()
    expect(out).toContain('aria-label="配信作成の進み"')
  })
})
