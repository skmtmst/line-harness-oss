import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StepTrail from './step-trail'

const html = (items: Parameters<typeof StepTrail>[0]['items']) =>
  renderToStaticMarkup(<StepTrail label="作成の進み方" items={items} />)

describe('StepTrail', () => {
  test('段の名前と番号を順に出す', () => {
    const out = html([
      { label: '形を決める', state: 'current' },
      { label: 'ボタンと出し分け', state: 'todo' },
      { label: '公開のしかた', state: 'todo' },
    ])
    expect(out).toContain('形を決める')
    expect(out).toContain('ボタンと出し分け')
    expect(out).toContain('公開のしかた')
    /* 済んでいない段は番号で出す。 */
    expect(out).toContain('>2<')
    expect(out).toContain('>3<')
  })

  test('済んだ段は番号でなく ✓ を出す', () => {
    const out = html([
      { label: 'シナリオ情報', state: 'done' },
      { label: '配信方式', state: 'current' },
    ])
    expect(out).toContain('✓')
    expect(out).not.toContain('>1<')
  })

  test('いまの段に aria-current="step" が付く', () => {
    const out = html([
      { label: 'A', state: 'done' },
      { label: 'B', state: 'current' },
    ])
    expect((out.match(/aria-current="step"/g) ?? []).length).toBe(1)
  })

  test('読み上げ用の名前を持つ', () => {
    expect(html([{ label: 'A', state: 'current' }])).toContain('aria-label="作成の進み方"')
  })

  test('段が1つのときは区切り線を出さない', () => {
    const one = html([{ label: 'A', state: 'current' }])
    const two = html([{ label: 'A', state: 'done' }, { label: 'B', state: 'current' }])
    expect((one.match(/aria-hidden/g) ?? []).length).toBe(0)
    expect((two.match(/aria-hidden/g) ?? []).length).toBe(1)
  })
})
