// @vitest-environment happy-dom
/*
 * MetricValue（監査6 #674「数字の見せ方統一」）を本物のReactで動かす試験。
 *
 * 見るのは4点:
 *   - 数字には必ず tabular-nums が付き、単位は数字より小さく出る
 *   - 「—（未取得）」「0」「エラー」の3状態を data-metric-state と
 *     表示で区別する（0 は実値として単位付きで出る）
 *   - 24px超（large）には letter-spacing: -0.02em が付く
 *   - 取得失敗・未取得は値が残っていても「—」で出す
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import MetricValue from './metric-value'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
})

describe('MetricValue', () => {
  it('数値を3桁区切りで出し、tabular-nums と ready 状態を付ける', () => {
    const { container } = render(<MetricValue value={12345} unit="件" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-metric-state')).toBe('ready')
    expect(root.className).toContain('tabular-nums')
    expect(root.textContent).toBe('12,345件')
  })

  it('単位と前置きは数字より小さい字で出る', () => {
    const { container } = render(<MetricValue value={12} prefix="およそ" unit="時間" />)
    const root = container.firstElementChild as HTMLElement
    const smalls = root.querySelectorAll('.text-xs')
    expect(smalls.length).toBe(2)
    expect(smalls[0].textContent).toBe('およそ ')
    expect(smalls[1].textContent).toBe('時間')
  })

  it('0 は実値として単位付きで出す（— にしない）', () => {
    const { container } = render(<MetricValue value={0} unit="件" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-metric-state')).toBe('ready')
    expect(root.textContent).toBe('0件')
  })

  it('値が無いときは薄い「—」だけを出し、単位を付けない', () => {
    const { container } = render(<MetricValue value={null} unit="件" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-metric-state')).toBe('missing')
    expect(root.textContent).toBe('—')
    expect(root.textContent).not.toContain('件')
  })

  it('エラーは「—」で出し、状態だけ data-metric-state で区別する', () => {
    const { container } = render(<MetricValue value={5} unit="件" state="error" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-metric-state')).toBe('error')
    expect(root.textContent).toBe('—')
  })

  it('missing を明示すると残った値も出さない', () => {
    const { container } = render(<MetricValue value={5} unit="件" state="missing" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-metric-state')).toBe('missing')
    expect(root.textContent).toBe('—')
  })

  it('large を付けると 24px超向けの字詰め（tracking -0.02em）が入る', () => {
    const { container } = render(<MetricValue value={100} large />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('tracking-[-0.02em]')
  })

  it('large なしでは字詰めを付けない', () => {
    const { container } = render(<MetricValue value={100} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toContain('tracking-[-0.02em]')
  })

  it('整形済みの文字（text）をそのまま出せる', () => {
    const { container } = render(<MetricValue text="約2時間" prefix="平均" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-metric-state')).toBe('ready')
    expect(root.textContent).toBe('平均 約2時間')
  })
})
