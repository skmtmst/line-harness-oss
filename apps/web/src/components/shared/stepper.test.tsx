import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StepperStep } from './stepper'
import { Steps } from '@/components/templates/steps'

const steps: StepperStep[] = [
  { key: 'base', label: '基本設定', order: 1, state: 'done', anchor: 'sec-base' },
  { key: 'target', label: '対象者', order: 2, state: 'current' },
  { key: 'message', label: 'メッセージ', order: 3, state: 'todo' },
]

const html = (list: StepperStep[] = steps) =>
  renderToStaticMarkup(<Steps label="配信作成の進み" steps={list} />)

describe('V8の手順（手順の1本化）', () => {
  test('段の名前を順に出す', () => {
    const out = html()
    expect(out).toContain('基本設定')
    expect(out).toContain('対象者')
    expect(out).toContain('メッセージ')
  })

  test('済んだ段は番号でなく ✓ を出す', () => {
    const out = html()
    expect(out).toContain('data-step-dot="done"')
    expect(out).toContain('済み')
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
    expect(out).toContain('基本設定に戻る')
    expect(out).not.toContain('対象者に戻る')
    expect(out).not.toContain('メッセージに戻る')
  })

  test('行き先のない済みの段は押せない', () => {
    const out = html([{ key: 'a', label: '済み', order: 1, state: 'done' }])
    expect(out).not.toContain('<button')
    expect(out).toContain('data-step-dot="done"')
    expect(out).toContain('済み')
  })

  test('読み上げ名が nav に付く', () => {
    const out = html()
    expect(out).toContain('aria-label="配信作成の進み"')
  })

  test('いまいる所は currentKey で決まる（入力済みの数で決めない）', () => {
    // 「次へ」で3段目へ進んだが、入力済みは1段目だけ。印は3段目に付く。
    const out = renderToStaticMarkup(
      <Steps
        label="配信作成の進み"
        currentKey="message"
        steps={[
          { key: 'basic', label: '基本設定', order: 1, state: 'done', anchor: 'sec-basic' },
          { key: 'audience', label: '対象者', order: 2, state: 'todo' },
          { key: 'message', label: 'メッセージ', order: 3, state: 'todo' },
        ]}
      />,
    )
    expect((out.match(/aria-current="step"/g) ?? []).length).toBe(1)
    expect(out).toContain('data-step-dot="done"')
    expect(out).toContain('済み')
    // いまいる段（メッセージ）は番号のまま。済みの段（基本設定）だけ ✓。
    expect(out).toContain('>3<')
    // いまいる段は押せない。済みの段は押して戻れる。
    expect(out).not.toContain('メッセージに戻る')
    expect(out).toContain('基本設定に戻る')
  })

  test('直すところがある段は △ で、その段へ戻れる', () => {
    const out = renderToStaticMarkup(
      <Steps
        label="配信作成の進み"
        currentKey="confirm"
        steps={[
          { key: 'basic', label: '基本設定', order: 1, state: 'done', anchor: 'sec-basic' },
          { key: 'message', label: 'メッセージ', order: 2, state: 'attention', anchor: 'sec-message' },
          { key: 'confirm', label: '確認', order: 3, state: 'todo' },
        ]}
      />,
    )
    expect(out).toContain('△')
    expect(out).toContain('メッセージに戻る')
    expect(out).toContain('直すところがあります')
  })

  test('入力済みでも今の段は番号と現在地を示し、自分へ戻る操作を出さない', () => {
    const out = renderToStaticMarkup(
      <Steps
        label="配信作成の進み"
        currentKey="basic"
        steps={[{ key: 'basic', label: '基本設定', order: 1, state: 'done', anchor: 'sec-basic' }]}
      />,
    )
    expect(out).toContain('data-step-dot="current"')
    expect(out).toContain('>1<')
    expect(out).toContain('aria-current="step"')
    // 自分がいる段は押しても何も起きないので、戻るボタンにしない。
    expect(out).not.toContain('<button')
  })
})
