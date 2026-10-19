// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import KpiCard from './kpi-card'

/**
 * 増減の数（差し引き）は、プラスのとき「+」を付け、単位も出す（絵 「+47 人」）。
 * signed を渡さない数のマスは今までどおり（+ を付けない）。
 */
const text = (props: Partial<React.ComponentProps<typeof KpiCard>>) =>
  renderToStaticMarkup(<KpiCard title="差し引き" value={47} unit="人" detail="" {...props} />).replace(/<[^>]*>/g, '')

describe('KpiCard の符号つきの数', () => {
  it('signed でプラスなら「+47人」', () => {
    expect(text({ signed: true })).toContain('+47人')
  })
  it('signed でもマイナス・0 は符号を足さない', () => {
    expect(text({ signed: true, value: -3 })).toContain('-3人')
    expect(text({ signed: true, value: 0 })).toContain('0人')
    expect(text({ signed: true, value: 0 })).not.toContain('+0')
  })
  it('signed を渡さなければ「47人」', () => {
    expect(text({})).toContain('47人')
    expect(text({})).not.toContain('+47')
  })
  it('整形した数の単位は指定したときだけ添え、上限なしの状態へは添えない', () => {
    expect(text({ valueText: '38 / 1,000', unit: '通', valueTextWithUnit: true })).toContain('38 / 1,000通')
    expect(text({ valueText: '38 / 1,000', unit: '通' })).not.toContain('38 / 1,000通')
    expect(text({ valueText: '上限なし', unit: '通', valueTextWithUnit: true })).not.toContain('上限なし通')
  })
})
