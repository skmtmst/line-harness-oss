// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import KpiCard from './kpi-card'

/**
 * 増減の数（差し引き）は、プラスのとき「+」を付け、単位も出す（絵 ws9wt「+47 人」）。
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
})
